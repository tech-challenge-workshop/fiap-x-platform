import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getToken } from './get-token.mjs';

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
// STORAGE_HOST_PORT is the variable compose.yaml publishes storage on.
const STORAGE_URL = process.env.STORAGE_URL ?? `http://localhost:${process.env.STORAGE_HOST_PORT ?? 9000}`;

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

// Every scratch directory this run created, so the last step can check that
// none survived the run.
const scratchDirs = [];

// Runs fn in a fresh temporary directory, removes the directory whatever the
// outcome, and then checks it is gone. A leak is reported alongside, never
// instead of, the failure that fn raised.
function withScratchDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'fiapx-smoke-'));
  scratchDirs.push(dir);
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

// Fetches the archive with aws-cli to stdout (no SDK, no package.json). The
// transfer's outcome is returned, not judged: the "archive count" step
// asserts on it.
function transferArchive(zipKey) {
  const transfer = spawnSync(
    'docker',
    ['compose', 'run', '--rm', '--no-deps', '-T', '--entrypoint', 'aws', 'storage-init', 's3', 'cp', '--only-show-errors', `s3://${BUCKET}/${zipKey}`, '-'],
    { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 },
  );
  if (transfer.error) throw new Error(`Could not run docker to fetch the archive: ${transfer.error.message}`);
  return transfer;
}

// Writes the archive into a scratch directory that is removed whatever the
// outcome, then asserts its entry count. Absent, unreadable and empty are
// reported as three distinct causes.
function checkArchiveBytes(zipKey, bytes) {
  return withScratchDir((dir) => {
    const path = join(dir, 'frames.zip');
    writeFileSync(path, bytes);
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

// Keys under the request's archive prefix, one per line; empty when there are
// none (aws-cli prints "None" for an empty listing in text output).
function listArchives(id) {
  const keys = dockerCompose([
    'run', '--rm', '--no-deps', '-T', '--entrypoint', 'aws', 'storage-init',
    's3api', 'list-objects-v2', '--bucket', BUCKET, '--prefix', `zips/${id}/`,
    '--query', 'Contents[].Key', '--output', 'text',
  ]).trim();
  return keys === 'None' ? '' : keys.split(/\s+/).join('\n');
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

function anonymousUrls(videoKey) {
  return [`${STORAGE_URL}/${BUCKET}/${videoKey}`, `${STORAGE_URL}/${BUCKET}/`];
}

// A plain fetch carries no S3 signature, so it is an anonymous request.
async function anonymousStatuses(videoKey) {
  const statuses = {};
  for (const url of anonymousUrls(videoKey)) {
    const res = await fetch(url);
    await res.arrayBuffer();
    statuses[url] = res.status;
  }
  return statuses;
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

// AUTH-17 AC1: creating a request without a token must be refused with 401.
// A 2xx means the API let an anonymous caller in; any other status is named.
function assertAnonymousCreateRefused(status) {
  const call = `POST ${API_URL}/processing-requests`;
  if (status >= 200 && status < 300) {
    throw new Error(`Anonymous creation accepted: ${call} without a token returned ${status}; the API must refuse it with 401`);
  }
  if (status !== 401) {
    throw new Error(`Anonymous ${call} without a token returned ${status}, expected 401`);
  }
}

// The same creation call as the authenticated one, with no Authorization
// header. Only the status is observed; the check judges it.
async function anonymousCreateStatus(sourceStorageKey) {
  const res = await fetch(`${API_URL}/processing-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceStorageKey }),
  });
  await res.arrayBuffer();
  return res.status;
}

// One token per user, fetched when a step first needs it. refresh() replaces
// it: a token lasts 5 minutes, and one issued before identity restarted is
// signed with a key the API no longer trusts. fetchToken is injectable so the
// self-test can drive the refresh path without a stack.
function createTokenSource(fetchToken = getToken) {
  const cache = new Map();
  return {
    async get(user) {
      if (!cache.has(user)) cache.set(user, await fetchToken(user));
      return cache.get(user);
    },
    async refresh(user) {
      cache.set(user, await fetchToken(user));
      return cache.get(user);
    },
  };
}

// Runs call(token) with the user's token. On a 401 it fetches a fresh token
// once and runs call again; a second 401 fails naming the step (spec edge
// case: a token expiring during a long run).
async function withFreshToken(tokens, user, step, call) {
  const first = await call(await tokens.get(user));
  if (first.status !== 401) return first;
  const second = await call(await tokens.refresh(user));
  if (second.status === 401) {
    throw new Error(`Step "${step}": ${user}'s request was refused with 401 twice, the second time with a freshly issued token`);
  }
  return second;
}

const tokens = createTokenSource();

// An API call as user: the status and the raw body text.
function fetchAs(user, step, path, init = {}) {
  return withFreshToken(tokens, user, step, async (token) => {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });
    return { status: res.status, text: await res.text() };
  });
}

function createRequestAs(user, step, sourceStorageKey) {
  return fetchAs(user, step, '/processing-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceStorageKey }),
  });
}

// The owner is the token's subject (AUTH-17 AC2): the body carries no
// ownerUserId.
async function postProcessingRequest(sourceStorageKey) {
  const res = await createRequestAs('alice', 'create requests', sourceStorageKey);

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Create request failed: ${res.status}`);
  }

  const body = JSON.parse(res.text);
  if (!body.processingRequestId) {
    throw new Error('Create response missing processingRequestId');
  }

  return body.processingRequestId;
}

// A creation must answer 201 with the new id; the id is returned for the
// steps that follow.
function assertCreated(user, created) {
  const call = `${user}'s POST ${API_URL}/processing-requests`;
  if (created.status !== 201) throw new Error(`${call} returned ${created.status}, expected 201`);
  const id = created.body?.processingRequestId;
  if (typeof id !== 'string' || id === '') throw new Error(`${call} returned 201 without a processingRequestId`);
  return id;
}

// Creates a request with the user's token. The answer is returned, not
// judged: the step's check does that.
async function createAs(user, step, sourceStorageKey) {
  const res = await createRequestAs(user, step, sourceStorageKey);
  let body;
  try {
    body = JSON.parse(res.text);
  } catch {
    body = res.text;
  }
  return { status: res.status, body };
}

// The API caps pageSize at 100, so a list is read page by page until every
// item the total announces has been read.
const LIST_PAGE_SIZE = 100;

async function listAllAs(user, step) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const res = await fetchAs(user, step, `/processing-requests?page=${page}&pageSize=${LIST_PAGE_SIZE}`);
    if (res.status !== 200) throw new Error(`${user}'s GET ${API_URL}/processing-requests?page=${page} failed: ${res.status}`);
    const body = JSON.parse(res.text);
    items.push(...body.items);
    if (body.items.length === 0 || items.length >= body.total) return items;
  }
}

// AUTH-17 AC3. Each list must hold its owner's own requests, so an empty list
// cannot pass for a scoped one, and neither may hold the other's.
function assertListsDisjoint({ aliceIds, bobId, aliceList, bobList }) {
  const aliceListed = new Set(aliceList.map((item) => item.processingRequestId));
  const bobListed = new Set(bobList.map((item) => item.processingRequestId));
  for (const id of aliceIds) {
    if (!aliceListed.has(id)) throw new Error(`alice's list is missing her own request ${id}`);
  }
  if (!bobListed.has(bobId)) throw new Error(`bob's list is missing his own request ${bobId}`);
  if (aliceListed.has(bobId)) throw new Error(`Owner scope leak: alice's list contains bob's request ${bobId}`);
  for (const id of new Set([...aliceIds, ...aliceListed])) {
    if (bobListed.has(id)) throw new Error(`Owner scope leak: bob's list contains alice's request ${id}`);
  }
}

// Fields the Catalog keeps that a user must never see (AUTH-17 AC5).
const INTERNAL_FIELDS = ['sourceStorageKey', 'zipStorageKey', 'failureCode', 'ownerUserId'];

// AUTH-17 AC5: no listed item carries an internal field, even as null, and
// the rejected request carries exactly the user-facing sentence.
function assertNoInternalFields(rejectedId, list) {
  for (const item of list) {
    for (const field of INTERNAL_FIELDS) {
      if (Object.hasOwn(item, field)) {
        throw new Error(`alice's list exposes ${field} on request ${item.processingRequestId}`);
      }
    }
  }
  const rejected = list.find((item) => item.processingRequestId === rejectedId);
  if (!rejected) throw new Error(`alice's list is missing her rejected request ${rejectedId}`);
  if (rejected.failureReason !== FORMATO_INVALIDO_REASON) {
    throw new Error(
      `alice's rejected request ${rejectedId} carries failureReason ${JSON.stringify(rejected.failureReason)}, expected ${JSON.stringify(FORMATO_INVALIDO_REASON)}`,
    );
  }
}

// Reads one request with the user's token and returns the status and the raw
// body text, so a check can compare two bodies byte for byte.
async function readAs(user, step, id) {
  const res = await fetchAs(user, step, `/processing-requests/${id}`);
  return { status: res.status, body: res.text };
}

// AUTH-17 AC4: bob reading alice's request must look exactly like reading a
// request that does not exist, so the answer reveals nothing about it.
function assertCrossOwnerNotFound(id, crossRead, randomRead) {
  const call = `bob's GET ${API_URL}/processing-requests/${id}`;
  if (randomRead.status !== 404) {
    throw new Error(`bob's GET of a random id returned ${randomRead.status}, expected 404 to compare against`);
  }
  if (crossRead.status >= 200 && crossRead.status < 300) {
    throw new Error(`Owner scope leak: ${call} returned ${crossRead.status}; alice's request must be invisible to bob`);
  }
  if (crossRead.status !== 404) {
    throw new Error(`${call} returned ${crossRead.status}, expected 404 as for a random id`);
  }
  if (crossRead.body !== randomRead.body) {
    throw new Error(`${call} returned 404 with ${crossRead.body}, but a random id gets ${randomRead.body}`);
  }
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

// A check reads what an earlier observe stored. A value that was never
// observed fails the step by name rather than passing on `undefined`.
function observed(ctx, key) {
  if (ctx[key] === undefined) throw new Error(`Nothing was observed for ${key}; the step that observes it did not run`);
  return ctx[key];
}

// The smoke is this ordered list and nothing else. Each step may observe the
// live stack (observe), then assert on what it stored (check), then print a
// line (report). Every assertion lives in a check, and each check reads only
// ctx, so --self-test runs the same checks without a stack.
export const SMOKE_STEPS = [
  {
    name: 'api health',
    observe: () => waitForApiHealth(),
  },
  {
    name: 'seed',
    observe: (ctx) => Object.assign(ctx, seedSources()),
    report: (ctx) => `Seeded source video at ${ctx.videoKey} and a non-video at ${ctx.notAVideoKey}`,
  },
  {
    name: 'anonymous access',
    observe: async (ctx) => {
      ctx.anonymous = await anonymousStatuses(ctx.videoKey);
    },
    check: (ctx) => {
      const statuses = observed(ctx, 'anonymous');
      for (const url of anonymousUrls(observed(ctx, 'videoKey'))) assertAnonymousRefused(url, statuses[url]);
    },
    report: (ctx) => `Storage refused anonymous GET of ${BUCKET}/${ctx.videoKey} and of the ${BUCKET} listing (403)`,
  },
  {
    name: 'anonymous refused',
    observe: async (ctx) => {
      ctx.anonymousCreate = await anonymousCreateStatus(ctx.videoKey);
    },
    check: (ctx) => assertAnonymousCreateRefused(observed(ctx, 'anonymousCreate')),
    report: () => `API refused an anonymous POST /processing-requests (401)`,
  },
  {
    name: 'create requests',
    observe: async (ctx) => {
      ctx.id = await postProcessingRequest(ctx.videoKey);
      ctx.rejectedId = await postProcessingRequest(ctx.notAVideoKey);
    },
    report: (ctx) => `Created processing request ${ctx.id} as alice\nCreated processing request ${ctx.rejectedId} for the non-video as alice`,
  },
  {
    name: 'video completed',
    observe: async (ctx) => {
      ctx.completed = await waitForTerminalStatus(ctx.id);
    },
    check: (ctx) => assertCompleted(observed(ctx, 'id'), observed(ctx, 'completed')),
  },
  {
    name: 'key scope',
    check: (ctx) => assertArchiveKeyScoped(observed(ctx, 'id'), observed(ctx, 'completed').zipStorageKey),
    report: (ctx) => `Catalog reached COMPLETED for ${ctx.id} with archive ${ctx.completed.zipStorageKey}`,
  },
  {
    name: 'rejection',
    observe: async (ctx) => {
      ctx.rejected = await waitForTerminalStatus(ctx.rejectedId);
    },
    check: (ctx) => assertRejected(observed(ctx, 'rejectedId'), observed(ctx, 'rejected')),
    report: (ctx) => `Catalog reached FAILED (FORMATO_INVALIDO) for ${ctx.rejectedId}`,
  },
  {
    name: 'archive count',
    observe: (ctx) => {
      ctx.transfer = transferArchive(ctx.completed.zipStorageKey);
    },
    check: (ctx) => {
      const zipKey = observed(ctx, 'completed').zipStorageKey;
      const transfer = observed(ctx, 'transfer');
      assertArchiveTransferred(zipKey, transfer);
      ctx.frames = checkArchiveBytes(zipKey, transfer.stdout);
    },
    report: (ctx) =>
      `Archive ${ctx.completed.zipStorageKey} holds ${ctx.frames} frames, as ${FIXTURE_SECONDS} s at ${FRAMES_PER_SECOND} frame/s requires`,
  },
  {
    name: 'no archive',
    observe: (ctx) => {
      ctx.rejectedListing = listArchives(ctx.rejectedId);
    },
    check: (ctx) => assertNoArchiveListing(observed(ctx, 'rejectedId'), observed(ctx, 'rejectedListing')),
    report: (ctx) => `No archive exists under zips/${ctx.rejectedId}/`,
  },
  {
    name: 'video delivery',
    observe: (ctx) => waitForNotificationDelivery(ctx.id),
    report: (ctx) => `Notification delivered for ${ctx.id}`,
  },
  {
    name: 'delivery sentence',
    observe: async (ctx) => {
      ctx.delivery = await waitForNotificationDelivery(ctx.rejectedId);
    },
    check: (ctx) => assertDeliverySentence(observed(ctx, 'rejectedId'), observed(ctx, 'delivery')),
  },
  {
    name: 'single delivery',
    observe: (ctx) => {
      ctx.deliveries = countDeliveries(ctx.rejectedId);
    },
    check: (ctx) => assertSingleDelivery(observed(ctx, 'rejectedId'), observed(ctx, 'deliveries')),
    report: (ctx) => `Notification delivered once for ${ctx.rejectedId}: ${ctx.delivery.failureReason}`,
  },
  {
    name: 'bob request created',
    observe: async (ctx) => {
      ctx.bobCreate = await createAs('bob', 'bob request created', ctx.notAVideoKey);
    },
    check: (ctx) => {
      ctx.bobId = assertCreated('bob', observed(ctx, 'bobCreate'));
    },
    report: (ctx) => `Created processing request ${ctx.bobId} as bob`,
  },
  {
    name: 'lists disjoint',
    observe: async (ctx) => {
      ctx.aliceList = await listAllAs('alice', 'lists disjoint');
      ctx.bobList = await listAllAs('bob', 'lists disjoint');
    },
    check: (ctx) => assertListsDisjoint({
      aliceIds: [observed(ctx, 'id'), observed(ctx, 'rejectedId')],
      bobId: observed(ctx, 'bobId'),
      aliceList: observed(ctx, 'aliceList'),
      bobList: observed(ctx, 'bobList'),
    }),
    report: (ctx) => `alice lists ${ctx.aliceList.length} requests and bob ${ctx.bobList.length}; neither list holds the other's`,
  },
  {
    name: 'cross-owner read 404',
    observe: async (ctx) => {
      ctx.crossRead = await readAs('bob', 'cross-owner read 404', ctx.id);
      ctx.randomRead = await readAs('bob', 'cross-owner read 404', randomUUID());
    },
    check: (ctx) => assertCrossOwnerNotFound(observed(ctx, 'id'), observed(ctx, 'crossRead'), observed(ctx, 'randomRead')),
    report: (ctx) => `bob reading alice's request ${ctx.id} got 404 with the same body as a random id`,
  },
  {
    name: 'no internal fields',
    check: (ctx) => assertNoInternalFields(observed(ctx, 'rejectedId'), observed(ctx, 'aliceList')),
    report: (ctx) => `alice's list carries no internal field, and ${ctx.rejectedId} carries the safe failureReason`,
  },
  {
    name: 'no leftovers',
    observe: (ctx) => {
      ctx.scratchDirs = [...scratchDirs];
    },
    check: (ctx) => {
      for (const dir of observed(ctx, 'scratchDirs')) assertScratchRemoved(dir, existsSync(dir));
    },
    report: (ctx) => `No downloaded artefact left behind (${ctx.scratchDirs.length} scratch directory removed)`,
  },
];

async function runSteps(steps, ctx) {
  for (const step of steps) {
    if (step.observe) await step.observe(ctx);
    if (step.check) step.check(ctx);
    if (step.report) console.log(step.report(ctx));
  }
}

async function main() {
  await runSteps(SMOKE_STEPS, {});
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

// The steps --self-test requires by name. Removing one from SMOKE_STEPS, or
// its check, fails the self-test naming it.
const REQUIRED_STEPS = [
  'anonymous access',
  'anonymous refused',
  'video completed',
  'key scope',
  'rejection',
  'archive count',
  'no archive',
  'delivery sentence',
  'single delivery',
  'bob request created',
  'lists disjoint',
  'cross-owner read 404',
  'no internal fields',
  'no leftovers',
];

// Runs one step's own check through runSteps, exactly as main() would after
// its observe, against a context the self-test supplies.
async function runStepCheck(name, ctx) {
  const step = SMOKE_STEPS.find((candidate) => candidate.name === name);
  if (!step) throw new Error(`step "${name}" is missing from SMOKE_STEPS`);
  await runSteps([{ name, check: step.check }], ctx);
}

// `--self-test` needs no stack. It feeds every assertion a synthetic bad input
// and requires the exact failure message, and feeds each a good input and
// requires it to pass, so an assertion that was disabled, loosened or made to
// reject everything is caught here and in CI, not by a one-off negative run.
async function selfTest() {
  const zipKey = 'zips/self-test-request/self-test-attempt/frames.zip';
  const id = 'self-test-request';
  const objectUrl = `${STORAGE_URL}/${BUCKET}/sources/sample-8s.mp4`;
  const listingUrl = `${STORAGE_URL}/${BUCKET}/`;
  const listing = '[2026-09-25 12:00:00 UTC] 1.2KiB STANDARD self-test-attempt/frames.zip';
  const leftover = join(tmpdir(), 'fiapx-smoke-self-test');
  // Literal, not FORMATO_INVALIDO_REASON: a changed constant must fail here too.
  const sentence = 'O arquivo enviado nao e um video MP4 ou MOV valido.';
  const createCall = `POST ${API_URL}/processing-requests`;
  const rejectedId = 'self-test-rejected';
  const bobId = 'self-test-bob-request';
  const olderAliceId = 'self-test-older-alice-request';
  const item = (processingRequestId) => ({ processingRequestId, status: 'RECEIVED' });
  const readUrl = `${API_URL}/processing-requests/${id}`;
  // A token source whose tokens are numbered in the order they were issued.
  const fakeTokens = (issued) => createTokenSource(async (user) => {
    issued.push(user);
    return `${user}-token-${issued.length}`;
  });
  // alice's good list with one change: a field added to her older request,
  // or another failureReason on the rejected one.
  const withField = (field, value) => lists.aliceList.map((listed) => (
    listed.processingRequestId === olderAliceId ? { ...listed, [field]: value } : listed));
  const withReason = (failureReason) => lists.aliceList.map((listed) => (
    listed.processingRequestId === rejectedId ? { ...listed, failureReason } : listed));
  const notFound = { status: 404, body: '{"statusCode":404,"message":"Processing request not found"}' };
  const lists = {
    aliceIds: [id, rejectedId],
    bobId,
    aliceList: [item(olderAliceId), item(id), { ...item(rejectedId), status: 'FAILED', failureReason: sentence }],
    bobList: [item(bobId)],
  };

  const rejections = [
    ['frame count 16', () => checkArchiveBytes(zipKey, syntheticZip(16)),
      `Archive frame count mismatch: ${BUCKET}/${zipKey} holds 16 entries, expected 8`],
    ['frame count 7', () => checkArchiveBytes(zipKey, syntheticZip(7)),
      `Archive frame count mismatch: ${BUCKET}/${zipKey} holds 7 entries, expected 8`],
    ['archive absent', () => assertArchiveTransferred(zipKey, { status: 1, stderr: Buffer.from(`fatal error: An error occurred (404) when calling the HeadObject operation: Key "${zipKey}" does not exist\n`) }),
      `Archive absent: ${BUCKET}/${zipKey} could not be transferred from storage (fatal error: An error occurred (404) when calling the HeadObject operation: Key "${zipKey}" does not exist)`],
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
    ['anonymous creation answered 201', () => assertAnonymousCreateRefused(201),
      `Anonymous creation accepted: ${createCall} without a token returned 201; the API must refuse it with 401`],
    ['anonymous creation answered 500', () => assertAnonymousCreateRefused(500),
      `Anonymous ${createCall} without a token returned 500, expected 401`],
    ['anonymous creation answered 403', () => assertAnonymousCreateRefused(403),
      `Anonymous ${createCall} without a token returned 403, expected 401`],
    ["bob's creation answered 401", () => assertCreated('bob', { status: 401, body: { statusCode: 401, message: 'Unauthorized' } }),
      `bob's ${createCall} returned 401, expected 201`],
    ["bob's creation answered 200", () => assertCreated('bob', { status: 200, body: { processingRequestId: bobId } }),
      `bob's ${createCall} returned 200, expected 201`],
    ["bob's creation answered 201 without an id", () => assertCreated('bob', { status: 201, body: { status: 'RECEIVED' } }),
      `bob's ${createCall} returned 201 without a processingRequestId`],
    ["alice's list holding bob's request", () => assertListsDisjoint({ ...lists, aliceList: [...lists.aliceList, item(bobId)] }),
      `Owner scope leak: alice's list contains bob's request ${bobId}`],
    ["bob's list holding alice's request", () => assertListsDisjoint({ ...lists, bobList: [...lists.bobList, item(id)] }),
      `Owner scope leak: bob's list contains alice's request ${id}`],
    ["bob's list holding an older alice request", () => assertListsDisjoint({ ...lists, bobList: [...lists.bobList, item(olderAliceId)] }),
      `Owner scope leak: bob's list contains alice's request ${olderAliceId}`],
    ["alice's list missing her request", () => assertListsDisjoint({ ...lists, aliceList: [item(id)] }),
      `alice's list is missing her own request ${rejectedId}`],
    ["bob's list missing his request", () => assertListsDisjoint({ ...lists, bobList: [] }),
      `bob's list is missing his own request ${bobId}`],
    ["cross-owner read answered 200", () => assertCrossOwnerNotFound(id, { status: 200, body: JSON.stringify(item(id)) }, notFound),
      `Owner scope leak: bob's GET ${readUrl} returned 200; alice's request must be invisible to bob`],
    ["cross-owner read answered 403", () => assertCrossOwnerNotFound(id, { status: 403, body: '{"statusCode":403,"message":"Forbidden resource"}' }, notFound),
      `bob's GET ${readUrl} returned 403, expected 404 as for a random id`],
    ["cross-owner 404 with another body", () => assertCrossOwnerNotFound(id, { status: 404, body: '{"statusCode":404,"message":"Processing request belongs to another owner"}' }, notFound),
      `bob's GET ${readUrl} returned 404 with {"statusCode":404,"message":"Processing request belongs to another owner"}, but a random id gets ${notFound.body}`],
    ["cross-owner 404 whose body differs by one character", () => assertCrossOwnerNotFound(id, { status: 404, body: `${notFound.body} ` }, notFound),
      `bob's GET ${readUrl} returned 404 with ${notFound.body} , but a random id gets ${notFound.body}`],
    ["random id answered 500", () => assertCrossOwnerNotFound(id, notFound, { status: 500, body: '{"statusCode":500,"message":"Internal server error"}' }),
      `bob's GET of a random id returned 500, expected 404 to compare against`],
    ...['sourceStorageKey', 'zipStorageKey', 'failureCode', 'ownerUserId'].map((field) => [
      `listed item carrying ${field}`, () => assertNoInternalFields(rejectedId, withField(field, 'leaked')),
      `alice's list exposes ${field} on request ${olderAliceId}`]),
    ['listed item carrying ownerUserId as null', () => assertNoInternalFields(rejectedId, withField('ownerUserId', null)),
      `alice's list exposes ownerUserId on request ${olderAliceId}`],
    ['rejected request with a near-miss failureReason', () => assertNoInternalFields(rejectedId, withReason(sentence.slice(0, -1))),
      `alice's rejected request ${rejectedId} carries failureReason ${JSON.stringify(sentence.slice(0, -1))}, expected ${JSON.stringify(sentence)}`],
    ['rejected request without a failureReason', () => assertNoInternalFields(rejectedId, withReason(undefined)),
      `alice's rejected request ${rejectedId} carries failureReason undefined, expected ${JSON.stringify(sentence)}`],
    ['rejected request absent from the list', () => assertNoInternalFields(rejectedId, [item(olderAliceId), item(id)]),
      `alice's list is missing her rejected request ${rejectedId}`],
    ['a 401 again after a fresh token', () => withFreshToken(fakeTokens([]), 'bob', 'lists disjoint', async () => ({ status: 401 })),
      `Step "lists disjoint": bob's request was refused with 401 twice, the second time with a freshly issued token`],
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
    ['anonymous creation refused with 401', () => assertAnonymousCreateRefused(401)],
    ["bob's creation answered 201 with an id", () => {
      const created = assertCreated('bob', { status: 201, body: { processingRequestId: bobId, status: 'RECEIVED' } });
      if (created !== bobId) throw new Error(`returned ${created}, expected ${bobId}`);
    }],
    ['disjoint lists, each holding its own requests', () => assertListsDisjoint(lists)],
    ['cross-owner read answered exactly like a random id', () => assertCrossOwnerNotFound(id, { ...notFound }, { ...notFound })],
    ['list without internal fields, rejected request with the sentence', () => assertNoInternalFields(rejectedId, lists.aliceList)],
    ['a 401 then a 200 with a fresh token', async () => {
      const issued = [];
      const used = [];
      const answer = await withFreshToken(fakeTokens(issued), 'alice', 'create requests', async (token) => {
        used.push(token);
        return { status: used.length === 1 ? 401 : 200 };
      });
      const expected = JSON.stringify(['alice-token-1', 'alice-token-2']);
      if (answer.status !== 200) throw new Error(`returned status ${answer.status}, expected 200`);
      if (JSON.stringify(used) !== expected) throw new Error(`called with ${JSON.stringify(used)}, expected ${expected}`);
    }],
  ];

  // The steps main() runs: each required step must be in SMOKE_STEPS with a
  // check, and its own check, run through runSteps, must reject a context
  // holding one bad observation and accept a context holding none.
  const survivingDir = mkdtempSync(join(tmpdir(), 'fiapx-smoke-self-test-'));
  const goneDir = mkdtempSync(join(tmpdir(), 'fiapx-smoke-self-test-'));
  rmSync(goneDir, { recursive: true, force: true });
  const good = {
    videoKey: 'sources/sample-8s.mp4',
    anonymous: { [objectUrl]: 403, [listingUrl]: 403 },
    anonymousCreate: 401,
    id,
    rejectedId,
    completed: { status: 'COMPLETED', zipStorageKey: zipKey },
    rejected: { status: 'FAILED', failureCode: 'FORMATO_INVALIDO' },
    transfer: { status: 0, stdout: syntheticZip(8), stderr: Buffer.alloc(0) },
    rejectedListing: '',
    delivery: { status: 'FAILED', failureReason: sentence },
    deliveries: 1,
    bobCreate: { status: 201, body: { processingRequestId: bobId, status: 'RECEIVED' } },
    bobId,
    aliceList: lists.aliceList,
    bobList: lists.bobList,
    crossRead: { ...notFound },
    randomRead: { ...notFound },
    scratchDirs: [goneDir],
  };
  const stepRejections = [
    ['anonymous access', { anonymous: { [objectUrl]: 200, [listingUrl]: 403 } },
      `Anonymous access allowed: GET ${objectUrl} returned 200; the bucket must refuse requests without credentials`],
    ['anonymous refused', { anonymousCreate: 201 },
      `Anonymous creation accepted: ${createCall} without a token returned 201; the API must refuse it with 401`],
    ['video completed', { completed: { status: 'FAILED', failureCode: 'PROCESSAMENTO_FALHOU' } },
      `Request ${id} for the video: expected COMPLETED, observed FAILED (PROCESSAMENTO_FALHOU)`],
    ['key scope', { completed: { status: 'COMPLETED', zipStorageKey: 'zips/another-request/attempt/frames.zip' } },
      `Catalog reported zipStorageKey "zips/another-request/attempt/frames.zip", expected a key under zips/${id}/`],
    ['rejection', { rejected: { status: 'COMPLETED', zipStorageKey: zipKey } },
      `Request ${rejectedId} for the non-video: expected FAILED (FORMATO_INVALIDO), observed COMPLETED`],
    ['archive count', { transfer: { status: 0, stdout: syntheticZip(7), stderr: Buffer.alloc(0) } },
      `Archive frame count mismatch: ${BUCKET}/${zipKey} holds 7 entries, expected 8`],
    ['no archive', { rejectedListing: listing },
      `Rejected request ${rejectedId} left an archive under zips/${rejectedId}/:\n${listing}`],
    ['delivery sentence', { delivery: { status: 'FAILED', failureReason: 'Nao foi possivel processar o video.' } },
      `Delivery for ${rejectedId}: expected FAILED with ${JSON.stringify(sentence)}, observed FAILED with "Nao foi possivel processar o video."`],
    ['single delivery', { deliveries: 2 },
      `Delivery for ${rejectedId}: expected exactly 1 record, found 2`],
    ['bob request created', { bobCreate: { status: 401, body: { statusCode: 401, message: 'Unauthorized' } } },
      `bob's ${createCall} returned 401, expected 201`],
    ['lists disjoint', { aliceList: [...lists.aliceList, item(bobId)] },
      `Owner scope leak: alice's list contains bob's request ${bobId}`],
    ['cross-owner read 404', { crossRead: { status: 403, body: '{"statusCode":403,"message":"Forbidden resource"}' } },
      `bob's GET ${readUrl} returned 403, expected 404 as for a random id`],
    ['no internal fields', { aliceList: withField('zipStorageKey', zipKey) },
      `alice's list exposes zipStorageKey on request ${olderAliceId}`],
    ['no leftovers', { scratchDirs: [goneDir, survivingDir] },
      `Downloaded artefact left behind: ${survivingDir} still exists after cleanup`],
  ];
  for (const [step, bad, expected] of stepRejections) {
    rejections.push([`step "${step}" given a bad observation`, () => runStepCheck(step, { ...good, ...bad }), expected]);
  }
  for (const step of REQUIRED_STEPS) {
    acceptances.push([`step "${step}" given good observations`, () => runStepCheck(step, { ...good })]);
  }
  acceptances.push(['runSteps observes before it checks', () => runSteps([{
    name: 'order',
    observe: (ctx) => { ctx.seen = true; },
    check: (ctx) => { if (!ctx.seen) throw new Error('check ran before observe'); },
  }], {})]);

  const failures = [];
  for (const step of REQUIRED_STEPS) {
    if (!SMOKE_STEPS.some((candidate) => candidate.name === step && typeof candidate.check === 'function')) {
      failures.push(`required step "${step}" is missing from SMOKE_STEPS, or has no check`);
    }
  }
  for (const [name, run, expected] of rejections) {
    try {
      await run();
      failures.push(`${name}: accepted, expected rejection with ${JSON.stringify(expected)}`);
    } catch (err) {
      if (err.message !== expected) {
        failures.push(`${name}: rejected with ${JSON.stringify(err.message)}, expected ${JSON.stringify(expected)}`);
      }
    }
  }
  for (const [name, run] of acceptances) {
    try {
      await run();
    } catch (err) {
      failures.push(`${name}: rejected a good input with ${JSON.stringify(err.message)}`);
    }
  }
  rmSync(survivingDir, { recursive: true, force: true });

  if (failures.length > 0) {
    for (const failure of failures) console.error(`Self-test failed: ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Self-test passed: ${REQUIRED_STEPS.length} required steps present, ${rejections.length} bad inputs rejected with the expected message, ${acceptances.length} good inputs accepted`,
  );
}

if (process.argv.includes('--self-test')) {
  selfTest().catch((err) => {
    console.error(`Self-test failed: ${err.message}`);
    process.exitCode = 1;
  });
} else {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
