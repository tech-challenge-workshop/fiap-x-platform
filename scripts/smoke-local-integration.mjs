import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPTS_DIR, '..');
const BUCKET = 'fiapx';

// fixtures/README.md: sample-8s.mp4 lasts 8 seconds and the Worker extracts
// one frame per second, so its archive must hold exactly 8 entries.
const FIXTURE_SECONDS = 8;
const FRAMES_PER_SECOND = 1;
const EXPECTED_FRAMES = FIXTURE_SECONDS * FRAMES_PER_SECOND;

// processing-catalog src/domain/failure-reason.ts: the user-facing text the
// Catalog maps from FORMATO_INVALIDO and carries on the terminal event.
const FORMATO_INVALIDO_REASON = 'O arquivo enviado nao e um video MP4 ou MOV valido.';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const CATALOG_URL = process.env.CATALOG_URL ?? 'http://localhost:3001';
const NOTIFICATION_URL = process.env.NOTIFICATION_URL ?? 'http://localhost:3003';
const STORAGE_URL = process.env.STORAGE_URL ?? 'http://localhost:9000';

const HEALTH_TIMEOUT_MS = Number(process.env.HEALTH_TIMEOUT_MS ?? 30000);
const POLL_TIMEOUT_MS = Number(process.env.POLL_TIMEOUT_MS ?? 60000);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 1000);

// Thrown when a file carries no End of Central Directory record: the archive
// is unreadable, which is a different failure from a readable empty one.
class UnreadableArchiveError extends Error {}

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_SIZE = 22;
const MAX_ZIP_COMMENT = 0xffff;

// Counts an archive's entries from its End of Central Directory record, so
// the repository stays dependency-free. The record is the last 22 bytes plus
// an optional comment of up to 64 KiB, so the scan goes backwards from the end
// and stops once no comment could be that long. Total entries is the 16-bit
// field at offset 10.
function countZipEntries(path) {
  const bytes = readFileSync(path);
  const lowest = Math.max(0, bytes.length - EOCD_SIZE - MAX_ZIP_COMMENT);
  for (let offset = bytes.length - EOCD_SIZE; offset >= lowest; offset -= 1) {
    if (bytes.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return bytes.readUInt16LE(offset + 10);
    }
  }
  throw new UnreadableArchiveError(`${path} has no End of Central Directory record`);
}

// RM-06 AC4: the smoke leaves no downloaded artefact behind.
function assertScratchRemoved(dir, stillExists) {
  if (stillExists) throw new Error(`Downloaded artefact left behind: ${dir} still exists after cleanup`);
}

// Runs fn in a fresh temporary directory, removes the directory whatever the
// outcome, and then checks it is gone. A leak is reported alongside, never
// instead of, the failure that fn raised.
function withScratchDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'fiapx-smoke-'));
  let result;
  let failure;
  try {
    result = fn(dir);
  } catch (err) {
    failure = err;
  }
  rmSync(dir, { recursive: true, force: true });
  try {
    assertScratchRemoved(dir, existsSync(dir));
  } catch (leak) {
    throw failure ? new Error(`${failure.message}\n${leak.message}`) : leak;
  }
  if (failure) throw failure;
  return result;
}

// A failed transfer means the archive is absent, the first of three causes.
function assertArchiveTransferred(zipKey, transfer) {
  if (transfer.status !== 0) {
    const cause = transfer.stderr.toString().trim().split('\n').pop();
    throw new Error(`Archive absent: ${BUCKET}/${zipKey} could not be transferred from storage (${cause})`);
  }
}

// Unreadable and empty are the other two causes; a readable archive with the
// wrong count names both numbers.
function assertArchiveContents(zipKey, path) {
  let entries;
  try {
    entries = countZipEntries(path);
  } catch (err) {
    if (err instanceof UnreadableArchiveError) {
      throw new Error(`Archive unreadable: ${BUCKET}/${zipKey} has no End of Central Directory record`);
    }
    throw err;
  }
  if (entries === 0) {
    throw new Error(`Archive empty: ${BUCKET}/${zipKey} holds 0 entries, expected ${EXPECTED_FRAMES}`);
  }
  if (entries !== EXPECTED_FRAMES) {
    throw new Error(`Archive frame count mismatch: ${BUCKET}/${zipKey} holds ${entries} entries, expected ${EXPECTED_FRAMES}`);
  }
  return entries;
}

// Downloads the archive with mc (no SDK, no package.json) into a temporary
// directory that is removed whatever the outcome, then asserts its entry
// count. Absent, unreadable and empty are reported as three distinct causes.
function assertArchiveFrameCount(zipKey) {
  const transfer = spawnSync(
    'docker',
    ['compose', 'run', '--rm', '--no-deps', '-T', '--entrypoint', 'mc', 'minio-init', 'cat', `local/${BUCKET}/${zipKey}`],
    { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 },
  );
  if (transfer.error) throw new Error(`Could not run docker to fetch the archive: ${transfer.error.message}`);
  assertArchiveTransferred(zipKey, transfer);

  return withScratchDir((dir) => {
    const path = join(dir, 'frames.zip');
    writeFileSync(path, transfer.stdout);
    return assertArchiveContents(zipKey, path);
  });
}

function dockerCompose(args, input) {
  const result = spawnSync('docker', ['compose', ...args], { cwd: REPO_ROOT, encoding: 'utf8', input });
  if (result.error) throw new Error(`Could not run docker: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`docker compose ${args[0]} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

// A rejected request must leave nothing under its archive prefix.
function assertNoArchiveListing(id, listing) {
  if (listing) throw new Error(`Rejected request ${id} left an archive under zips/${id}/:\n${listing}`);
}

function assertNoArchive(id) {
  const prefix = `local/${BUCKET}/zips/${id}/`;
  const listing = dockerCompose(['run', '--rm', '--no-deps', '-T', '--entrypoint', 'mc', 'minio-init', 'ls', '--recursive', prefix]).trim();
  assertNoArchiveListing(id, listing);
}

// The non-video must settle FAILED with FORMATO_INVALIDO; COMPLETED or any
// other failure code fails naming what was observed.
function assertRejected(id, request) {
  if (request.status !== 'FAILED' || request.failureCode !== 'FORMATO_INVALIDO') {
    throw new Error(`Request ${id} for the non-video: expected FAILED (FORMATO_INVALIDO), observed ${describe(request)}`);
  }
}

// The video must settle COMPLETED; anything else fails naming what was observed.
function assertCompleted(id, request) {
  if (request.status !== 'COMPLETED') {
    throw new Error(`Request ${id} for the video: expected COMPLETED, observed ${describe(request)}`);
  }
}

// Every run creates a new request and the archive key is scoped to it, so a
// second run can never assert against the previous run's archive.
function assertArchiveKeyScoped(id, zipKey) {
  if (typeof zipKey !== 'string' || !zipKey.startsWith(`zips/${id}/`)) {
    throw new Error(`Catalog reported zipStorageKey ${JSON.stringify(zipKey)}, expected a key under zips/${id}/`);
  }
}

// RM-19 AC2: the Catalog stores the code, not the sentence, so the exact
// sentence is observed on the Notification delivery record.
function assertDeliverySentence(id, delivery) {
  if (delivery.status !== 'FAILED' || delivery.failureReason !== FORMATO_INVALIDO_REASON) {
    throw new Error(
      `Delivery for ${id}: expected FAILED with ${JSON.stringify(FORMATO_INVALIDO_REASON)}, observed ${delivery.status} with ${JSON.stringify(delivery.failureReason)}`,
    );
  }
}

// Exactly one: none means the terminal event never arrived, two means it was
// delivered twice.
function assertSingleDelivery(id, deliveries) {
  if (deliveries !== 1) {
    throw new Error(`Delivery for ${id}: expected exactly 1 record, found ${deliveries}`);
  }
}

// The HTTP view returns one record, so it cannot show a duplicate; the count
// comes from the Notification schema. The id travels as a psql variable,
// never as SQL text.
function countDeliveries(id) {
  const out = dockerCompose(
    ['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'fiapx', '-tA', '-v', 'ON_ERROR_STOP=1', '-v', `id=${id}`],
    "SELECT count(*) FROM notification.delivery_record WHERE processing_request_id = :'id';\n",
  );
  return Number(out.trim());
}

// The bucket must refuse a request that carries no credentials (RM-01 AC3).
// The bootstrap asserts this once at start; this proves it from outside, at
// the end state, so a bucket loosened afterwards turns the smoke red.
function assertAnonymousRefused(url, status) {
  if (status >= 200 && status < 300) {
    throw new Error(`Anonymous access allowed: GET ${url} returned ${status}; the bucket must refuse requests without credentials`);
  }
  if (status !== 403) {
    throw new Error(`Anonymous GET ${url} returned ${status}, expected 403`);
  }
}

// A plain fetch carries no S3 signature, so it is an anonymous request.
async function checkAnonymousAccess(videoKey) {
  for (const url of [`${STORAGE_URL}/${BUCKET}/${videoKey}`, `${STORAGE_URL}/${BUCKET}/`]) {
    const res = await fetch(url);
    await res.arrayBuffer();
    assertAnonymousRefused(url, res.status);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForApiHealth() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_URL}/health`);
      if (res.ok) return;
    } catch {
      // keep polling
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('API health check timed out');
}

// The seed is idempotent (fixed keys), so running it here costs two uploads
// and means the smoke never depends on someone having seeded first. It prints
// the video's key, then the key of an object that is not a video.
function seedSources() {
  const result = spawnSync(process.execPath, [join(SCRIPTS_DIR, 'seed-source-video.mjs')], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Seeding the source objects failed:\n${(result.stderr || result.stdout).trim()}`);
  }
  const [videoKey, notAVideoKey] = result.stdout.trim().split('\n');
  if (!videoKey || !notAVideoKey) throw new Error(`Seed script printed ${JSON.stringify(result.stdout)}, expected two storage keys`);
  return { videoKey, notAVideoKey };
}

async function postProcessingRequest(sourceStorageKey) {
  const res = await fetch(`${API_URL}/processing-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ownerUserId: 'smoke-user',
      sourceStorageKey,
    }),
  });

  if (!res.ok) {
    throw new Error(`Create request failed: ${res.status}`);
  }

  const body = await res.json();
  if (!body.processingRequestId) {
    throw new Error('Create response missing processingRequestId');
  }

  return body.processingRequestId;
}

// Waits until the request is terminal and returns it whichever way it ended;
// the caller decides which ending was expected. A request still in flight at
// the deadline fails naming the status it was last seen in.
async function waitForTerminalStatus(id) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let observed;
  while (Date.now() < deadline) {
    const res = await fetch(`${CATALOG_URL}/processing-requests/${id}`);
    if (!res.ok) {
      throw new Error(`Catalog observation failed: ${res.status}`);
    }

    const body = await res.json();
    if (body.status === 'COMPLETED' || body.status === 'FAILED') return body;
    observed = body.status;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Request ${id} is still ${observed} after ${POLL_TIMEOUT_MS} ms; expected it to settle`);
}

function describe(request) {
  return request.failureCode ? `${request.status} (${request.failureCode})` : request.status;
}

async function waitForNotificationDelivery(id) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${NOTIFICATION_URL}/local/deliveries/${id}`);
    if (res.status === 200) return await res.json();
    if (res.status === 404) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    throw new Error(`Notification observation failed: ${res.status}`);
  }
  throw new Error('Notification delivery record was not created');
}

async function main() {
  await waitForApiHealth();
  const { videoKey, notAVideoKey } = seedSources();
  console.log(`Seeded source video at ${videoKey} and a non-video at ${notAVideoKey}`);
  await checkAnonymousAccess(videoKey);
  console.log(`Storage refused anonymous GET of ${BUCKET}/${videoKey} and of the ${BUCKET} listing (403)`);
  const id = await postProcessingRequest(videoKey);
  console.log(`Created processing request ${id}`);
  const rejectedId = await postProcessingRequest(notAVideoKey);
  console.log(`Created processing request ${rejectedId} for the non-video`);

  const completed = await waitForTerminalStatus(id);
  assertCompleted(id, completed);
  const zipKey = completed.zipStorageKey;
  assertArchiveKeyScoped(id, zipKey);
  console.log(`Catalog reached COMPLETED for ${id} with archive ${zipKey}`);

  const rejected = await waitForTerminalStatus(rejectedId);
  assertRejected(rejectedId, rejected);
  console.log(`Catalog reached FAILED (FORMATO_INVALIDO) for ${rejectedId}`);

  const frames = assertArchiveFrameCount(zipKey);
  console.log(`Archive ${zipKey} holds ${frames} frames, as ${FIXTURE_SECONDS} s at ${FRAMES_PER_SECOND} frame/s requires`);
  assertNoArchive(rejectedId);
  console.log(`No archive exists under zips/${rejectedId}/`);

  await waitForNotificationDelivery(id);
  console.log(`Notification delivered for ${id}`);
  const delivery = await waitForNotificationDelivery(rejectedId);
  assertDeliverySentence(rejectedId, delivery);
  assertSingleDelivery(rejectedId, countDeliveries(rejectedId));
  console.log(`Notification delivered once for ${rejectedId}: ${delivery.failureReason}`);
}

// A minimal archive for the self-test: some bytes, then an End of Central
// Directory record declaring `entries` entries.
function syntheticZip(entries) {
  const eocd = Buffer.alloc(EOCD_SIZE);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(entries, 8);
  eocd.writeUInt16LE(entries, 10);
  return Buffer.concat([Buffer.from('local file headers and central directory'), eocd]);
}

// Runs the archive assertions exactly as the smoke does after the transfer:
// write the bytes into a scratch directory, count, remove, check removal.
function checkArchiveBytes(zipKey, bytes) {
  return withScratchDir((dir) => {
    const path = join(dir, 'frames.zip');
    writeFileSync(path, bytes);
    return assertArchiveContents(zipKey, path);
  });
}

// `--self-test` needs no stack. It feeds every assertion a synthetic bad input
// and requires the exact failure message, and feeds each a good input and
// requires it to pass, so an assertion that was disabled, loosened or made to
// reject everything is caught here and in CI, not by a one-off negative run.
function selfTest() {
  const zipKey = 'zips/self-test-request/self-test-attempt/frames.zip';
  const id = 'self-test-request';
  const objectUrl = `${STORAGE_URL}/${BUCKET}/sources/sample-8s.mp4`;
  const listingUrl = `${STORAGE_URL}/${BUCKET}/`;
  const listing = '[2026-09-25 12:00:00 UTC] 1.2KiB STANDARD self-test-attempt/frames.zip';
  const leftover = join(tmpdir(), 'fiapx-smoke-self-test');
  // Literal, not FORMATO_INVALIDO_REASON: a changed constant must fail here too.
  const sentence = 'O arquivo enviado nao e um video MP4 ou MOV valido.';

  const rejections = [
    ['frame count 16', () => checkArchiveBytes(zipKey, syntheticZip(16)),
      `Archive frame count mismatch: ${BUCKET}/${zipKey} holds 16 entries, expected 8`],
    ['frame count 7', () => checkArchiveBytes(zipKey, syntheticZip(7)),
      `Archive frame count mismatch: ${BUCKET}/${zipKey} holds 7 entries, expected 8`],
    ['archive absent', () => assertArchiveTransferred(zipKey, { status: 1, stderr: Buffer.from('mc: <ERROR> Object does not exist.\n') }),
      `Archive absent: ${BUCKET}/${zipKey} could not be transferred from storage (mc: <ERROR> Object does not exist.)`],
    ['archive unreadable', () => checkArchiveBytes(zipKey, Buffer.from('plain text, not an archive')),
      `Archive unreadable: ${BUCKET}/${zipKey} has no End of Central Directory record`],
    ['archive empty', () => checkArchiveBytes(zipKey, syntheticZip(0)),
      `Archive empty: ${BUCKET}/${zipKey} holds 0 entries, expected 8`],
    ['rejected request observed COMPLETED', () => assertRejected(id, { status: 'COMPLETED', zipStorageKey: zipKey }),
      `Request ${id} for the non-video: expected FAILED (FORMATO_INVALIDO), observed COMPLETED`],
    ['rejected request FAILED with another code', () => assertRejected(id, { status: 'FAILED', failureCode: 'PROCESSAMENTO_FALHOU' }),
      `Request ${id} for the non-video: expected FAILED (FORMATO_INVALIDO), observed FAILED (PROCESSAMENTO_FALHOU)`],
    ['0 deliveries', () => assertSingleDelivery(id, 0),
      `Delivery for ${id}: expected exactly 1 record, found 0`],
    ['2 deliveries', () => assertSingleDelivery(id, 2),
      `Delivery for ${id}: expected exactly 1 record, found 2`],
    ['archive present for the rejected request', () => assertNoArchiveListing(id, listing),
      `Rejected request ${id} left an archive under zips/${id}/:\n${listing}`],
    ['anonymous GET of the object answered 200', () => assertAnonymousRefused(objectUrl, 200),
      `Anonymous access allowed: GET ${objectUrl} returned 200; the bucket must refuse requests without credentials`],
    ['anonymous GET of the listing answered 200', () => assertAnonymousRefused(listingUrl, 200),
      `Anonymous access allowed: GET ${listingUrl} returned 200; the bucket must refuse requests without credentials`],
    ['temp directory remaining', () => assertScratchRemoved(leftover, true),
      `Downloaded artefact left behind: ${leftover} still exists after cleanup`],
    ['video request observed FAILED', () => assertCompleted(id, { status: 'FAILED', failureCode: 'PROCESSAMENTO_FALHOU' }),
      `Request ${id} for the video: expected COMPLETED, observed FAILED (PROCESSAMENTO_FALHOU)`],
    ['archive key under another request', () => assertArchiveKeyScoped(id, 'zips/another-request/attempt/frames.zip'),
      `Catalog reported zipStorageKey "zips/another-request/attempt/frames.zip", expected a key under zips/${id}/`],
    ['archive key under a request whose id extends this one', () => assertArchiveKeyScoped(id, `zips/${id}-2/attempt/frames.zip`),
      `Catalog reported zipStorageKey "zips/${id}-2/attempt/frames.zip", expected a key under zips/${id}/`],
    ['archive key missing', () => assertArchiveKeyScoped(id, undefined),
      `Catalog reported zipStorageKey undefined, expected a key under zips/${id}/`],
    ['delivery with another sentence', () => assertDeliverySentence(id, { status: 'FAILED', failureReason: 'Nao foi possivel processar o video.' }),
      `Delivery for ${id}: expected FAILED with ${JSON.stringify(sentence)}, observed FAILED with "Nao foi possivel processar o video."`],
    ['delivery observed COMPLETED', () => assertDeliverySentence(id, { status: 'COMPLETED', failureReason: sentence }),
      `Delivery for ${id}: expected FAILED with ${JSON.stringify(sentence)}, observed COMPLETED with ${JSON.stringify(sentence)}`],
  ];

  let scratch;
  const acceptances = [
    ['8-frame archive, scratch directory removed', () => {
      const entries = withScratchDir((dir) => {
        scratch = dir;
        const path = join(dir, 'frames.zip');
        writeFileSync(path, syntheticZip(EXPECTED_FRAMES));
        return assertArchiveContents(zipKey, path);
      });
      if (entries !== EXPECTED_FRAMES) throw new Error(`returned ${entries}, expected ${EXPECTED_FRAMES}`);
      if (existsSync(scratch)) throw new Error(`${scratch} still exists`);
    }],
    ['archive transferred', () => assertArchiveTransferred(zipKey, { status: 0, stderr: Buffer.alloc(0) })],
    ['rejected request FAILED (FORMATO_INVALIDO)', () => assertRejected(id, { status: 'FAILED', failureCode: 'FORMATO_INVALIDO' })],
    ['1 delivery', () => assertSingleDelivery(id, 1)],
    ['no archive for the rejected request', () => assertNoArchiveListing(id, '')],
    ['anonymous GET refused with 403', () => assertAnonymousRefused(objectUrl, 403)],
    ['temp directory gone', () => assertScratchRemoved(leftover, false)],
    ['video request COMPLETED', () => assertCompleted(id, { status: 'COMPLETED', zipStorageKey: zipKey })],
    ['archive key under this request', () => assertArchiveKeyScoped(id, zipKey)],
    ['delivery FAILED with the sentence', () => assertDeliverySentence(id, { status: 'FAILED', failureReason: sentence })],
  ];

  const failures = [];
  for (const [name, run, expected] of rejections) {
    try {
      run();
      failures.push(`${name}: accepted, expected rejection with ${JSON.stringify(expected)}`);
    } catch (err) {
      if (err.message !== expected) {
        failures.push(`${name}: rejected with ${JSON.stringify(err.message)}, expected ${JSON.stringify(expected)}`);
      }
    }
  }
  for (const [name, run] of acceptances) {
    try {
      run();
    } catch (err) {
      failures.push(`${name}: rejected a good input with ${JSON.stringify(err.message)}`);
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`Self-test failed: ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Self-test passed: ${rejections.length} bad inputs rejected with the expected message, ${acceptances.length} good inputs accepted`,
  );
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
