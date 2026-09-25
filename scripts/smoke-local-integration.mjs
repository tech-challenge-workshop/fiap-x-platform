import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const CATALOG_URL = process.env.CATALOG_URL ?? 'http://localhost:3001';
const NOTIFICATION_URL = process.env.NOTIFICATION_URL ?? 'http://localhost:3003';

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

  const dir = mkdtempSync(join(tmpdir(), 'fiapx-smoke-'));
  try {
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
  } finally {
    rmSync(dir, { recursive: true, force: true });
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

// The seed is idempotent (fixed key), so running it here costs one upload
// and means the smoke never depends on someone having seeded first.
function seedSourceVideo() {
  const result = spawnSync(process.execPath, [join(SCRIPTS_DIR, 'seed-source-video.mjs')], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Seeding the source video failed:\n${(result.stderr || result.stdout).trim()}`);
  }
  const key = result.stdout.trim().split('\n')[0];
  if (!key) throw new Error('Seed script printed no storage key');
  return key;
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

async function waitForCatalogStatus(id) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${CATALOG_URL}/processing-requests/${id}`);
    if (!res.ok) {
      throw new Error(`Catalog observation failed: ${res.status}`);
    }

    const body = await res.json();
    if (body.status === 'COMPLETED') return body;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('Catalog status did not reach COMPLETED');
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
  const sourceKey = seedSourceVideo();
  console.log(`Seeded source video at ${sourceKey}`);
  const id = await postProcessingRequest(sourceKey);
  console.log(`Created processing request ${id}`);
  const completed = await waitForCatalogStatus(id);
  // Every run creates a new request and the archive key is scoped to it, so a
  // second run can never assert against the previous run's archive.
  const zipKey = completed.zipStorageKey;
  if (typeof zipKey !== 'string' || !zipKey.startsWith(`zips/${id}/`)) {
    throw new Error(`Catalog reported zipStorageKey ${JSON.stringify(zipKey)}, expected a key under zips/${id}/`);
  }
  console.log(`Catalog reached COMPLETED for ${id} with archive ${zipKey}`);
  const frames = assertArchiveFrameCount(zipKey);
  console.log(`Archive ${zipKey} holds ${frames} frames, as ${FIXTURE_SECONDS} s at ${FRAMES_PER_SECOND} frame/s requires`);
  await waitForNotificationDelivery(id);
  console.log(`Notification delivered for ${id}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
