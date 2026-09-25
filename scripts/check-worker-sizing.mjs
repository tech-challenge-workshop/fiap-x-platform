// Fails when the Worker's CPU limit and its FFmpeg thread count disagree.
//
// Both come from WORKER_CPUS, but Compose cannot compute, so "one value" is a
// convention. This reads the output of `docker compose config` rather than the
// template, so it checks the substitution that actually happened, including
// any WORKER_CPUS set in .env or the shell.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(`check-worker-sizing: ${message}`);
  process.exit(1);
}

const rendered = spawnSync('docker', ['compose', 'config', '--format', 'json'], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
});
if (rendered.error) fail(`could not run docker: ${rendered.error.message}`);
if (rendered.status !== 0) fail(`docker compose config failed:\n${rendered.stderr.trim()}`);

const worker = JSON.parse(rendered.stdout).services?.worker;
if (!worker) fail('the rendered configuration has no worker service');

const cpus = worker.cpus;
const threads = worker.environment?.FFMPEG_THREADS;
if (cpus === undefined) fail('the worker declares no top-level `cpus` limit');
if (threads === undefined) fail('the worker has no FFMPEG_THREADS');

const cpuCount = Number(cpus);
const threadCount = Number(threads);
if (!Number.isInteger(threadCount) || threadCount < 1) {
  fail(`FFMPEG_THREADS must be a positive integer, got "${threads}" (cpus is ${cpus})`);
}
if (cpuCount !== threadCount) {
  fail(`worker cpus is ${cpus} but FFMPEG_THREADS is ${threads}; both must come from WORKER_CPUS`);
}

console.log(`worker cpus ${cpus} matches FFMPEG_THREADS ${threads}`);
