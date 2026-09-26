// Prints an access token for a demo user, and nothing else, on stdout:
//
//   node scripts/get-token.mjs alice
//   node scripts/get-token.mjs bob --password <p>
//
// It asks the identity service for a token with the password grant through
// the public client fiapx-cli. OAuth 2.1 discourages that grant; it is
// acceptable here because the client exists only in the local development
// realm (identity/fiapx-realm.json). The password defaults to the user's demo
// password from that realm.
//
// The smoke imports getToken() from this file, so importing it must not run
// the command line.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const IDENTITY_URL = process.env.IDENTITY_URL ?? 'http://localhost:8080';
const TOKEN_URL = `${IDENTITY_URL}/realms/fiapx/protocol/openid-connect/token`;
const CLIENT_ID = 'fiapx-cli';
const IDENTITY = `the identity service (compose service "identity", ${IDENTITY_URL})`;
const TIMEOUT_MS = 10000;

// Development credentials only, committed in the realm by the same rule as
// the PostgreSQL ones (AD-005).
const DEMO_PASSWORDS = {
  alice: 'alice-dev-password',
  bob: 'bob-dev-password',
};

// Returns the access token for user, or throws an Error whose message names
// what went wrong: the rejected user, or the unreachable identity service.
export async function getToken(user, password = DEMO_PASSWORDS[user] ?? '') {
  let response;
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'password', client_id: CLIENT_ID, username: user, password }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const cause = err.cause?.code ?? err.cause?.message ?? err.message;
    throw new Error(`${IDENTITY} is unreachable (${cause}) - start the stack with \`docker compose up -d --wait\``);
  }

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${IDENTITY} answered ${response.status} with a body that is not JSON`);
  }

  if (!response.ok) {
    const reason = body.error_description ?? body.error ?? 'no error given';
    throw new Error(`${IDENTITY} rejected user "${user}" with ${response.status}: ${reason}`);
  }
  if (typeof body.access_token !== 'string') {
    throw new Error(`${IDENTITY} answered ${response.status} without an access_token for user "${user}"`);
  }
  return body.access_token;
}

function parseArgs(argv) {
  const [user, ...rest] = argv;
  if (!user || user.startsWith('-')) return null;
  if (rest.length === 0) return { user };
  if (rest.length === 2 && rest[0] === '--password') return { user, password: rest[1] };
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error('usage: node scripts/get-token.mjs <user> [--password <password>]');
    process.exit(2);
  }
  try {
    console.log(await getToken(args.user, args.password));
  } catch (err) {
    console.error(`get-token: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
