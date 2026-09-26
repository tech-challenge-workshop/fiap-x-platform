// Fails when the identity service loses a property the rest of the system
// relies on. Each was proven only by a hand-run probe in S5 (V24, V25):
//
//   sub pinned            alice's and bob's `sub` equal the ids pinned in
//                         identity/fiapx-realm.json. The build gate runs this
//                         script before and after force-recreating identity,
//                         so the ids are proven to survive a re-import.
//   in-network iss        a token requested inside the network, from the api
//                         container, carries the issuer the API validates.
//   registration disabled the realm refuses self-registration (admin REST,
//                         development credentials admin/admin, never printed).
//   h2 on tmpfs           the identity's embedded database is on tmpfs, so a
//                         restart re-imports the realm.
//   api after identity    compose starts the API only once identity is healthy.
//   get-token cli         `node scripts/get-token.mjs alice` prints one JWT line
//                         and nothing else, and names the compose service
//                         `identity` when it cannot reach it.
//
// GET_TOKEN_UNDER_TEST runs another copy of get-token.mjs, so a literal
// negative can run on a scratch copy.
//
// `--self-test` needs no stack: it feeds every check bad, near-miss and good
// observations and requires the exact message, and spawns this script with
// IDENTITY_URL=http://127.0.0.1:9, which must exit non-zero naming identity.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getToken } from './get-token.mjs';

const SELF = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = dirname(SELF);
const REPO_ROOT = join(SCRIPTS_DIR, '..');
const REALM_FILE = 'identity/fiapx-realm.json';
const IDENTITY_URL = process.env.IDENTITY_URL ?? 'http://localhost:8080';

// Literal, not read from compose.yaml: a changed issuer must fail here.
const EXPECTED_ISSUER = 'http://localhost:8080/realms/fiapx';
const H2_DIR = '/opt/keycloak/data/h2';
const UNREACHABLE_URL = 'http://127.0.0.1:9';
const UNREACHABLE_PREFIX = `get-token: the identity service (compose service "identity", ${UNREACHABLE_URL}) is unreachable`;
const JWT_LINE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\n$/;

// --- checks: each judges one observation and throws naming what it found ---

// `users` is [{ user, pinned, sub }]: the id the realm file pins and the sub
// of a token issued for that user.
function assertSubPinned(users) {
  for (const { user, pinned, sub } of users) {
    if (typeof pinned !== 'string' || pinned === '') {
      throw new Error(`${REALM_FILE} pins no id for ${user}, so its sub is not stable across a re-import`);
    }
    if (sub !== pinned) {
      throw new Error(`${user}'s token carries sub ${JSON.stringify(sub)}, expected ${pinned}, the id pinned in ${REALM_FILE}`);
    }
  }
}

function assertInNetworkIssuer(iss) {
  if (iss !== EXPECTED_ISSUER) {
    throw new Error(`a token issued inside the network carries iss ${JSON.stringify(iss)}, expected ${JSON.stringify(EXPECTED_ISSUER)}, the issuer the API validates`);
  }
}

// `realm` is the representation GET /admin/realms/fiapx returns.
function assertRegistrationDisabled(realm) {
  if (realm?.registrationAllowed !== false) {
    throw new Error(`realm fiapx has registrationAllowed ${JSON.stringify(realm?.registrationAllowed)}, expected false: self-registration must be disabled`);
  }
}

// `tmpfs` is the identity container's HostConfig.Tmpfs: mount path to options,
// or null when it has none.
function assertH2OnTmpfs(tmpfs) {
  if (!tmpfs || !Object.hasOwn(tmpfs, H2_DIR)) {
    throw new Error(`the identity container has no tmpfs at ${H2_DIR} (tmpfs mounts: ${JSON.stringify(tmpfs ?? {})}), so a restart keeps the realm and skips the import`);
  }
}

// `config` is `docker compose config --format json`, parsed.
function assertApiAfterIdentity(config) {
  const condition = config?.services?.api?.depends_on?.identity?.condition;
  if (condition !== 'service_healthy') {
    throw new Error(`api depends on identity with condition ${JSON.stringify(condition)}, expected "service_healthy": the API must not start before the identity is healthy`);
  }
}

// `cli` is { ok, unreachable }: the two spawned runs of get-token.mjs, each
// { status, stdout, stderr }.
function assertGetTokenCli({ ok, unreachable }) {
  const call = 'node scripts/get-token.mjs alice';
  if (ok.status !== 0) throw new Error(`${call} exited ${ok.status}, expected 0; stderr: ${ok.stderr.trim()}`);
  if (!JWT_LINE.test(ok.stdout)) {
    throw new Error(`${call} printed ${JSON.stringify(ok.stdout)} on stdout, expected exactly one JWT line`);
  }
  const offline = `IDENTITY_URL=${UNREACHABLE_URL} ${call}`;
  if (unreachable.status === 0) throw new Error(`${offline} exited 0, expected non-zero`);
  if (unreachable.stdout !== '') {
    throw new Error(`${offline} printed ${JSON.stringify(unreachable.stdout)} on stdout, expected nothing`);
  }
  if (!unreachable.stderr.startsWith(UNREACHABLE_PREFIX)) {
    throw new Error(`${offline} printed ${JSON.stringify(unreachable.stderr)} on stderr, expected a message starting ${JSON.stringify(UNREACHABLE_PREFIX)}`);
  }
}

// --- observations of the live stack ---

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: REPO_ROOT, encoding: 'utf8', ...options });
  if (result.error) throw new Error(`could not run ${command}: ${result.error.message}`);
  return result;
}

function compose(args) {
  const result = run('docker', ['compose', ...args]);
  if (result.status !== 0) throw new Error(`docker compose ${args[0]} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

function subOf(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
}

async function observePinnedSubs() {
  const realm = JSON.parse(readFileSync(join(REPO_ROOT, REALM_FILE), 'utf8'));
  const users = [];
  for (const user of ['alice', 'bob']) {
    const pinned = realm.users?.find((candidate) => candidate.username === user)?.id;
    users.push({ user, pinned, sub: subOf(await getToken(user)) });
  }
  return users;
}

// Runs inside the api container, which has Node, so the token comes from
// identity:8080 exactly as a service inside the network would get it.
const IN_NETWORK_ISSUER = `
const res = await fetch('http://identity:8080/realms/fiapx/protocol/openid-connect/token', {
  method: 'POST',
  body: new URLSearchParams({ grant_type: 'password', client_id: 'fiapx-cli', username: 'alice', password: 'alice-dev-password' }),
});
if (!res.ok) { console.error('identity:8080 answered ' + res.status); process.exit(1); }
const token = (await res.json()).access_token;
console.log(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).iss);
`;

function observeInNetworkIssuer() {
  return compose(['exec', '-T', 'api', 'node', '--input-type=module', '-e', IN_NETWORK_ISSUER]).trim();
}

// Development credentials from compose.yaml (AD-005); never printed.
async function observeRealm() {
  const tokenRes = await fetch(`${IDENTITY_URL}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: 'admin', password: 'admin' }),
  });
  if (!tokenRes.ok) throw new Error(`the identity service at ${IDENTITY_URL} refused the development admin login with ${tokenRes.status}`);
  const { access_token: adminToken } = await tokenRes.json();
  const realmRes = await fetch(`${IDENTITY_URL}/admin/realms/fiapx`, { headers: { Authorization: `Bearer ${adminToken}` } });
  if (!realmRes.ok) throw new Error(`GET ${IDENTITY_URL}/admin/realms/fiapx answered ${realmRes.status}`);
  return realmRes.json();
}

function observeTmpfs() {
  const id = compose(['ps', '-q', 'identity']).trim();
  if (id === '') throw new Error('no identity container is running');
  const out = run('docker', ['inspect', '--format', '{{json .HostConfig.Tmpfs}}', id]);
  if (out.status !== 0) throw new Error(`docker inspect of the identity container failed: ${out.stderr.trim()}`);
  return JSON.parse(out.stdout);
}

function observeComposeConfig() {
  return JSON.parse(compose(['config', '--format', 'json']));
}

function observeGetTokenCli() {
  const script = resolve(process.env.GET_TOKEN_UNDER_TEST ?? join(SCRIPTS_DIR, 'get-token.mjs'));
  const spawnCli = (env) => {
    const result = run(process.execPath, [script, 'alice'], { env });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  return {
    ok: spawnCli(process.env),
    unreachable: spawnCli({ ...process.env, IDENTITY_URL: UNREACHABLE_URL }),
  };
}

// The checks main() runs, in order. --self-test requires each by name.
export const IDENTITY_CHECKS = [
  { name: 'sub pinned', observe: observePinnedSubs, check: assertSubPinned },
  { name: 'in-network iss', observe: observeInNetworkIssuer, check: assertInNetworkIssuer },
  { name: 'registration disabled', observe: observeRealm, check: assertRegistrationDisabled },
  { name: 'h2 on tmpfs', observe: observeTmpfs, check: assertH2OnTmpfs },
  { name: 'api after identity', observe: observeComposeConfig, check: assertApiAfterIdentity },
  { name: 'get-token cli', observe: observeGetTokenCli, check: assertGetTokenCli },
];

async function main() {
  if (process.env.GET_TOKEN_UNDER_TEST) console.log(`get-token under test: ${resolve(process.env.GET_TOKEN_UNDER_TEST)}`);
  const failures = [];
  for (const { name, observe, check } of IDENTITY_CHECKS) {
    try {
      check(await observe());
      console.log(`check-identity: ${name} passed`);
    } catch (err) {
      failures.push(`${name} failed: ${err.message}`);
    }
  }
  if (failures.length > 0) {
    for (const failure of failures) console.error(`check-identity: ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`check-identity: ${IDENTITY_CHECKS.length} identity checks passed`);
}

const REQUIRED_CHECKS = ['sub pinned', 'in-network iss', 'registration disabled', 'h2 on tmpfs', 'api after identity', 'get-token cli'];

async function selfTest() {
  const alicePinned = '0f1c3a52-7a2e-4d8b-9c61-a11ce0000001';
  const bobPinned = '0f1c3a52-7a2e-4d8b-9c61-b0b000000002';
  const pinnedUsers = (aliceSub, bobSub = bobPinned, alicePin = alicePinned) => [
    { user: 'alice', pinned: alicePin, sub: aliceSub },
    { user: 'bob', pinned: bobPinned, sub: bobSub },
  ];
  const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhIn0.c2lnbmF0dXJl';
  const offlineMessage = `${UNREACHABLE_PREFIX} (ECONNREFUSED) - start the stack with \`docker compose up -d --wait\`\n`;
  const cli = ({ ok = {}, unreachable = {} } = {}) => ({
    ok: { status: 0, stdout: `${jwt}\n`, stderr: '', ...ok },
    unreachable: { status: 1, stdout: '', stderr: offlineMessage, ...unreachable },
  });
  const composeConfig = (identity) => ({
    services: { api: { depends_on: { rabbitmq: { condition: 'service_healthy' }, ...(identity ? { identity } : {}) } } },
  });
  const offline = `IDENTITY_URL=${UNREACHABLE_URL} node scripts/get-token.mjs alice`;

  const rejections = [
    ['sub pinned', "alice's sub is bob's id", pinnedUsers(bobPinned),
      `alice's token carries sub "${bobPinned}", expected ${alicePinned}, the id pinned in ${REALM_FILE}`],
    ['sub pinned', "bob's sub differs in its last character (near-miss)", pinnedUsers(alicePinned, `${bobPinned.slice(0, -1)}3`),
      `bob's token carries sub "${bobPinned.slice(0, -1)}3", expected ${bobPinned}, the id pinned in ${REALM_FILE}`],
    ['sub pinned', 'no id pinned for alice', pinnedUsers('generated-on-import', bobPinned, null),
      `${REALM_FILE} pins no id for alice, so its sub is not stable across a re-import`],
    ['in-network iss', 'the internal hostname (KC_HOSTNAME dropped)', 'http://identity:8080/realms/fiapx',
      `a token issued inside the network carries iss "http://identity:8080/realms/fiapx", expected "${EXPECTED_ISSUER}", the issuer the API validates`],
    ['in-network iss', 'a trailing slash (near-miss)', `${EXPECTED_ISSUER}/`,
      `a token issued inside the network carries iss "${EXPECTED_ISSUER}/", expected "${EXPECTED_ISSUER}", the issuer the API validates`],
    ['in-network iss', 'another realm (near-miss)', 'http://localhost:8080/realms/fiap',
      `a token issued inside the network carries iss "http://localhost:8080/realms/fiap", expected "${EXPECTED_ISSUER}", the issuer the API validates`],
    ['registration disabled', 'registration allowed', { realm: 'fiapx', registrationAllowed: true },
      'realm fiapx has registrationAllowed true, expected false: self-registration must be disabled'],
    ['registration disabled', 'the field absent (near-miss)', { realm: 'fiapx' },
      'realm fiapx has registrationAllowed undefined, expected false: self-registration must be disabled'],
    ['registration disabled', 'the string "false" (near-miss)', { realm: 'fiapx', registrationAllowed: 'false' },
      'realm fiapx has registrationAllowed "false", expected false: self-registration must be disabled'],
    ['h2 on tmpfs', 'no tmpfs at all', null,
      `the identity container has no tmpfs at ${H2_DIR} (tmpfs mounts: {}), so a restart keeps the realm and skips the import`],
    ['h2 on tmpfs', 'tmpfs on the parent directory (near-miss)', { '/opt/keycloak/data': '' },
      `the identity container has no tmpfs at ${H2_DIR} (tmpfs mounts: {"/opt/keycloak/data":""}), so a restart keeps the realm and skips the import`],
    ['api after identity', 'no dependency on identity', composeConfig(undefined),
      'api depends on identity with condition undefined, expected "service_healthy": the API must not start before the identity is healthy'],
    ['api after identity', 'started, not healthy (near-miss)', composeConfig({ condition: 'service_started' }),
      'api depends on identity with condition "service_started", expected "service_healthy": the API must not start before the identity is healthy'],
    ['get-token cli', 'a label before the token', cli({ ok: { stdout: `token: ${jwt}\n` } }),
      `node scripts/get-token.mjs alice printed ${JSON.stringify(`token: ${jwt}\n`)} on stdout, expected exactly one JWT line`],
    ['get-token cli', 'the token then a second line (near-miss)', cli({ ok: { stdout: `${jwt}\nexpires in 300 s\n` } }),
      `node scripts/get-token.mjs alice printed ${JSON.stringify(`${jwt}\nexpires in 300 s\n`)} on stdout, expected exactly one JWT line`],
    ['get-token cli', 'a token of two segments (near-miss)', cli({ ok: { stdout: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhIn0\n' } }),
      'node scripts/get-token.mjs alice printed "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhIn0\\n" on stdout, expected exactly one JWT line'],
    ['get-token cli', 'exit 1 for a reachable identity', cli({ ok: { status: 1, stdout: '', stderr: 'get-token: rejected\n' } }),
      'node scripts/get-token.mjs alice exited 1, expected 0; stderr: get-token: rejected'],
    ['get-token cli', 'exit 0 when unreachable', cli({ unreachable: { status: 0 } }),
      `${offline} exited 0, expected non-zero`],
    ['get-token cli', 'the unreachable message naming keycloak', cli({ unreachable: { stderr: 'get-token: keycloak at http://127.0.0.1:9 is unreachable\n' } }),
      `${offline} printed "get-token: keycloak at http://127.0.0.1:9 is unreachable\\n" on stderr, expected a message starting ${JSON.stringify(UNREACHABLE_PREFIX)}`],
    ['get-token cli', 'the unreachable message on stdout', cli({ unreachable: { stdout: offlineMessage, stderr: '' } }),
      `${offline} printed ${JSON.stringify(offlineMessage)} on stdout, expected nothing`],
  ];
  const acceptances = [
    ['sub pinned', 'both subs equal their pinned ids', pinnedUsers(alicePinned)],
    ['in-network iss', 'the public issuer', EXPECTED_ISSUER],
    ['registration disabled', 'registrationAllowed false', { realm: 'fiapx', registrationAllowed: false }],
    ['h2 on tmpfs', 'the H2 directory on tmpfs', { [H2_DIR]: 'uid=1000,gid=0,mode=0770' }],
    ['api after identity', 'service_healthy', composeConfig({ condition: 'service_healthy', required: true })],
    ['get-token cli', 'one JWT line, and identity named when unreachable', cli()],
  ];

  const checkNamed = (name) => {
    const found = IDENTITY_CHECKS.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`check "${name}" is missing from IDENTITY_CHECKS`);
    return found.check;
  };
  const failures = [];
  const names = IDENTITY_CHECKS.map((candidate) => candidate.name);
  if (JSON.stringify(names) !== JSON.stringify(REQUIRED_CHECKS)) {
    failures.push(`IDENTITY_CHECKS is ${JSON.stringify(names)}, expected ${JSON.stringify(REQUIRED_CHECKS)}`);
  }
  for (const [name, what, observation, expected] of rejections) {
    try {
      checkNamed(name)(observation);
      failures.push(`${name} given ${what}: accepted, expected rejection with ${JSON.stringify(expected)}`);
    } catch (err) {
      if (err.message !== expected) failures.push(`${name} given ${what}: rejected with ${JSON.stringify(err.message)}, expected ${JSON.stringify(expected)}`);
    }
  }
  for (const [name, what, observation] of acceptances) {
    try {
      checkNamed(name)(observation);
    } catch (err) {
      failures.push(`${name} given ${what}: rejected a good input with ${JSON.stringify(err.message)}`);
    }
  }
  for (const name of REQUIRED_CHECKS) {
    if (!rejections.some(([check]) => check === name) || !acceptances.some(([check]) => check === name)) {
      failures.push(`check "${name}" has no bad or no good input in the self-test`);
    }
  }

  // GATE-12: the script itself, spawned against an identity nothing listens
  // for, must exit non-zero naming the compose service identity.
  const spawned = spawnSync(process.execPath, [SELF], { encoding: 'utf8', env: { ...process.env, IDENTITY_URL: UNREACHABLE_URL } });
  const expectedLine = `check-identity: sub pinned failed: the identity service (compose service "identity", ${UNREACHABLE_URL}) is unreachable`;
  if (spawned.status === 0) failures.push(`spawned run with IDENTITY_URL=${UNREACHABLE_URL} exited 0, expected non-zero`);
  if (!spawned.stderr.split('\n').some((line) => line.startsWith(expectedLine))) {
    failures.push(`spawned run's stderr has no line starting ${JSON.stringify(expectedLine)}; stderr: ${JSON.stringify(spawned.stderr)}`);
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`check-identity self-test failed: ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `check-identity self-test passed: ${REQUIRED_CHECKS.length} required checks present, ${rejections.length} bad inputs rejected with the expected message, `
      + `${acceptances.length} good inputs accepted, spawned failure exited non-zero`,
  );
}

if (process.argv.includes('--self-test')) {
  selfTest().catch((err) => {
    console.error(`check-identity self-test failed: ${err.message}`);
    process.exitCode = 1;
  });
} else {
  main().catch((err) => {
    console.error(`check-identity: ${err.message}`);
    process.exitCode = 1;
  });
}
