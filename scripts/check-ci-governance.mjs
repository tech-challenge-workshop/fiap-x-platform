// Fails when the platform's CI stops proving the stack works.
//
// Workflow check (default mode, CIG-01, CIG-02). Reads CI_WORKFLOW_PATH
// (default .github/workflows/ci.yml) and, inside the `integration` job's
// indented block, requires:
//
//   no skip path       every `if:` is `failure()` or `always()`, and no
//                      `continue-on-error` lets a red step pass the job;
//   no token           SERVICES_READ_TOKEN appears nowhere in the workflow:
//                      the four service repositories are public;
//   the stack steps    the eight stack commands of the build gate run in
//                      this order, and no other stack command is mixed in.
//
// The block is parsed as text: the repository has no package.json, and the
// scripts use only Node's standard library. A reformatted workflow that the
// parser no longer understands fails loudly rather than passing.
//
// `--self-test` needs nothing external: it feeds the check bad, near-miss and
// good workflows and requires the exact messages, and spawns this script with
// CI_WORKFLOW_PATH pointing at a gated copy, which must exit non-zero.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(SELF), '..');
const WORKFLOW_PATH = process.env.CI_WORKFLOW_PATH
  ? resolve(process.env.CI_WORKFLOW_PATH)
  : join(REPO_ROOT, '.github/workflows/ci.yml');

const SMOKE = 'node scripts/smoke-local-integration.mjs';
const IDENTITY = 'node scripts/check-identity.mjs';
const RECREATE = 'docker compose up -d --wait --force-recreate identity storage-init api';
// The build gate's stack steps (platform-gate-hardening, steps 6-11).
const STACK_COMMANDS = [
  'docker compose up --build -d --wait',
  'node scripts/check-storage-bootstrap.mjs',
  'node scripts/generate-db-script.mjs --check',
  SMOKE,
  IDENTITY,
  RECREATE,
  SMOKE,
  IDENTITY,
];
const STACK_SET = new Set(STACK_COMMANDS);
const TOKEN = 'SERVICES_READ_TOKEN';

function fail(message) {
  console.error(`check-ci-governance: ${message}`);
  process.exit(1);
}

const indentOf = (line) => line.length - line.trimStart().length;
const unquote = (value) => {
  const v = value.trim();
  return /^(['"]).*\1$/.test(v) ? v.slice(1, -1) : v;
};

// The `integration:` key directly under `jobs:` and every line indented deeper
// than it. Returns { start, lines } with `start` the 1-based line number of
// the key, or undefined when there is no such job.
function integrationBlock(text) {
  const lines = text.split('\n');
  const jobs = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobs === -1) return undefined;
  let jobIndent;
  for (let i = jobs + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const indent = indentOf(line);
    if (indent === 0) return undefined;
    jobIndent ??= indent;
    if (indent !== jobIndent || !/^\s*integration:\s*$/.test(line)) continue;
    const block = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].trim() !== '' && indentOf(lines[j]) <= jobIndent) break;
      block.push(lines[j]);
    }
    return { start: i + 1, lines: block };
  }
  return undefined;
}

// Every command the block runs, in order: a one-line `run:` value, or each
// non-empty line of a block scalar (`run: |`).
function runCommands(block) {
  const commands = [];
  for (let i = 0; i < block.length; i += 1) {
    const match = /^(\s*(?:-\s+)?)run:\s*(.*)$/.exec(block[i]);
    if (!match) continue;
    const value = match[2].trim();
    if (!/^[|>]/.test(value)) {
      commands.push(unquote(value));
      continue;
    }
    const keyColumn = match[1].length;
    for (let j = i + 1; j < block.length; j += 1) {
      if (block[j].trim() === '') continue;
      if (indentOf(block[j]) <= keyColumn) break;
      commands.push(block[j].trim());
    }
  }
  return commands;
}

// Every problem with the workflow text, in the order the file shows them.
// An empty list means the integration job always runs the stack.
function workflowProblems(text) {
  const block = integrationBlock(text);
  if (!block) return ['the workflow has no `integration` job under `jobs:`'];
  const problems = [];

  block.lines.forEach((line, index) => {
    const lineNumber = block.start + 1 + index;
    const condition = /^\s*(?:-\s+)?if:\s*(.*)$/.exec(line);
    if (condition) {
      const expression = unquote(condition[1]).replace(/^\$\{\{\s*(.*?)\s*\}\}$/, '$1');
      if (expression !== 'failure()' && expression !== 'always()') {
        problems.push(
          `line ${lineNumber}: the integration job is conditioned on "${expression}"; only failure() or always() may gate its steps`,
        );
      }
    }
    if (/^\s*(?:-\s+)?continue-on-error:/.test(line)) {
      problems.push(`line ${lineNumber}: the integration job sets continue-on-error, so a failed stack step would pass the job`);
    }
  });

  text.split('\n').forEach((line, index) => {
    if (line.includes(TOKEN)) {
      problems.push(`line ${index + 1}: the workflow references ${TOKEN}; the service repositories are public and are checked out without a token`);
    }
  });

  // Only the stack commands, in the order the job runs them, must equal the
  // expected sequence; the first position that differs is named.
  const stack = runCommands(block.lines).filter((command) => STACK_SET.has(command));
  for (let i = 0; i < Math.max(stack.length, STACK_COMMANDS.length); i += 1) {
    if (stack[i] === STACK_COMMANDS[i]) continue;
    const expected = i < STACK_COMMANDS.length ? `"${STACK_COMMANDS[i]}"` : 'nothing more';
    const actual = i < stack.length ? `it is "${stack[i]}"` : 'the job runs no further stack command';
    problems.push(`integration stack step ${i + 1} must be ${expected}, but ${actual}`);
    break;
  }
  return problems;
}

function main() {
  let text;
  try {
    text = readFileSync(WORKFLOW_PATH, 'utf8');
  } catch (error) {
    fail(`could not read the workflow ${WORKFLOW_PATH}: ${error.message}`);
  }
  const problems = workflowProblems(text);
  if (problems.length > 0) fail(problems.join('\ncheck-ci-governance: '));
  console.log(`integration job runs the ${STACK_COMMANDS.length} stack commands in order, with no skip path and no token`);
}

// A correct workflow, shaped as the rewritten ci.yml: the checkouts carry no
// token, the stack commands run in order, logs are collected on failure and
// the stack is torn down always.
const GOOD = `name: CI
jobs:
  topology:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Only a topology step may be gated
        if: github.event_name == 'push'
        run: node scripts/check-ci-governance.mjs

  integration:
    needs: topology
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
        with:
          path: fiap-x-platform
      - uses: actions/checkout@v4
        with:
          repository: tech-challenge-workshop/fiap-x-api
          path: fiap-x-api
      - name: Start the stack and wait for every health check
        working-directory: fiap-x-platform
        run: docker compose up --build -d --wait
      - name: Run the storage-bootstrap scenarios
        working-directory: fiap-x-platform
        run: node scripts/check-storage-bootstrap.mjs
      - name: Check the database script has not drifted
        working-directory: fiap-x-platform
        run: node scripts/generate-db-script.mjs --check
      - name: Run the smoke test against the live stack
        working-directory: fiap-x-platform
        run: node scripts/smoke-local-integration.mjs
      - name: Check the identity service
        working-directory: fiap-x-platform
        run: node scripts/check-identity.mjs
      - name: Force-recreate identity, storage-init and api
        working-directory: fiap-x-platform
        run: docker compose up -d --wait --force-recreate identity storage-init api
      - name: Run the smoke test again after the recreate
        working-directory: fiap-x-platform
        run: node scripts/smoke-local-integration.mjs
      - name: Check the identity service again after the recreate
        working-directory: fiap-x-platform
        run: node scripts/check-identity.mjs
      - name: Collect container logs
        if: failure()
        working-directory: fiap-x-platform
        run: docker compose logs --no-color > container-logs.txt
      - name: Tear the stack down
        if: \${{ always() }}
        working-directory: fiap-x-platform
        run: |
          docker compose down -v

  docs-links:
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - run: echo links
`;

function replaceOnce(text, from, to) {
  if (!text.includes(from)) throw new Error(`self-test fixture does not contain ${JSON.stringify(from)}`);
  return text.replace(from, to);
}

const GATED = replaceOnce(
  GOOD,
  '      - name: Start the stack and wait for every health check\n',
  "      - name: Start the stack and wait for every health check\n        if: steps.access.outputs.available == 'true'\n",
);
const GATED_MESSAGE = `line 24: the integration job is conditioned on "steps.access.outputs.available == 'true'"; only failure() or always() may gate its steps`;

function selfTest() {
  const lineOf = (text, fragment) => text.split('\n').findIndex((line) => line.includes(fragment)) + 1;
  const withToken = replaceOnce(
    GOOD,
    '          path: fiap-x-api\n',
    '          path: fiap-x-api\n          token: ${{ secrets.SERVICES_READ_TOKEN }}\n',
  );
  const noFirstSmoke = replaceOnce(
    GOOD,
    '      - name: Run the smoke test against the live stack\n        working-directory: fiap-x-platform\n        run: node scripts/smoke-local-integration.mjs\n',
    '',
  );
  // Near-miss: every command is present, but the recreate runs before the
  // first identity check, so that check never sees the pre-recreate state.
  const recreateEarly = replaceOnce(
    GOOD,
    `        run: ${IDENTITY}\n      - name: Force-recreate identity, storage-init and api\n        working-directory: fiap-x-platform\n        run: ${RECREATE}\n`,
    `        run: ${RECREATE}\n      - name: Force-recreate identity, storage-init and api\n        working-directory: fiap-x-platform\n        run: ${IDENTITY}\n`,
  );
  const failureAndGate = replaceOnce(GOOD, '        if: failure()\n', "        if: failure() && steps.access.outputs.available == 'true'\n");
  const continueOnError = replaceOnce(GOOD, '    timeout-minutes: 45\n', '    timeout-minutes: 45\n    continue-on-error: true\n');
  const noIntegration = replaceOnce(GOOD, '  integration:\n', '  integration-disabled:\n');
  const recreateNearMiss = replaceOnce(GOOD, `run: ${RECREATE}`, 'run: docker compose up -d --wait --force-recreate identity api');
  const extraSmoke = replaceOnce(
    GOOD,
    '      - name: Collect container logs\n',
    `      - run: ${SMOKE}\n      - name: Collect container logs\n`,
  );
  const noStack = GOOD.split('\n').filter((line) => !STACK_SET.has(line.replace(/^\s*run:\s*/, ''))).join('\n');

  const rejections = [
    ['a stack step gated on steps.access', GATED, [GATED_MESSAGE]],
    ['a token reference on a checkout', withToken, [
      `line ${lineOf(withToken, 'token:')}: the workflow references SERVICES_READ_TOKEN; the service repositories are public and are checked out without a token`,
    ]],
    ['the first smoke missing', noFirstSmoke, [
      `integration stack step 4 must be "${SMOKE}", but it is "${IDENTITY}"`,
    ]],
    ['the recreate before the first identity check (near-miss)', recreateEarly, [
      `integration stack step 5 must be "${IDENTITY}", but it is "${RECREATE}"`,
    ]],
    ['failure() combined with steps.access (near-miss)', failureAndGate, [
      `line ${lineOf(failureAndGate, 'if: failure() &&')}: the integration job is conditioned on "failure() && steps.access.outputs.available == 'true'"; only failure() or always() may gate its steps`,
    ]],
    ['continue-on-error on the job', continueOnError, [
      `line ${lineOf(continueOnError, 'continue-on-error: true')}: the integration job sets continue-on-error, so a failed stack step would pass the job`,
    ]],
    ['no integration job', noIntegration, ['the workflow has no `integration` job under `jobs:`']],
    ['a recreate that skips storage-init (near-miss)', recreateNearMiss, [
      `integration stack step 6 must be "${RECREATE}", but it is "${SMOKE}"`,
    ]],
    ['an extra smoke after the stack steps', extraSmoke, [
      `integration stack step 9 must be nothing more, but it is "${SMOKE}"`,
    ]],
    ['every stack command missing', noStack, [
      'integration stack step 1 must be "docker compose up --build -d --wait", but the job runs no further stack command',
    ]],
  ];
  const acceptances = [
    ['a correct workflow', GOOD],
    ['a correct workflow with a quoted if value', replaceOnce(GOOD, 'if: failure()', "if: 'failure()'")],
  ];

  const failures = [];
  for (const [name, text, expected] of rejections) {
    const problems = workflowProblems(text);
    if (problems.length === 0) {
      failures.push(`${name}: accepted, expected rejection with ${JSON.stringify(expected)}`);
    } else if (JSON.stringify(problems) !== JSON.stringify(expected)) {
      failures.push(`${name}: rejected with ${JSON.stringify(problems)}, expected ${JSON.stringify(expected)}`);
    }
  }
  for (const [name, text] of acceptances) {
    const problems = workflowProblems(text);
    if (problems.length > 0) failures.push(`${name}: rejected a good workflow with ${JSON.stringify(problems)}`);
  }

  // The script itself, spawned on a gated copy, must exit non-zero with the
  // condition on stderr; spawned on the correct copy, it must exit 0.
  const dir = mkdtempSync(join(tmpdir(), 'check-ci-governance-'));
  try {
    const gatedPath = join(dir, 'gated.yml');
    const goodPath = join(dir, 'good.yml');
    writeFileSync(gatedPath, GATED);
    writeFileSync(goodPath, GOOD);
    const spawn = (path) => spawnSync(process.execPath, [SELF], { encoding: 'utf8', env: { ...process.env, CI_WORKFLOW_PATH: path } });
    const gated = spawn(gatedPath);
    const expectedStderr = `check-ci-governance: ${GATED_MESSAGE}\n`;
    if (gated.status === 0) failures.push('spawned run on a gated workflow exited 0, expected non-zero');
    if (gated.stderr !== expectedStderr) {
      failures.push(`spawned run on a gated workflow printed ${JSON.stringify(gated.stderr)} on stderr, expected ${JSON.stringify(expectedStderr)}`);
    }
    const good = spawn(goodPath);
    if (good.status !== 0) failures.push(`spawned run on a correct workflow exited ${good.status}: ${JSON.stringify(good.stderr)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`check-ci-governance self-test failed: ${failure}`);
    process.exit(1);
  }
  console.log(
    `check-ci-governance self-test passed: ${rejections.length} bad workflows rejected with the expected message, ${acceptances.length} good workflows accepted, spawned gated copy exited non-zero`,
  );
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  main();
}
