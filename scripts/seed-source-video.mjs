// Puts the committed fixture in the bucket and prints its storage key on
// stdout, so the smoke can consume it. A stand-in for the upload path (S6).
//
// It also seeds a non-video under an `.mp4` name, generated here rather than
// committed, so the smoke can drive a request to FAILED by validation
// rejection. stdout is exactly two lines: the video key, then that key.
//
// The transfer runs aws-cli in the storage-init image rather than an SDK:
// this repository has no package.json, and the S3 API is the port (AD-014). The file is named explicitly rather than
// the directory globbed, so exFAT `._*` sidecars are never uploaded. The key
// is fixed, so a second run overwrites the same object instead of adding one.
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = 'fixtures/sample-8s.mp4';
const BUCKET = 'fiapx';
const KEY = 'sources/sample-8s.mp4';
const NOT_A_VIDEO_KEY = 'sources/not-a-video.mp4';
const NOT_A_VIDEO = 'This is plain text under an .mp4 name. The Worker must reject it.\n';
const STORAGE = 'object storage (compose service "storage", http://storage:9000)';

function fail(message, detail) {
  console.error(`seed-source-video: ${message}`);
  if (detail) console.error(detail.trim());
  process.exit(1);
}

// Runs aws-cli against the stack without starting anything: --no-deps keeps
// Compose from bringing a stopped storage service up behind the developer's
// back. -T keeps stdin a pipe, so an upload can read from it.
function aws(args, extraDockerArgs = [], input = undefined) {
  const result = spawnSync(
    'docker',
    ['compose', 'run', '--rm', '--no-deps', '-T', ...extraDockerArgs, '--entrypoint', 'aws', 'storage-init', ...args],
    { cwd: REPO_ROOT, encoding: 'utf8', input },
  );
  if (result.error) fail(`could not run docker: ${result.error.message}`);
  return result;
}

let size;
try {
  size = statSync(join(REPO_ROOT, FIXTURE)).size;
} catch {
  fail(`fixture ${FIXTURE} is missing`);
}
if (size === 0) fail(`fixture ${FIXTURE} is empty`);

// head-bucket fails against a stopped server, and it also proves the
// bootstrap created the bucket.
const probe = aws(['s3api', 'head-bucket', '--bucket', BUCKET]);
if (probe.status !== 0) {
  const output = probe.stdout + probe.stderr;
  if (/Could not connect to the endpoint URL|Name or service not known|Connection refused|timed out/i.test(output)) {
    fail(`${STORAGE} is unreachable - start the stack with \`docker compose up -d --wait\``, output);
  }
  fail(`bucket ${BUCKET} is not available in ${STORAGE}`, output);
}

const copy = aws(
  ['s3', 'cp', '--only-show-errors', `/fixtures/${FIXTURE.split('/').pop()}`, `s3://${BUCKET}/${KEY}`],
  ['-v', `${join(REPO_ROOT, FIXTURE)}:/fixtures/${FIXTURE.split('/').pop()}:ro`],
);
if (copy.status !== 0) {
  fail(`upload to ${STORAGE} failed for ${BUCKET}/${KEY}`, copy.stdout + copy.stderr);
}

const pipe = aws(['s3', 'cp', '--only-show-errors', '-', `s3://${BUCKET}/${NOT_A_VIDEO_KEY}`], [], NOT_A_VIDEO);
if (pipe.status !== 0) {
  fail(`upload to ${STORAGE} failed for ${BUCKET}/${NOT_A_VIDEO_KEY}`, pipe.stdout + pipe.stderr);
}

console.log(KEY);
console.log(NOT_A_VIDEO_KEY);
