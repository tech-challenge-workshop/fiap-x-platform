// Fails when the Worker's CPU limit and its FFmpeg thread count disagree.
//
// Both come from WORKER_CPUS, but Compose cannot compute, so "one value" is a
// convention. This reads the output of `docker compose config` rather than the
// template, so it checks the substitution that actually happened, including
// any WORKER_CPUS set in .env or the shell.
//
// `--self-test` needs no Docker: it feeds the two comparisons below failing
// and boundary values and requires the exact message for each.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(`check-worker-sizing: ${message}`);
  process.exit(1);
}

// RM-05 AC3: the thread count must be a positive integer equal to the CPU
// limit. Returns the failure message, or undefined when they agree.
function pairingProblem(cpus, threads) {
  const threadCount = Number(threads);
  if (!Number.isInteger(threadCount) || threadCount < 1) {
    return `FFMPEG_THREADS must be a positive integer, got "${threads}" (cpus is ${cpus})`;
  }
  if (Number(cpus) !== threadCount) {
    return `worker cpus is ${cpus} but FFMPEG_THREADS is ${threads}; both must come from WORKER_CPUS`;
  }
  return undefined;
}

// Docker refuses to create a container whose `cpus` exceeds the engine's CPU
// count, so a limit the engine cannot grant fails here, before `up`, naming
// both values rather than surfacing as a daemon error halfway through a start.
function engineCapacityProblem(cpus, engineCpus) {
  if (Number(cpus) > engineCpus) {
    return `WORKER_CPUS is ${cpus} but the Docker engine has only ${engineCpus} CPUs; set WORKER_CPUS to at most ${engineCpus}`;
  }
  return undefined;
}

function main() {
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

  const pairing = pairingProblem(cpus, threads);
  if (pairing) fail(pairing);

  const engine = spawnSync('docker', ['info', '--format', '{{.NCPU}}'], { encoding: 'utf8' });
  if (engine.error) fail(`could not run docker info: ${engine.error.message}`);
  if (engine.status !== 0) fail(`docker info failed, so the engine's CPU count is unknown:\n${engine.stderr.trim()}`);
  const engineCpus = Number(engine.stdout.trim());
  if (!Number.isInteger(engineCpus) || engineCpus < 1) {
    fail(`docker info reported the engine's CPU count as "${engine.stdout.trim()}", expected a positive integer`);
  }
  const capacity = engineCapacityProblem(cpus, engineCpus);
  if (capacity) fail(capacity);

  console.log(`worker cpus ${cpus} matches FFMPEG_THREADS ${threads}, within the engine's ${engineCpus} CPUs`);
}

// Values are shaped as `docker compose config --format json` renders them:
// `cpus` a number, FFMPEG_THREADS a string.
function selfTest() {
  const rejections = [
    ['threads 4 with cpus 2', () => pairingProblem(2, '4'),
      'worker cpus is 2 but FFMPEG_THREADS is 4; both must come from WORKER_CPUS'],
    ['threads 1 with cpus 2', () => pairingProblem(2, '1'),
      'worker cpus is 2 but FFMPEG_THREADS is 1; both must come from WORKER_CPUS'],
    ['threads 1.5', () => pairingProblem(1.5, '1.5'),
      'FFMPEG_THREADS must be a positive integer, got "1.5" (cpus is 1.5)'],
    ['threads not a number', () => pairingProblem(2, 'two'),
      'FFMPEG_THREADS must be a positive integer, got "two" (cpus is 2)'],
    ['threads 0', () => pairingProblem(0, '0'),
      'FFMPEG_THREADS must be a positive integer, got "0" (cpus is 0)'],
    ['threads -1', () => pairingProblem(-1, '-1'),
      'FFMPEG_THREADS must be a positive integer, got "-1" (cpus is -1)'],
    ['cpus 16 on a 10-CPU engine', () => engineCapacityProblem(16, 10),
      'WORKER_CPUS is 16 but the Docker engine has only 10 CPUs; set WORKER_CPUS to at most 10'],
    ['cpus 11 on a 10-CPU engine (engine + 1)', () => engineCapacityProblem(11, 10),
      'WORKER_CPUS is 11 but the Docker engine has only 10 CPUs; set WORKER_CPUS to at most 10'],
  ];
  const acceptances = [
    ['cpus 2 with threads 2', () => pairingProblem(2, '2')],
    ['cpus 10 with threads 10', () => pairingProblem(10, '10')],
    ['cpus 2 on a 10-CPU engine', () => engineCapacityProblem(2, 10)],
    ['cpus 9 on a 10-CPU engine (engine - 1)', () => engineCapacityProblem(9, 10)],
    ['cpus 10 on a 10-CPU engine (equal)', () => engineCapacityProblem(10, 10)],
  ];

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

  if (failures.length > 0) {
    for (const failure of failures) console.error(`check-worker-sizing self-test failed: ${failure}`);
    process.exit(1);
  }
  console.log(
    `check-worker-sizing self-test passed: ${rejections.length} bad inputs rejected with the expected message, ${acceptances.length} good inputs accepted`,
  );
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  main();
}
