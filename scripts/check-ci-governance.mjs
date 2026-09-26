// Fails when the platform's CI stops proving the stack works.
//
// Workflow check (default mode, CIG-01, CIG-02). Reads CI_WORKFLOW_PATH
// (default .github/workflows/ci.yml) and, inside the `integration` job's
// indented block, parsed into its own keys and its steps, requires:
//
//   no skip path       the job sets no `if:`, `shell:` or `continue-on-error`
//                      (nor does the workflow set a default shell); only the
//                      two log steps may carry `failure()` and only the
//                      teardown `always()`, and no other step is conditioned;
//   no mask            each stack command is the whole one-line `run:` of its
//                      own step, so no `set +e` or `|| true` can surround it;

//   no token           SERVICES_READ_TOKEN appears nowhere in the workflow:
//                      the four service repositories are public;
//   the stack steps    the eight stack commands of the build gate run in
//                      this order, and no other stack command is mixed in.
//
// The block is parsed as text: the repository has no package.json, and the
// scripts use only Node's standard library. A reformatted workflow that the
// parser no longer understands fails loudly rather than passing.
//
// Live check (`--live`, CIG-03). Reads CI_REQUIRED_CHECKS_PATH (default
// ci/required-checks.json) and, through `gh api`, each repository's rulesets.
// Each repository must have exactly one ruleset named `protect main`, active,
// targeting only the default branch (`~DEFAULT_BRANCH`), whose required
// status checks equal the file's list as a set. A difference is reported as
// `<repo>: missing [..], unexpected [..]`. `gh` must be authenticated.
//
// `--self-test` needs nothing external: it feeds the workflow check bad,
// near-miss and good workflows and the live comparison injected rulesets, and
// requires the exact messages. It spawns this script with CI_WORKFLOW_PATH
// pointing at a gated copy, which must exit non-zero, and with `--live` and an
// empty gh configuration, which must fail on the authentication check before
// any call to GitHub.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(SELF), '..');
const WORKFLOW_PATH = process.env.CI_WORKFLOW_PATH
  ? resolve(process.env.CI_WORKFLOW_PATH)
  : join(REPO_ROOT, '.github/workflows/ci.yml');
export const CHECKS_PATH = process.env.CI_REQUIRED_CHECKS_PATH
  ? resolve(process.env.CI_REQUIRED_CHECKS_PATH)
  : join(REPO_ROOT, 'ci/required-checks.json');
export const RULESET_NAME = 'protect main';
const DEFAULT_BRANCH = '~DEFAULT_BRANCH';
const GH_UNAUTHENTICATED = 'gh is not authenticated; --live reads the rulesets';

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

const isContent = (line) => line.trim() !== '' && !line.trimStart().startsWith('#');
const KEY = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/;

// The job's own keys and its steps. Each step is { index, name, if, run,
// multiline, uses }: `run` is the value as written (a block scalar's lines
// joined by newlines), and `multiline` is true when the value spans more than
// one line (a block scalar, or a plain scalar continued on the next line).
// Returns { keys, steps } with `keys` mapping each job-level key to its value.
function parseSteps(block) {
  const content = block.filter(isContent);
  const keys = {};
  const steps = [];
  if (content.length === 0) return { keys, steps };
  const jobKeyIndent = indentOf(content[0]);
  let i = 0;
  while (i < block.length) {
    const line = block[i];
    if (!isContent(line) || indentOf(line) !== jobKeyIndent) { i += 1; continue; }
    const match = KEY.exec(line.trim());
    if (!match) { i += 1; continue; }
    keys[match[1]] = unquote(match[2] ?? '');
    i += 1;
    if (match[1] !== 'steps') continue;
    // Each `- ` item deeper than `steps:` is a step; its keys sit two columns
    // right of the dash.
    let stepIndent;
    while (i < block.length && (!isContent(block[i]) || indentOf(block[i]) > jobKeyIndent)) {
      const itemLine = block[i];
      if (!isContent(itemLine)) { i += 1; continue; }
      stepIndent ??= indentOf(itemLine);
      if (indentOf(itemLine) !== stepIndent || !itemLine.trimStart().startsWith('- ')) { i += 1; continue; }
      const step = { index: steps.length + 1, name: undefined, if: undefined, run: undefined, multiline: false, uses: undefined };
      const keyIndent = stepIndent + 2;
      const lines = [' '.repeat(keyIndent) + itemLine.trimStart().slice(2)];
      for (i += 1; i < block.length; i += 1) {
        if (isContent(block[i]) && indentOf(block[i]) <= stepIndent) break;
        lines.push(block[i]);
      }
      for (let k = 0; k < lines.length; k += 1) {
        if (!isContent(lines[k]) || indentOf(lines[k]) !== keyIndent) continue;
        const stepKey = KEY.exec(lines[k].trim());
        if (!stepKey || !['name', 'if', 'run', 'uses'].includes(stepKey[1])) continue;
        const value = (stepKey[2] ?? '').trim();
        const continued = [];
        for (let c = k + 1; c < lines.length && (lines[c].trim() === '' || indentOf(lines[c]) > keyIndent); c += 1) {
          if (lines[c].trim() !== '') continued.push(lines[c].trim());
        }
        if (stepKey[1] === 'run') {
          step.multiline = /^[|>]/.test(value) || continued.length > 0;
          step.run = /^[|>]/.test(value) ? continued.join('\n') : [unquote(value), ...continued].join('\n');
        } else {
          step[stepKey[1]] = /^[|>]/.test(value) ? continued.join(' ') : [unquote(value), ...continued].join(' ');
        }
      }
      steps.push(step);
    }
  }
  return { keys, steps };
}

// The steps a condition may gate, with the one expression each may carry:
// logs are collected only when the job failed, and the stack is always torn
// down. Any other conditioned step, or the job itself, could skip the stack.
const CONDITIONED_STEPS = {
  'Collect container logs': 'failure()',
  'Upload container logs': 'failure()',
  'Tear the stack down': 'always()',
};
const expressionOf = (value) => value.replace(/^\$\{\{\s*(.*?)\s*\}\}$/, '$1');

// The top-level `defaults:` block's lines.
function workflowDefaults(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^defaults:\s*$/.test(line));
  if (start === -1) return [];
  const block = [];
  for (let j = start + 1; j < lines.length && (!isContent(lines[j]) || indentOf(lines[j]) > 0); j += 1) block.push(lines[j]);
  return block;
}


// Every problem with the workflow text, in the order the file shows them.
// An empty list means the integration job always runs the stack.
function workflowProblems(text) {
  const block = integrationBlock(text);
  if (!block) return ['the workflow has no `integration` job under `jobs:`'];
  const problems = [];
  const { keys, steps } = parseSteps(block.lines);

  // Rule 1: the job itself is never conditioned, and neither the job nor any
  // step may let a failed command pass (continue-on-error) or swap the shell
  // that fails on the first error (shell:, anywhere in the job, including
  // `defaults:`, or as the workflow's default).
  if (Object.hasOwn(keys, 'if')) problems.push('the integration job must not set if');
  if (block.lines.some((line) => /^\s*(?:-\s+)?shell:/.test(line))) problems.push('the integration job must not set shell');
  if (block.lines.some((line) => /^\s*(?:-\s+)?continue-on-error:/.test(line))) {
    problems.push('the integration job must not set continue-on-error');
  }
  if (workflowDefaults(text).some((line) => /^\s*(?:-\s+)?shell:/.test(line))) {
    problems.push('the workflow must not set a default shell; it would apply to the integration job');
  }

  // Rule 2: only the allow-listed steps may carry a condition, each exactly
  // its own expression, and never a step that runs a stack command.
  for (const step of steps) {
    if (step.if === undefined) continue;
    const expression = expressionOf(step.if);
    const label = step.name ?? step.run ?? step.uses ?? `#${step.index}`;
    const runsStack = STACK_COMMANDS.some((command) => (step.run ?? '').includes(command));
    if (CONDITIONED_STEPS[step.name] !== expression || runsStack) {
      problems.push(`step "${label}" must not be conditioned on "${expression}"`);
    }
  }

  // Rule 3: a stack command runs as the whole one-line `run:` of its own step,
  // so no shell text (set +e, || true, exit 0) can surround it.
  for (const step of steps) {
    if (step.run === undefined) continue;
    for (const command of new Set(STACK_COMMANDS)) {
      if (step.run.includes(command) && (step.multiline || step.run !== command)) {
        problems.push(`stack command "${command}" must be a one-line run step of its own`);
      }
    }
  }


  text.split('\n').forEach((line, index) => {
    if (line.includes(TOKEN)) {
      problems.push(`line ${index + 1}: the workflow references ${TOKEN}; the service repositories are public and are checked out without a token`);
    }
  });

  // Only the stack commands, in the order the job runs them, must equal the
  // expected sequence; the first position that differs is named.
  const stack = steps.filter((step) => !step.multiline && STACK_SET.has(step.run)).map((step) => step.run);

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

// The versioned required checks: repository -> non-empty list of check names.
export function readRequiredChecks(path = CHECKS_PATH) {
  const checks = JSON.parse(readFileSync(path, 'utf8'));
  if (checks === null || typeof checks !== 'object' || Array.isArray(checks) || Object.keys(checks).length === 0) {
    throw new Error(`${path} must map each repository to its required checks`);
  }
  for (const [repo, list] of Object.entries(checks)) {
    const valid = Array.isArray(list) && list.length > 0 && list.every((c) => typeof c === 'string' && c !== '');
    if (!valid || new Set(list).size !== list.length) {
      throw new Error(`${path}: ${repo} must list its required checks as distinct non-empty names`);
    }
  }
  return checks;
}

const requiredContexts = (ruleset) => {
  const rule = (ruleset.rules ?? []).find((r) => r.type === 'required_status_checks');
  return (rule?.parameters?.required_status_checks ?? []).map((check) => check.context);
};

// Every problem with one repository's `protect main` ruleset, given the full
// rulesets fetched for that repository. An empty list means it requires
// exactly `expected`.
export function rulesetProblems(repo, expected, rulesets) {
  const named = rulesets.filter((ruleset) => ruleset.name === RULESET_NAME);
  if (named.length === 0) return [`${repo}: no ruleset named "${RULESET_NAME}"`];
  if (named.length > 1) return [`${repo}: ${named.length} rulesets are named "${RULESET_NAME}"; expected exactly one`];
  const [ruleset] = named;
  const problems = [];
  if (ruleset.enforcement !== 'active') {
    problems.push(`${repo}: ruleset "${RULESET_NAME}" is "${ruleset.enforcement}", not "active"`);
  }
  const include = ruleset.conditions?.ref_name?.include ?? [];
  const exclude = ruleset.conditions?.ref_name?.exclude ?? [];
  if (ruleset.target !== 'branch' || include.length !== 1 || include[0] !== DEFAULT_BRANCH || exclude.length !== 0) {
    problems.push(
      `${repo}: ruleset "${RULESET_NAME}" targets ${ruleset.target} ${JSON.stringify({ include, exclude })}, not the default branch alone (${DEFAULT_BRANCH})`,
    );
  }
  const live = requiredContexts(ruleset);
  const missing = expected.filter((check) => !live.includes(check));
  const unexpected = [...new Set(live)].filter((check) => !expected.includes(check));
  if (missing.length > 0 || unexpected.length > 0) {
    problems.push(`${repo}: missing [${missing.join(', ')}], unexpected [${unexpected.join(', ')}]`);
  }
  return problems;
}

// Problems across every repository in `checks`; `rulesetsByRepo` holds the
// fetched rulesets of each.
export function liveProblems(checks, rulesetsByRepo) {
  return Object.entries(checks).flatMap(([repo, expected]) => rulesetProblems(repo, expected, rulesetsByRepo[repo] ?? []));
}

// `gh` with the given arguments; stdout, or an Error naming the call.
export function gh(args, input) {
  const result = spawnSync('gh', args, { encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw new Error(`could not run gh: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`gh ${args.join(' ')} exited ${result.status}: ${result.stderr.trim()}`);
  return result.stdout;
}

export function ghAuthenticated() {
  const result = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
  return !result.error && result.status === 0;
}

// The full ruleset of every ruleset named `protect main` in the repository
// (the list endpoint returns summaries without rules).
export function fetchProtectMain(repo) {
  const summaries = JSON.parse(gh(['api', `repos/${repo}/rulesets`]));
  return summaries
    .filter((summary) => summary.name === RULESET_NAME)
    .map((summary) => JSON.parse(gh(['api', `repos/${repo}/rulesets/${summary.id}`])));
}

function live() {
  if (!ghAuthenticated()) fail(GH_UNAUTHENTICATED);
  let checks;
  try {
    checks = readRequiredChecks();
  } catch (error) {
    fail(error.message);
  }
  const rulesetsByRepo = {};
  for (const repo of Object.keys(checks)) {
    try {
      rulesetsByRepo[repo] = fetchProtectMain(repo);
    } catch (error) {
      fail(`${repo}: ${error.message}`);
    }
  }
  const problems = liveProblems(checks, rulesetsByRepo);
  if (problems.length > 0) fail(problems.join('\ncheck-ci-governance: '));
  console.log(`the ${Object.keys(checks).length} "${RULESET_NAME}" rulesets require exactly the checks in ci/required-checks.json`);
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
      - name: Upload container logs
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: container-logs
          path: fiap-x-platform/container-logs.txt
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
const GATED_MESSAGE = `step "Start the stack and wait for every health check" must not be conditioned on "steps.access.outputs.available == 'true'"`;

// A `protect main` ruleset as `gh api repos/<repo>/rulesets/<id>` returns it,
// requiring `contexts`; `change` edits the copy before it is returned.
const WORKER = 'tech-challenge-workshop/processing-worker';
const PLATFORM = 'tech-challenge-workshop/fiap-x-platform';
function liveRuleset(contexts, change = () => {}) {
  const ruleset = {
    id: 23709809,
    name: 'protect main',
    target: 'branch',
    source_type: 'Repository',
    source: WORKER,
    enforcement: 'active',
    conditions: { ref_name: { exclude: [], include: ['~DEFAULT_BRANCH'] } },
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      { type: 'required_linear_history' },
      { type: 'pull_request', parameters: { required_approving_review_count: 0, allowed_merge_methods: ['merge', 'squash', 'rebase'] } },
      {
        type: 'required_status_checks',
        parameters: {
          strict_required_status_checks_policy: false,
          do_not_enforce_on_create: false,
          required_status_checks: contexts.map((context) => ({ context })),
        },
      },
    ],
    bypass_actors: [],
  };
  change(ruleset);
  return ruleset;
}

// The required checks the spec decides (CIG-04 AC1, AC2); the versioned file
// must say exactly this.
const DECIDED_CHECKS = {
  'tech-challenge-workshop/fiap-x-api': ['quality', 'image'],
  'tech-challenge-workshop/processing-catalog': ['quality', 'image'],
  'tech-challenge-workshop/processing-worker': ['quality', 'image'],
  'tech-challenge-workshop/notification-service': ['quality', 'image'],
  'tech-challenge-workshop/fiap-x-platform': ['topology', 'docs-links', 'integration'],
};

function liveSelfTest(failures) {
  const want = ['quality', 'image'];
  const rejections = [
    ['a missing check', [liveRuleset(['quality'])], [`${WORKER}: missing [image], unexpected []`]],
    ['an extra check', [liveRuleset(['quality', 'image', 'lint'])], [`${WORKER}: missing [], unexpected [lint]`]],
    ['a ruleset on refs/heads/main instead of the default branch (near-miss)',
      [liveRuleset(want, (r) => { r.conditions.ref_name.include = ['refs/heads/main']; })],
      [`${WORKER}: ruleset "protect main" targets branch {"include":["refs/heads/main"],"exclude":[]}, not the default branch alone (~DEFAULT_BRANCH)`]],
    ['a ruleset on tags (near-miss)',
      [liveRuleset(want, (r) => { r.target = 'tag'; })],
      [`${WORKER}: ruleset "protect main" targets tag {"include":["~DEFAULT_BRANCH"],"exclude":[]}, not the default branch alone (~DEFAULT_BRANCH)`]],
    ['an inactive ruleset', [liveRuleset(want, (r) => { r.enforcement = 'evaluate'; })],
      [`${WORKER}: ruleset "protect main" is "evaluate", not "active"`]],
    ['no ruleset named protect main (near-miss name)', [liveRuleset(want, (r) => { r.name = 'protect-main'; })],
      [`${WORKER}: no ruleset named "protect main"`]],
    ['two rulesets named protect main', [liveRuleset(want), liveRuleset(want)],
      [`${WORKER}: 2 rulesets are named "protect main"; expected exactly one`]],
    ['no required_status_checks rule',
      [liveRuleset(want, (r) => { r.rules = r.rules.filter((rule) => rule.type !== 'required_status_checks'); })],
      [`${WORKER}: missing [quality, image], unexpected []`]],
  ];
  for (const [name, rulesets, expected] of rejections) {
    const problems = rulesetProblems(WORKER, want, rulesets);
    if (JSON.stringify(problems) !== JSON.stringify(expected)) {
      failures.push(`live, ${name}: got ${JSON.stringify(problems)}, expected ${JSON.stringify(expected)}`);
    }
  }
  const acceptances = [
    ['an exact match', [liveRuleset(want)]],
    ['an exact match in another order, beside an unrelated ruleset',
      [liveRuleset(['image', 'quality']), liveRuleset(['release'], (r) => { r.name = 'protect tags'; r.target = 'tag'; })]],
  ];
  for (const [name, rulesets] of acceptances) {
    const problems = rulesetProblems(WORKER, want, rulesets);
    if (problems.length > 0) failures.push(`live, ${name}: rejected with ${JSON.stringify(problems)}`);
  }

  // Across repositories: only the one that differs is named (the spec's
  // independent test removes `image` from one repository's versioned list).
  const fetched = {
    [WORKER]: [liveRuleset(['quality', 'image'])],
    [PLATFORM]: [liveRuleset(['topology', 'docs-links', 'integration'])],
  };
  const oneDrifted = liveProblems({ [WORKER]: ['quality'], [PLATFORM]: ['topology', 'docs-links', 'integration'] }, fetched);
  const oneDriftedExpected = [`${WORKER}: missing [], unexpected [image]`];
  if (JSON.stringify(oneDrifted) !== JSON.stringify(oneDriftedExpected)) {
    failures.push(`live, one repository drifted: got ${JSON.stringify(oneDrifted)}, expected ${JSON.stringify(oneDriftedExpected)}`);
  }
  const noneDrifted = liveProblems({ [WORKER]: ['quality', 'image'], [PLATFORM]: ['topology', 'docs-links', 'integration'] }, fetched);
  if (noneDrifted.length > 0) failures.push(`live, every repository matches: rejected with ${JSON.stringify(noneDrifted)}`);

  // The versioned file says what the spec decided.
  let versioned;
  try {
    versioned = readRequiredChecks(CHECKS_PATH);
  } catch (error) {
    versioned = error.message;
  }
  if (JSON.stringify(versioned) !== JSON.stringify(DECIDED_CHECKS)) {
    failures.push(`${CHECKS_PATH} holds ${JSON.stringify(versioned)}, expected ${JSON.stringify(DECIDED_CHECKS)}`);
  }
  return { rejected: rejections.length, accepted: acceptances.length + 1 };
}

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
  const SECOND_SMOKE = '      - name: Run the smoke test again after the recreate\n';
  const FIRST_SMOKE = '      - name: Run the smoke test against the live stack\n';
  const m10 = replaceOnce(GOOD, SECOND_SMOKE, `${SECOND_SMOKE}        if: failure()\n`);
  const m11 = replaceOnce(GOOD, '    needs: topology\n', '    needs: topology\n    if: failure()\n');
  const m14 = replaceOnce(
    GOOD,
    `${FIRST_SMOKE}        working-directory: fiap-x-platform\n        run: ${SMOKE}\n`,
    `${FIRST_SMOKE}        working-directory: fiap-x-platform\n        run: |\n          set +e\n          ${SMOKE}\n          exit 0\n`,
  );
  const shellStep = replaceOnce(GOOD, `${FIRST_SMOKE}`, `${FIRST_SMOKE}        shell: bash {0}\n`);
  const shellDefault = replaceOnce(GOOD, '    timeout-minutes: 45\n', '    timeout-minutes: 45\n    defaults:\n      run:\n        shell: bash {0}\n');
  const workflowShell = replaceOnce(GOOD, 'jobs:\n', 'defaults:\n  run:\n    shell: bash {0}\njobs:\n');
  const orTrue = replaceOnce(GOOD, `${FIRST_SMOKE}        working-directory: fiap-x-platform\n        run: ${SMOKE}\n`,
    `${FIRST_SMOKE}        working-directory: fiap-x-platform\n        run: ${SMOKE} || true\n`);
  const renamedStack = replaceOnce(GOOD, FIRST_SMOKE, '      - name: Collect container logs\n        if: failure()\n');
  const alwaysOnLogs = replaceOnce(GOOD, '      - name: Upload container logs\n        if: failure()\n', '      - name: Upload container logs\n        if: always()\n');
  const failureTeardown = replaceOnce(GOOD, '        if: \${{ always() }}\n', '        if: failure()\n');
  const continueOnStep = replaceOnce(GOOD, SECOND_SMOKE, `${SECOND_SMOKE}        continue-on-error: true\n`);


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
      `step "Collect container logs" must not be conditioned on "failure() && steps.access.outputs.available == 'true'"`,
    ]],
    ['continue-on-error on the job', continueOnError, ['the integration job must not set continue-on-error']],
    ['M10: failure() on the second-smoke step', m10, [
      'step "Run the smoke test again after the recreate" must not be conditioned on "failure()"',
    ]],
    ['M11: a job-level if: failure() (skipped on every green topology)', m11, ['the integration job must not set if']],
    ['M14: the first smoke masked by set +e / exit 0 in a run: | block', m14, [
      `stack command "${SMOKE}" must be a one-line run step of its own`,
      `integration stack step 4 must be "${SMOKE}", but it is "${IDENTITY}"`,
    ]],
    ['a shell: override on a stack step', shellStep, ['the integration job must not set shell']],
    ['a shell: default for the job (near-miss)', shellDefault, ['the integration job must not set shell']],
    ['a workflow-level default shell (near-miss)', workflowShell, ['the workflow must not set a default shell; it would apply to the integration job']],
    ['the smoke masked by || true on one line (near-miss)', orTrue, [
      `stack command "${SMOKE}" must be a one-line run step of its own`,
      `integration stack step 4 must be "${SMOKE}", but it is "${IDENTITY}"`,
    ]],
    ['a stack step renamed to an allow-listed log step (near-miss)', renamedStack, [
      'step "Collect container logs" must not be conditioned on "failure()"',
    ]],
    ['always() moved to a log step (near-miss)', alwaysOnLogs, [
      'step "Upload container logs" must not be conditioned on "always()"',
    ]],
    ['failure() on the teardown (near-miss)', failureTeardown, [
      'step "Tear the stack down" must not be conditioned on "failure()"',
    ]],
    ['continue-on-error on a stack step (near-miss)', continueOnStep, ['the integration job must not set continue-on-error']],
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

  const liveCounts = liveSelfTest(failures);

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

    // `--live` with an empty gh configuration and no token in the
    // environment: it must stop at the authentication check.
    const env = { ...process.env, GH_CONFIG_DIR: dir };
    for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete env[name];
    const unauthenticated = spawnSync(process.execPath, [SELF, '--live'], { encoding: 'utf8', env });
    const unauthenticatedStderr = `check-ci-governance: ${GH_UNAUTHENTICATED}\n`;
    if (unauthenticated.status !== 1 || unauthenticated.stderr !== unauthenticatedStderr) {
      failures.push(
        `spawned --live without gh authentication exited ${unauthenticated.status} with ${JSON.stringify(unauthenticated.stderr)}, expected 1 with ${JSON.stringify(unauthenticatedStderr)}`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`check-ci-governance self-test failed: ${failure}`);
    process.exit(1);
  }
  console.log(
    `check-ci-governance self-test passed: ${rejections.length} bad workflows rejected with the expected message, ${acceptances.length} good workflows accepted, spawned gated copy exited non-zero; ` +
      `${liveCounts.rejected} bad rulesets rejected with the expected message, ${liveCounts.accepted} good ruleset sets accepted, one drifted repository named alone, the versioned file matches the spec, spawned --live without gh authentication exited 1`,
  );
}

// Run only when executed, not when apply-required-checks.mjs imports it.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(SELF)) {
  if (process.argv.includes('--self-test')) {
    selfTest();
  } else if (process.argv.includes('--live')) {
    live();
  } else {
    main();
  }
}
