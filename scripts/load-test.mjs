// Drives N videos through the whole pipeline at the same time and reports how
// each one ended (OBS-68..71):
//
//   node scripts/load-test.mjs --videos 6
//   node scripts/load-test.mjs --videos 3 --timeout-seconds 180
//   node scripts/load-test.mjs --base-url http://localhost:3000 --token-cmd "node scripts/get-token.mjs bob"
//
// It asks for one token (by running --token-cmd, get-token.mjs for alice by
// default), then fires N pipelines concurrently: start an upload of
// fixtures/sample-8s.mp4, PUT each part to its presigned URL, confirm with an
// Idempotency-Key of its own, and poll the request through the API until it
// is terminal or its per-video timeout expires. It prints one line per video
// with its latency, then the count per final status, and exits 1 naming every
// video that did not reach COMPLETED. It only ever reads its own requests, by
// the ids its confirmations returned, so whatever else the stack holds cannot
// change the verdict.
//
// This is a measurement tool, not a gate: it speaks the API's public contract
// with its own fetch loop and never imports the smoke, which stays frozen.
//
// `--self-test` needs no stack: it drives the same functions with an injected
// HTTP driver (all N uploads in flight before any completes, the status
// counts, a stuck video named on exit, one Idempotency-Key per video) and
// spawns this script against an unreachable API, which must exit non-zero.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = dirname(SELF);
const FIXTURE_PATH = join(SCRIPTS_DIR, '..', 'fixtures', 'sample-8s.mp4');
const DEFAULT_BASE_URL = process.env.API_URL ?? 'http://localhost:3000';
const DEFAULT_TOKEN_CMD = `"${process.execPath}" "${join(SCRIPTS_DIR, 'get-token.mjs')}" alice`;
const DEFAULTS = { videos: 6, timeoutSeconds: 120 };
const MAX_VIDEOS = 50;
const POLL_INTERVAL_MS = 1000;
const REQUEST_TIMEOUT_MS = 30000;
const TERMINAL = new Set(['COMPLETED', 'FAILED']);
const USAGE =
  'usage: node scripts/load-test.mjs [--videos N (1..50, default 6)] [--timeout-seconds S (default 120)] [--base-url URL] [--token-cmd CMD]';

// Returns { options } or { error } with the message to print. OBS-68: N is an
// integer from 1 to 50.
export function parseArgs(argv) {
  const options = { ...DEFAULTS, baseUrl: DEFAULT_BASE_URL, tokenCmd: DEFAULT_TOKEN_CMD };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!['--videos', '--timeout-seconds', '--base-url', '--token-cmd'].includes(flag)) {
      return { error: `unknown argument "${flag}"` };
    }
    if (value === undefined) return { error: `${flag} needs a value` };
    i += 1;
    if (flag === '--videos') {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > MAX_VIDEOS) {
        return { error: `--videos must be an integer from 1 to ${MAX_VIDEOS}, got "${value}"` };
      }
      options.videos = Number(value);
    } else if (flag === '--timeout-seconds') {
      if (!/^\d+$/.test(value) || Number(value) < 1) {
        return { error: `--timeout-seconds must be a positive integer, got "${value}"` };
      }
      options.timeoutSeconds = Number(value);
    } else if (flag === '--base-url') {
      options.baseUrl = value.replace(/\/+$/, '');
    } else {
      options.tokenCmd = value;
    }
  }
  return { options };
}

// The real HTTP driver: status plus the body parsed as JSON when it is JSON.
// A network failure is returned as status 0 with the cause, so the video that
// hit it is named instead of the run dying.
async function httpFetch(method, url, { headers = {}, body } = {}) {
  try {
    const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, json, text };
  } catch (err) {
    return { status: 0, json: undefined, text: `unreachable (${err.cause?.code ?? err.message})` };
  }
}

// One video's pipeline. Resolves (never rejects) to
// { index, id, status, latencyMs, problem } where `problem` is undefined only
// when the request reached COMPLETED.
async function driveVideo(index, ctx) {
  const { baseUrl, token, bytes, http, now, sleep, timeoutMs, pollMs, runId } = ctx;
  const started = now();
  const auth = { Authorization: `Bearer ${token}` };
  const result = (fields) => ({ index, id: undefined, status: undefined, latencyMs: now() - started, ...fields });

  const start = await http('POST', `${baseUrl}/uploads`, {
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: `load-${index}.mp4`, contentType: 'video/mp4', sizeBytes: bytes.length }),
  });
  if (start.status !== 201 || typeof start.json?.uploadId !== 'string' || !Array.isArray(start.json.parts)) {
    return result({ problem: `upload start returned ${start.status}: ${start.text.slice(0, 200)}` });
  }
  const { uploadId, partSize, parts } = start.json;
  for (const { partNumber, url } of parts) {
    const put = await http('PUT', url, { body: bytes.subarray((partNumber - 1) * partSize, partNumber * partSize) });
    if (put.status !== 200) return result({ problem: `PUT of part ${partNumber} returned ${put.status}` });
  }

  const confirm = await http('POST', `${baseUrl}/uploads/${uploadId}/complete`, {
    headers: { ...auth, 'Idempotency-Key': `load-${runId}-${index}` },
  });
  const id = confirm.json?.processingRequestId;
  if (confirm.status !== 201 || typeof id !== 'string') {
    return result({ problem: `confirmation returned ${confirm.status}: ${confirm.text.slice(0, 200)}` });
  }

  const deadline = started + timeoutMs;
  let status = confirm.json.status;
  for (;;) {
    const read = await http('GET', `${baseUrl}/processing-requests/${id}`, { headers: auth });
    if (read.status !== 200) return result({ id, status, problem: `status read returned ${read.status}` });
    status = read.json?.status;
    if (TERMINAL.has(status)) {
      return result({ id, status, problem: status === 'COMPLETED' ? undefined : `ended ${status}` });
    }
    if (now() >= deadline) {
      return result({ id, status, problem: `still ${status} after ${Math.round(timeoutMs / 1000)} s` });
    }
    await sleep(pollMs);
  }
}

// OBS-68: all N pipelines are started together; none waits for another.
export function runLoad(videos, ctx) {
  return Promise.all(Array.from({ length: videos }, (_, i) => driveVideo(i + 1, ctx)));
}

// The printed report and the verdict. OBS-70: every video that did not reach
// COMPLETED is named with what happened to it.
export function summarize(results) {
  const lines = [' #  processingRequestId                   status      latency'];
  for (const r of results) {
    lines.push(
      `${String(r.index).padStart(2)}  ${(r.id ?? '-').padEnd(36)}  ${(r.status ?? '-').padEnd(10)}  ${(r.latencyMs / 1000).toFixed(1)} s`,
    );
  }
  const counts = {};
  for (const r of results) {
    const key = r.status ?? 'NO_REQUEST';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const countLine = Object.keys(counts)
    .sort()
    .map((key) => `${key} ${counts[key]}/${results.length}`)
    .join(', ');
  const failures = results
    .filter((r) => r.problem !== undefined)
    .map((r) => `video #${r.index}${r.id ? ` (${r.id})` : ''}: ${r.problem}`);
  return { lines, counts, countLine, failures };
}

function tokenFrom(cmd) {
  const run = spawnSync(cmd, { shell: true, encoding: 'utf8' });
  const token = (run.stdout ?? '').trim();
  if (run.status !== 0 || token === '') {
    throw new Error(`the token command failed (exit ${run.status}): ${(run.stderr ?? '').trim() || 'no token printed'}`);
  }
  return token;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) {
    console.error(`load-test: ${parsed.error}\n${USAGE}`);
    process.exit(2);
  }
  const { videos, timeoutSeconds, baseUrl, tokenCmd } = parsed.options;
  let token;
  try {
    token = tokenFrom(tokenCmd);
  } catch (err) {
    console.error(`load-test: ${err.message}`);
    process.exit(1);
  }
  const runId = randomUUID();
  console.log(`load-test: ${videos} concurrent videos against ${baseUrl}, run ${runId}, timeout ${timeoutSeconds} s per video`);
  const results = await runLoad(videos, {
    baseUrl,
    token,
    bytes: readFileSync(FIXTURE_PATH),
    http: httpFetch,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timeoutMs: timeoutSeconds * 1000,
    pollMs: POLL_INTERVAL_MS,
    runId,
  });
  const { lines, countLine, failures } = summarize(results);
  for (const line of lines) console.log(line);
  console.log(`load-test: ${countLine}`);
  if (failures.length > 0) {
    console.error(`load-test: ${failures.length} of ${videos} videos did not complete:`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  console.log(`load-test: all ${videos} videos COMPLETED`);
}

// A scripted API that records every call. Uploads are numbered in the order
// they start; status reads for request n walk through statuses(n) and then
// repeat its last entry. onStart(n), when given, runs before an upload start
// answers.
function fakeApi({ statuses, onStart }) {
  const calls = [];
  const byUpload = new Map();
  const reads = new Map();
  let uploads = 0;
  const http = async (method, url, init = {}) => {
    calls.push({ method, url, headers: init.headers ?? {}, body: init.body });
    if (method === 'POST' && url.endsWith('/uploads')) {
      uploads += 1;
      const n = uploads;
      if (onStart) await onStart(n);
      const uploadId = `up-${n}`;
      byUpload.set(uploadId, n);
      const parts = [{ partNumber: 1, url: `http://s/${uploadId}/1` }, { partNumber: 2, url: `http://s/${uploadId}/2` }];
      return { status: 201, json: { uploadId, partSize: 4, parts }, text: '' };
    }
    if (method === 'PUT') return { status: 200, json: undefined, text: '' };
    if (method === 'POST' && url.endsWith('/complete')) {
      const n = byUpload.get(url.split('/').at(-2));
      return { status: 201, json: { processingRequestId: `req-${n}`, status: 'RECEIVED' }, text: '' };
    }
    if (method === 'GET') {
      const id = url.split('/').at(-1);
      const n = Number(id.slice(4));
      const seen = reads.get(id) ?? 0;
      reads.set(id, seen + 1);
      const list = statuses(n);
      return { status: 200, json: { processingRequestId: id, status: list[Math.min(seen, list.length - 1)] }, text: '' };
    }
    throw new Error(`unexpected call ${method} ${url}`);
  };
  return { http, calls };
}

// A clock that only moves when the pipeline sleeps, so a timeout is reached
// deterministically and instantly.
function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

async function selfTest() {
  const failures = [];
  let passed = 0;
  const check = (name, ok, detail) => {
    if (ok) passed += 1;
    else failures.push(`${name}: ${detail}`);
  };
  const bytes = Buffer.from('0123456789');
  const ctxFor = (api, clock, timeoutMs = 5000) => ({
    baseUrl: 'http://api', token: 'tok', bytes, http: api.http, now: clock.now, sleep: clock.sleep, timeoutMs, pollMs: 1000, runId: 'run',
  });

  // OBS-68: the bounds of N, the defaults, and near misses on each side.
  const defaults = parseArgs([]).options;
  check('defaults', defaults?.videos === 6 && defaults?.timeoutSeconds === 120, `got ${JSON.stringify(defaults)}`);
  const accepted = [['1', 1], ['50', 50]].map(([v, n]) => parseArgs(['--videos', v]).options?.videos === n);
  check('--videos 1 and 50 accepted', accepted.every(Boolean), `accepted ${JSON.stringify(accepted)}`);
  for (const bad of ['0', '51', '2.5', 'six', '-1']) {
    const { error } = parseArgs(['--videos', bad]);
    check(`--videos ${bad} rejected`, error === `--videos must be an integer from 1 to 50, got "${bad}"`, `got ${JSON.stringify(error)}`);
  }
  const zeroTimeout = parseArgs(['--timeout-seconds', '0']).error;
  check('--timeout-seconds 0 rejected', zeroTimeout === '--timeout-seconds must be a positive integer, got "0"', `got ${JSON.stringify(zeroTimeout)}`);

  // OBS-68: all N uploads are in flight before any of them completes. Each
  // start waits until every video has started; a sequential driver would
  // never get past the first and the guard below would fire.
  {
    const N = 5;
    let startedCount = 0;
    let releaseAll;
    const allStarted = new Promise((resolve) => { releaseAll = resolve; });
    const api = fakeApi({
      statuses: () => ['COMPLETED'],
      onStart: async () => {
        startedCount += 1;
        if (startedCount === N) releaseAll();
        let timer;
        const guard = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`only ${startedCount} of ${N} uploads in flight`)), 1000); });
        try {
          await Promise.race([allStarted, guard]);
        } finally {
          clearTimeout(timer);
        }
      },
    });
    let outcome;
    try {
      const results = await runLoad(N, ctxFor(api, fakeClock()));
      const firstRead = api.calls.findIndex((c) => c.method === 'GET');
      const startsBeforeFirstRead = api.calls.slice(0, firstRead).filter((c) => c.method === 'POST' && c.url.endsWith('/uploads')).length;
      outcome = startsBeforeFirstRead === N && results.every((r) => r.status === 'COMPLETED')
        ? undefined
        : `${startsBeforeFirstRead} of ${N} uploads started before the first status read`;
    } catch (err) {
      outcome = err.message;
    }
    check('all N in flight before any completes', outcome === undefined, outcome);
  }

  // One Idempotency-Key per video, each part PUT with its own slice, every
  // API call carrying the one token.
  {
    const api = fakeApi({ statuses: () => ['COMPLETED'] });
    await runLoad(3, ctxFor(api, fakeClock()));
    const keys = api.calls.filter((c) => c.url.endsWith('/complete')).map((c) => c.headers['Idempotency-Key']);
    check('one Idempotency-Key per video', JSON.stringify(keys.slice().sort()) === JSON.stringify(['load-run-1', 'load-run-2', 'load-run-3']), `got ${JSON.stringify(keys)}`);
    const puts = api.calls.filter((c) => c.method === 'PUT' && c.url.startsWith('http://s/up-1/')).map((c) => Buffer.from(c.body).toString());
    check('parts PUT with their slices', JSON.stringify(puts) === JSON.stringify(['0123', '4567']), `got ${JSON.stringify(puts)}`);
    const tokens = new Set(api.calls.filter((c) => c.method !== 'PUT').map((c) => c.headers.Authorization));
    check('one token for every API call', tokens.size === 1 && tokens.has('Bearer tok'), `got ${JSON.stringify([...tokens])}`);
  }

  // Aggregation: the status counts and the failure list for a mixed run.
  // A FAILED video is terminal but did not complete, so it is named.
  {
    const api = fakeApi({ statuses: (n) => (n === 2 ? ['PROCESSING', 'FAILED'] : ['PROCESSING', 'COMPLETED']) });
    const summary = summarize(await runLoad(3, ctxFor(api, fakeClock())));
    check('status counts', summary.countLine === 'COMPLETED 2/3, FAILED 1/3', `got ${JSON.stringify(summary.countLine)}`);
    check('FAILED video named', JSON.stringify(summary.failures) === JSON.stringify(['video #2 (req-2): ended FAILED']), `got ${JSON.stringify(summary.failures)}`);
    check('one table line per video', summary.lines.length === 4 && /^ 2 {2}req-2 +FAILED +\d+\.\d s$/.test(summary.lines[2]), `got ${JSON.stringify(summary.lines)}`);
  }

  // OBS-70: a video still in flight at its timeout is named with the status
  // it was stuck in; the others complete.
  {
    const api = fakeApi({ statuses: (n) => (n === 3 ? ['PROCESSING'] : ['COMPLETED']) });
    const summary = summarize(await runLoad(3, ctxFor(api, fakeClock(), 120000)));
    check('stuck video named', JSON.stringify(summary.failures) === JSON.stringify(['video #3 (req-3): still PROCESSING after 120 s']), `got ${JSON.stringify(summary.failures)}`);
    check('stuck run counts', summary.countLine === 'COMPLETED 2/3, PROCESSING 1/3', `got ${JSON.stringify(summary.countLine)}`);
  }

  // A clean run has no failures: the good case the rejections are measured against.
  {
    const api = fakeApi({ statuses: () => ['VALIDATING', 'PROCESSING', 'COMPLETED'] });
    const summary = summarize(await runLoad(2, ctxFor(api, fakeClock())));
    check('clean run passes', summary.failures.length === 0 && summary.countLine === 'COMPLETED 2/2', `got ${JSON.stringify(summary)}`);
  }

  // OBS-70/71: the script itself, against an API nobody listens on, exits 1
  // naming each video; an out-of-range N exits 2 with the message.
  {
    const tokenCmd = `"${process.execPath}" -e "console.log('t')"`;
    const run = spawnSync(process.execPath, [SELF, '--videos', '2', '--base-url', 'http://127.0.0.1:9', '--token-cmd', tokenCmd], { encoding: 'utf8' });
    const named = /video #1: upload start returned 0/.test(run.stderr) && /video #2: upload start returned 0/.test(run.stderr);
    check('spawned run against a dead API exits 1 naming each video', run.status === 1 && named, `exit ${run.status}, stderr ${JSON.stringify(run.stderr)}`);
    const usage = spawnSync(process.execPath, [SELF, '--videos', '51'], { encoding: 'utf8' });
    check('spawned run with --videos 51 exits 2', usage.status === 2 && usage.stderr.startsWith('load-test: --videos must be an integer from 1 to 50, got "51"'), `exit ${usage.status}, stderr ${JSON.stringify(usage.stderr)}`);
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`load-test self-test failed: ${failure}`);
    process.exit(1);
  }
  console.log(`load-test self-test passed: ${passed} assertions`);
}

if (process.argv.includes('--self-test')) {
  await selfTest();
} else {
  await main();
}
