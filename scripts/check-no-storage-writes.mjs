// Fails when a script under scripts/ writes into the bucket itself.
//
// UPL-18 (S6 P3 AC9): a video reaches storage only through an upload the API
// issued. The smoke PUTs to the part URLs the API signs, which is that path;
// an aws-cli copy, an s3api object write or an SDK upload is a second way in,
// which is what the deleted seed script was. The destination key is often a
// variable (the seed's was), so any write into the bucket fails, not only a
// literal `sources/` one: nothing under scripts/ has a reason to write there.
//
// `--self-test` needs no files: it feeds the detector the deleted seed's
// calls, a shell copy, an s3api write and an SDK upload, requires each to be
// named, and requires a read from the bucket to stdout or a file to pass.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
// SCRIPTS_DIR stands in for scripts/, so the self-test can run this script on
// a tree it built. Unset, it is the directory this script lives in.
const SCRIPTS_DIR = process.env.SCRIPTS_DIR ? resolve(process.env.SCRIPTS_DIR) : dirname(SELF);

// Each entry names a write and matches it in a shell line or in the argument
// array a script hands to spawn. `s3 cp` is a write only when its last path
// is an s3:// URI; a copy from the bucket to a file or to stdout is a read.
const WRITES = [
  ['aws s3 cp into the bucket', /\bs3['"`]?[\s,]+['"`]?cp\b[^\n\]]*?s3:\/\/[^\s'"`]*['"`]?\s*(?:\]|$)/m],
  ['aws s3 mv or sync', /\bs3['"`]?[\s,]+['"`]?(?:mv|sync)\b/],
  ['aws s3api put-object', /\bput-object\b/],
  ['aws s3api copy-object', /\bcopy-object\b/],
  ['aws s3api create-multipart-upload', /\bcreate-multipart-upload\b/],
  ['aws s3api upload-part', /\bupload-part\b/],
  ['an SDK object write', /\b(?:PutObjectCommand|CopyObjectCommand|CreateMultipartUploadCommand|UploadPartCommand)\b|\bnew Upload\(/],
];

// The writes a file's text contains, by name; empty when it writes nothing.
function writesIn(text) {
  return WRITES.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

// One line per offending file, or undefined when no script writes.
function writersProblem(files) {
  const offenders = files
    .map(({ name, text }) => ({ name, writes: writesIn(text) }))
    .filter(({ writes }) => writes.length > 0);
  if (offenders.length === 0) return undefined;
  return offenders
    .map(({ name, writes }) => `${name} writes into the bucket outside the API (${writes.join(', ')}); a video reaches storage only through an upload the API issues`)
    .join('\n');
}

// Every file under scripts/, subdirectories included, except this one, whose
// patterns name the writes they detect, and exFAT `._*` sidecars, which hold
// no text.
function readScripts(dir = SCRIPTS_DIR) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('._')) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && path !== SELF) files.push({ name: `scripts/${relative(dir, path)}`, text: readFileSync(path, 'utf8') });
    }
  };
  walk(dir);
  return files;
}

function fail(message) {
  console.error(`check-no-storage-writes: ${message}`);
  process.exit(1);
}

// The file list is injected so the self-test can drive this exact function.
function main({ read = readScripts, fail: stop = fail, log = console.log } = {}) {
  const files = read();
  // Reading nothing would pass every check below, so it is a failure itself.
  if (files.length === 0) stop('no script was read under scripts/');
  const problem = writersProblem(files);
  if (problem) stop(problem);
  log(`${files.length} scripts under scripts/ checked; none writes into the bucket outside the API`);
}

function selfTest() {
  // The deleted seed-source-video.mjs, verbatim: a key held in a constant on
  // another line, a file copied in, and stdin piped in.
  const seedCopy = "const copy = aws(\n  ['s3', 'cp', '--only-show-errors', `/fixtures/${FIXTURE.split('/').pop()}`, `s3://${BUCKET}/${KEY}`],\n";
  const seedPipe = "const pipe = aws(['s3', 'cp', '--only-show-errors', '-', `s3://${BUCKET}/${NOT_A_VIDEO_KEY}`], [], NOT_A_VIDEO);\n";
  // The smoke's archive read before S6 T6: from the bucket to stdout.
  const archiveRead = "['compose', 'run', '--rm', '--no-deps', '-T', '--entrypoint', 'aws', 'storage-init', 's3', 'cp', '--only-show-errors', `s3://${BUCKET}/${zipKey}`, '-'],\n";
  const listing = "'s3api', 'list-objects-v2', '--bucket', BUCKET, '--prefix', `zips/${id}/`,\n";
  const why = 'a video reaches storage only through an upload the API issues';
  const named = (name, writes) => `${name} writes into the bucket outside the API (${writes}); ${why}`;

  const rejections = [
    ['the seed copying the fixture', () => writersProblem([{ name: 'scripts/seed.mjs', text: seedCopy }]),
      named('scripts/seed.mjs', 'aws s3 cp into the bucket')],
    ['the seed piping the non-video', () => writersProblem([{ name: 'scripts/seed.mjs', text: seedPipe }]),
      named('scripts/seed.mjs', 'aws s3 cp into the bucket')],
    ['a shell copy into sources/', () => writersProblem([{ name: 'scripts/up.sh', text: 'aws s3 cp clip.mp4 s3://fiapx/sources/clip.mp4\n' }]),
      named('scripts/up.sh', 'aws s3 cp into the bucket')],
    ['the archive read with its two paths swapped', () => writersProblem([{ name: 'scripts/smoke.mjs', text: "'s3', 'cp', '--only-show-errors', '-', `s3://${BUCKET}/${zipKey}`],\n" }]),
      named('scripts/smoke.mjs', 'aws s3 cp into the bucket')],
    ['aws s3 sync', () => writersProblem([{ name: 'scripts/sync.sh', text: 'aws s3 sync ./videos s3://fiapx/sources/\n' }]),
      named('scripts/sync.sh', 'aws s3 mv or sync')],
    ['s3api put-object', () => writersProblem([{ name: 'scripts/put.mjs', text: "'s3api', 'put-object', '--bucket', BUCKET, '--key', key, '--body', path\n" }]),
      named('scripts/put.mjs', 'aws s3api put-object')],
    ['s3api multipart upload', () => writersProblem([{ name: 'scripts/mp.sh', text: 'aws s3api create-multipart-upload --bucket fiapx --key sources/x.mp4\naws s3api upload-part --part-number 1\n' }]),
      named('scripts/mp.sh', 'aws s3api create-multipart-upload, aws s3api upload-part')],
    ['an SDK PutObjectCommand', () => writersProblem([{ name: 'scripts/sdk.mjs', text: 'await client.send(new PutObjectCommand({ Bucket, Key, Body }));\n' }]),
      named('scripts/sdk.mjs', 'an SDK object write')],
    ['two writers among clean files', () => writersProblem([
      { name: 'scripts/clean.mjs', text: archiveRead },
      { name: 'scripts/a.sh', text: 'aws s3 mv a s3://fiapx/sources/a\n' },
      { name: 'scripts/b.mjs', text: seedPipe },
    ]), `${named('scripts/a.sh', 'aws s3 mv or sync')}\n${named('scripts/b.mjs', 'aws s3 cp into the bucket')}`],
  ];
  const acceptances = [
    ['a read from the bucket to stdout', () => writersProblem([{ name: 'scripts/smoke.mjs', text: archiveRead }])],
    ['a shell read to a file', () => writersProblem([{ name: 'scripts/get.sh', text: 'aws s3 cp s3://fiapx/zips/a/b/frames.zip ./frames.zip\n' }])],
    ['a listing', () => writersProblem([{ name: 'scripts/smoke.mjs', text: listing }])],
    ['a PUT to a part URL the API issued', () => writersProblem([{ name: 'scripts/smoke.mjs', text: "const res = await fetch(url, { method: 'PUT', body: bytes });\n" }])],
    ['no scripts', () => writersProblem([])],
  ];

  // The whole main path, with the file list injected. `stop` throws so a
  // failure ends the run exactly as process.exit would.
  class Stopped extends Error {}
  const runMain = (files) => {
    try {
      main({ read: () => files, fail: (message) => { throw new Stopped(message); }, log: () => {} });
      return undefined;
    } catch (error) {
      if (error instanceof Stopped) return error.message;
      throw error;
    }
  };
  rejections.push(['main: the seed among the scripts', () => runMain([{ name: 'scripts/smoke.mjs', text: archiveRead }, { name: 'scripts/seed.mjs', text: seedCopy }]),
    named('scripts/seed.mjs', 'aws s3 cp into the bucket')]);
  acceptances.push(['main: only reads', () => runMain([{ name: 'scripts/smoke.mjs', text: archiveRead + listing }])]);

  // The real reader on temporary directories: a writer one level down must be
  // read and named, the same tree without it must pass, and a directory with
  // nothing to read must fail rather than pass by reading nothing.
  const tree = mkdtempSync(join(tmpdir(), 'fiapx-storage-writes-self-test-'));
  const empty = mkdtempSync(join(tmpdir(), 'fiapx-storage-writes-self-test-'));
  const nestedWriter = join(tree, 'nested', 'writes.mjs');
  mkdirSync(join(tree, 'nested'));
  writeFileSync(join(tree, 'reads.mjs'), archiveRead);
  writeFileSync(join(tree, 'nested', 'lists.mjs'), listing);
  writeFileSync(nestedWriter, "aws(['s3', 'cp', '--only-show-errors', './clip.mp4', 's3://fiapx/sources/clip.mp4']);\n");
  // Each tree is read now, while it holds what the case describes.
  const withWriter = readScripts(tree);
  const nothing = readScripts(empty);
  const spawned = spawnSync(process.execPath, [SELF], { encoding: 'utf8', env: { ...process.env, SCRIPTS_DIR: tree } });
  const spawnedMessage = `check-no-storage-writes: ${named('scripts/nested/writes.mjs', 'aws s3 cp into the bucket')}\n`;
  rmSync(nestedWriter);
  const withoutWriter = readScripts(tree);
  rmSync(tree, { recursive: true, force: true });
  rmSync(empty, { recursive: true, force: true });
  rejections.push(
    ['main: a nested writer read from disk', () => runMain(withWriter), named('scripts/nested/writes.mjs', 'aws s3 cp into the bucket')],
    ['main: an empty directory', () => runMain(nothing), 'no script was read under scripts/'],
  );
  acceptances.push(['main: the same tree without the writer, read from disk', () => runMain(withoutWriter)]);

  const failures = [];
  for (const [name, run, expected] of rejections) {
    const message = run();
    if (message === undefined) {
      failures.push(`${name}: accepted, expected rejection with ${JSON.stringify(expected)}`);
    } else if (message !== expected) {
      failures.push(`${name}: rejected with ${JSON.stringify(message)}, expected ${JSON.stringify(expected)}`);
    }
  }
  for (const [name, run] of acceptances) {
    const message = run();
    if (message !== undefined) failures.push(`${name}: rejected a good input with ${JSON.stringify(message)}`);
  }
  // The script itself, as the gate runs it, on the tree holding the writer.
  if (spawned.status === 0) failures.push('spawned run on a tree with a nested writer exited 0, expected non-zero');
  if (spawned.stderr !== spawnedMessage) {
    failures.push(`spawned run printed ${JSON.stringify(spawned.stderr)}, expected ${JSON.stringify(spawnedMessage)}`);
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`check-no-storage-writes self-test failed: ${failure}`);
    process.exit(1);
  }
  console.log(
    `check-no-storage-writes self-test passed: ${rejections.length} bad inputs rejected with the expected message, ${acceptances.length} good inputs accepted, spawned failure exited non-zero`,
  );
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  main();
}
