// Puts the committed fixture in the bucket and prints its storage key on
// stdout, so the smoke can consume it. A stand-in for the upload path (S6).
//
// The transfer runs `mc` in the minio-init image rather than an SDK: this
// repository has no package.json. The file is named explicitly rather than
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
const STORAGE = 'object storage (compose service "minio", http://minio:9000)';

function fail(message, detail) {
  console.error(`seed-source-video: ${message}`);
  if (detail) console.error(detail.trim());
  process.exit(1);
}

// Runs mc against the stack without starting anything: --no-deps keeps
// Compose from bringing a stopped minio up behind the developer's back.
function mc(args, extraDockerArgs = []) {
  const result = spawnSync(
    'docker',
    ['compose', 'run', '--rm', '--no-deps', ...extraDockerArgs, '--entrypoint', 'mc', 'minio-init', ...args],
    { cwd: REPO_ROOT, encoding: 'utf8' },
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

// `mc ping` reports success against a stopped server; `stat` on the bucket
// does not, and it also proves the bootstrap created the bucket.
const probe = mc(['stat', `local/${BUCKET}`]);
if (probe.status !== 0) {
  const output = probe.stdout + probe.stderr;
  if (/dial tcp|no such host|connection refused|i\/o timeout/.test(output)) {
    fail(`${STORAGE} is unreachable - start the stack with \`docker compose up -d --wait\``, output);
  }
  fail(`bucket ${BUCKET} is not available in ${STORAGE}`, output);
}

const copy = mc(
  ['cp', '--quiet', `/fixtures/${FIXTURE.split('/').pop()}`, `local/${BUCKET}/${KEY}`],
  ['-v', `${join(REPO_ROOT, FIXTURE)}:/fixtures/${FIXTURE.split('/').pop()}:ro`],
);
if (copy.status !== 0) {
  fail(`upload to ${STORAGE} failed for ${BUCKET}/${KEY}`, copy.stdout + copy.stderr);
}

console.log(KEY);
