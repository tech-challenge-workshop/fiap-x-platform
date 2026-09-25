import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const CATALOG_URL = process.env.CATALOG_URL ?? 'http://localhost:3001';
const NOTIFICATION_URL = process.env.NOTIFICATION_URL ?? 'http://localhost:3003';

const HEALTH_TIMEOUT_MS = Number(process.env.HEALTH_TIMEOUT_MS ?? 30000);
const POLL_TIMEOUT_MS = Number(process.env.POLL_TIMEOUT_MS ?? 60000);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 1000);

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
  await waitForNotificationDelivery(id);
  console.log(`Notification delivered for ${id}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
