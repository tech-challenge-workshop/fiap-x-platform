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
  if (transfer.status !== 0) {
    const cause = transfer.stderr.toString().trim().split('\n').pop();
    throw new Error(`Archive absent: ${BUCKET}/${zipKey} could not be transferred from storage (${cause})`);
  }

  return withScratchDir((dir) => {
    const path = join(dir, 'frames.zip');
    writeFileSync(path, transfer.stdout);
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
function assertNoArchive(id) {
  const prefix = `local/${BUCKET}/zips/${id}/`;
  const listing = dockerCompose(['run', '--rm', '--no-deps', '-T', '--entrypoint', 'mc', 'minio-init', 'ls', '--recursive', prefix]).trim();
  if (listing) throw new Error(`Rejected request ${id} left an archive under zips/${id}/:\n${listing}`);
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
  if (completed.status !== 'COMPLETED') {
    throw new Error(`Request ${id} for the video: expected COMPLETED, observed ${describe(completed)}`);
  }
  // Every run creates a new request and the archive key is scoped to it, so a
  // second run can never assert against the previous run's archive.
  const zipKey = completed.zipStorageKey;
  if (typeof zipKey !== 'string' || !zipKey.startsWith(`zips/${id}/`)) {
    throw new Error(`Catalog reported zipStorageKey ${JSON.stringify(zipKey)}, expected a key under zips/${id}/`);
  }
  console.log(`Catalog reached COMPLETED for ${id} with archive ${zipKey}`);

  const rejected = await waitForTerminalStatus(rejectedId);
  if (rejected.status !== 'FAILED' || rejected.failureCode !== 'FORMATO_INVALIDO') {
    throw new Error(`Request ${rejectedId} for the non-video: expected FAILED (FORMATO_INVALIDO), observed ${describe(rejected)}`);
  }
  console.log(`Catalog reached FAILED (FORMATO_INVALIDO) for ${rejectedId}`);

  const frames = assertArchiveFrameCount(zipKey);
  console.log(`Archive ${zipKey} holds ${frames} frames, as ${FIXTURE_SECONDS} s at ${FRAMES_PER_SECOND} frame/s requires`);
  assertNoArchive(rejectedId);
  console.log(`No archive exists under zips/${rejectedId}/`);

  await waitForNotificationDelivery(id);
  console.log(`Notification delivered for ${id}`);
  const delivery = await waitForNotificationDelivery(rejectedId);
  if (delivery.status !== 'FAILED' || delivery.failureReason !== FORMATO_INVALIDO_REASON) {
    throw new Error(
      `Delivery for ${rejectedId}: expected FAILED with ${JSON.stringify(FORMATO_INVALIDO_REASON)}, observed ${delivery.status} with ${JSON.stringify(delivery.failureReason)}`,
    );
  }
  const deliveries = countDeliveries(rejectedId);
  if (deliveries !== 1) {
    throw new Error(`Delivery for ${rejectedId}: expected exactly 1 record, found ${deliveries}`);
  }
  console.log(`Notification delivered once for ${rejectedId}: ${delivery.failureReason}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
