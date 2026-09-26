// Makes each repository's `protect main` ruleset require exactly the checks in
// ci/required-checks.json (CIG-04), each pinned to the app that posts it
// (`integration_id`, GRD-03). Checks are printed as `context@integration_id`,
// and `context@-` for one pinned to no app.

//
//   --dry-run   reads each ruleset through `gh api` and prints the checks it
//               would add and remove; changes nothing.
//   --apply     also PUTs each ruleset that differs back, with only the
//               `required_status_checks` list replaced: every other rule,
//               `strict_required_status_checks_policy` and the target are
//               sent back as read. Unchanged rulesets are not written. On a
//               failed PUT it stops and names the repository; the ones before
//               it keep their new list, and a re-run is safe.
//
// Applying is an externally visible change: run --dry-run first, and --apply
// only with an explicit go-ahead. Then run check-ci-governance.mjs --live.
//
// `--self-test` needs nothing external: it feeds the transformation an
// injected ruleset and requires every other rule to come out byte-identical
// and the checks list to be replaced exactly, runs both modes against injected
// GitHub calls, and spawns the script without a mode and without gh
// authentication, which must exit 1.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIONS_APP_ID, RULESET_NAME, checkLabel, fetchProtectMain, gh, ghAuthenticated, readRequiredChecks } from './check-ci-governance.mjs';

const SELF = fileURLToPath(import.meta.url);
const USAGE = 'usage: node scripts/apply-required-checks.mjs --dry-run | --apply';
const GH_UNAUTHENTICATED = 'gh is not authenticated; apply-required-checks reads the rulesets';

function fail(message) {
  console.error(`apply-required-checks: ${message}`);
  process.exit(1);
}

// The fields a ruleset PUT takes; the rest of a GET (id, source, links,
// timestamps) is read-only.
const WRITABLE = ['name', 'target', 'enforcement', 'bypass_actors', 'conditions', 'rules'];
const RULE = 'required_status_checks';
const list = (items) => `[${items.join(', ')}]`;

// The PUT body for `ruleset` requiring exactly `checks`, each a { context,
// integration_id } pair: every field and rule as read, except the
// required_status_checks list, which is replaced, never merged. `ruleset` is
// not changed.
export function withRequiredChecks(ruleset, checks) {
  if (!ruleset.rules.some((rule) => rule.type === RULE)) {
    throw new Error(`ruleset "${ruleset.name}" (${ruleset.id}) has no ${RULE} rule to replace`);
  }
  const body = {};
  for (const field of WRITABLE) body[field] = structuredClone(ruleset[field]);
  body.rules = body.rules.map((rule) =>
    rule.type === RULE
      ? {
        ...rule,
        parameters: {
          ...rule.parameters,
          required_status_checks: checks.map(({ context, integration_id }) => ({ context, integration_id })),
        },
      }
      : rule,
  );
  return body;
}

const liveChecks = (ruleset) =>
  (ruleset.rules.find((rule) => rule.type === RULE)?.parameters?.required_status_checks ?? []).map(checkLabel);

// The checks to add and to remove so that `ruleset` requires `checks`, as
// `context@integration_id` labels: a context pinned to no app, or to another
// app, is removed and the pinned one added.
export function checkChanges(ruleset, checks) {
  const live = liveChecks(ruleset);
  const wanted = checks.map(checkLabel);
  return {
    add: wanted.filter((check) => !live.includes(check)),
    remove: [...new Set(live)].filter((check) => !wanted.includes(check)),
  };
}

// Runs a mode over every repository in `checks`. `fetch(repo)` returns the
// rulesets named protect main; `put(repo, id, body)` writes one. Returns the
// output lines and, on the first failure, an error naming the repository.
export function run(mode, checks, { fetch, put }) {
  const lines = [];
  for (const [repo, wanted] of Object.entries(checks)) {
    let ruleset;
    try {
      const named = fetch(repo);
      if (named.length !== 1) {
        return { lines, error: `${repo}: expected exactly one ruleset named "${RULESET_NAME}", found ${named.length}` };
      }
      [ruleset] = named;
    } catch (error) {
      return { lines, error: `${repo}: ${error.message}` };
    }
    const prefix = `${repo}: ruleset "${RULESET_NAME}" (${ruleset.id})`;
    const labels = wanted.map(checkLabel);
    const { add, remove } = checkChanges(ruleset, wanted);
    if (add.length === 0 && remove.length === 0) {
      lines.push(`${prefix} already requires exactly ${list(labels)}`);
      continue;
    }
    if (mode === '--dry-run') {
      lines.push(`${prefix} would add ${list(add)}, remove ${list(remove)}; it would then require ${list(labels)}`);
      continue;
    }
    try {
      put(repo, ruleset.id, withRequiredChecks(ruleset, wanted));
    } catch (error) {
      return { lines, error: `${repo}: the PUT of ruleset ${ruleset.id} failed: ${error.message}` };
    }
    lines.push(`${prefix} updated: added ${list(add)}, removed ${list(remove)}; it now requires ${list(labels)}`);

  }
  lines.push(mode === '--dry-run' ? 'dry run: nothing was changed' : 'applied: now run node scripts/check-ci-governance.mjs --live');
  return { lines, error: undefined };
}

function selfTest() {
  const failures = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const expect = (name, actual, expected) => {
    if (!same(actual, expected)) failures.push(`${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  };

  // A required check from `context@integration_id`, or `context` alone for
  // one pinned to no app, as the live rulesets hold them today.
  const checkOf = (label) => {
    const [context, id] = label.split('@');
    return id === undefined ? { context } : { context, integration_id: Number(id) };
  };
  // The versioned shape.
  const pinned = (...contexts) => contexts.map((context) => ({ context, integration_id: ACTIONS_APP_ID }));
  const QI = pinned('quality', 'image');
  // A ruleset as `gh api repos/<repo>/rulesets/<id>` returns it.
  const read = (labels, strict = false) => ({
    id: 23709809,
    name: 'protect main',
    target: 'branch',
    source_type: 'Repository',
    source: 'tech-challenge-workshop/processing-worker',
    enforcement: 'active',
    conditions: { ref_name: { exclude: [], include: ['~DEFAULT_BRANCH'] } },
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      { type: 'required_linear_history' },
      {
        type: 'pull_request',
        parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: false,
          required_reviewers: [],
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: false,
          allowed_merge_methods: ['merge', 'squash', 'rebase'],
        },
      },
      {
        type: 'required_status_checks',
        parameters: {
          strict_required_status_checks_policy: strict,
          do_not_enforce_on_create: false,
          required_status_checks: labels.map(checkOf),
        },
      },
    ],
    node_id: 'RRS_x',
    created_at: '2026-09-19T18:05:34.514-03:00',
    updated_at: '2026-09-20T18:26:08.632-03:00',
    bypass_actors: [],
    current_user_can_bypass: 'never',
    _links: { self: { href: 'https://api.github.com/repos/x/rulesets/23709809' } },
  });

  // The transformation.
  const input = read(['quality']);
  const before = JSON.stringify(input);
  let body;
  try {
    body = withRequiredChecks(input, QI);
  } catch (error) {
    body = { error: error.message };
  }
  expect('the PUT body carries only the writable fields', Object.keys(body ?? {}), ['name', 'target', 'enforcement', 'bypass_actors', 'conditions', 'rules']);
  for (const field of ['name', 'target', 'enforcement', 'bypass_actors', 'conditions']) {
    expect(`${field} is sent back as read`, JSON.stringify(body?.[field]), JSON.stringify(input[field]));
  }
  expect('the rules keep their types and order', (body?.rules ?? []).map((rule) => rule.type), input.rules.map((rule) => rule.type));
  input.rules.forEach((rule, index) => {
    if (rule.type === 'required_status_checks') return;
    expect(`the ${rule.type} rule is byte-identical`, JSON.stringify(body?.rules?.[index]), JSON.stringify(rule));
  });
  expect('the required_status_checks rule has the versioned list and keeps its other parameters', body?.rules?.[4], {
    type: 'required_status_checks',
    parameters: {
      strict_required_status_checks_policy: false,
      do_not_enforce_on_create: false,
      required_status_checks: [{ context: 'quality', integration_id: 15368 }, { context: 'image', integration_id: 15368 }],
    },
  });
  // M17: a live list with a stale extra check comes out exactly as the
  // versioned list, not with the extra kept (a list that shrinks).
  for (const live of [['quality', 'lint'], ['quality@15368', 'lint@15368']]) {
    let shrunk;
    try {
      shrunk = withRequiredChecks(read(live), QI);
    } catch (error) {
      shrunk = { error: error.message };
    }
    expect(`a live list ${JSON.stringify(live)} is replaced by exactly the versioned list`,
      shrunk?.rules?.[4]?.parameters?.required_status_checks, [{ context: 'quality', integration_id: 15368 }, { context: 'image', integration_id: 15368 }]);
  }
  expect('the ruleset read is not mutated', JSON.stringify(input), before);
  let strictBody;
  try {
    strictBody = withRequiredChecks(read(['quality'], true), QI);
  } catch (error) {
    strictBody = { error: error.message };
  }
  expect('a strict policy is kept (near-miss)', strictBody?.rules?.[4]?.parameters?.strict_required_status_checks_policy, true);
  const noRule = read(['quality']);
  noRule.rules = noRule.rules.filter((rule) => rule.type !== 'required_status_checks');
  let noRuleError;
  try {
    withRequiredChecks(noRule, QI);
  } catch (error) {
    noRuleError = error.message;
  }
  expect('a ruleset without the rule is refused', noRuleError, 'ruleset "protect main" (23709809) has no required_status_checks rule to replace');

  expect('the changes add the missing check', checkChanges(read(['quality@15368']), QI), { add: ['image@15368'], remove: [] });
  expect('the changes remove an extra check', checkChanges(read(['quality@15368', 'lint@15368']), QI), { add: ['image@15368'], remove: ['lint@15368'] });
  expect('the changes pin each unpinned context, as the rulesets are today', checkChanges(read(['quality', 'image']), QI),
    { add: ['quality@15368', 'image@15368'], remove: ['quality@-', 'image@-'] });
  expect('the changes re-pin a context posted by another app (near-miss)', checkChanges(read(['quality@15368', 'image@1']), QI),
    { add: ['image@15368'], remove: ['image@1'] });
  expect('no change when the set already matches', checkChanges(read(['image@15368', 'quality@15368']), QI), { add: [], remove: [] });

  // Both modes, against injected GitHub calls.
  const W = 'o/worker';
  const P = 'o/platform';
  const checks = { [W]: QI, [P]: pinned('topology') };
  const fetched = { [W]: [read(['quality'])], [P]: [{ ...read(['topology@15368']), id: 7 }] };
  const puts = [];
  const deps = (failOn) => ({
    fetch: (repo) => fetched[repo],
    put: (repo, id, putBody) => {
      if (repo === failOn) throw new Error('HTTP 422');
      puts.push([repo, id, putBody]);
    },
  });
  const dry = run('--dry-run', checks, deps());
  expect('--dry-run writes nothing', puts, []);
  expect('--dry-run output', dry, {
    lines: [
      `${W}: ruleset "protect main" (23709809) would add [quality@15368, image@15368], remove [quality@-]; it would then require [quality@15368, image@15368]`,
      `${P}: ruleset "protect main" (7) already requires exactly [topology@15368]`,
      'dry run: nothing was changed',
    ],
    error: undefined,
  });
  const applied = run('--apply', checks, deps());
  expect('--apply writes only the ruleset that differs, with the transformed body', puts, [
    [W, 23709809, withRequiredChecks(read(['quality']), QI)],
  ]);
  expect('--apply output', applied, {
    lines: [
      `${W}: ruleset "protect main" (23709809) updated: added [quality@15368, image@15368], removed [quality@-]; it now requires [quality@15368, image@15368]`,
      `${P}: ruleset "protect main" (7) already requires exactly [topology@15368]`,
      'applied: now run node scripts/check-ci-governance.mjs --live',
    ],
    error: undefined,
  });
  puts.length = 0;
  const failed = run('--apply', { [P]: pinned('topology', 'docs-links'), [W]: QI }, deps(W));
  expect('a failed PUT stops and names the repository; the earlier one kept its update', [puts.map(([repo]) => repo), failed], [
    [P],
    {
      lines: [`${P}: ruleset "protect main" (7) updated: added [docs-links@15368], removed []; it now requires [topology@15368, docs-links@15368]`],
      error: `${W}: the PUT of ruleset 23709809 failed: HTTP 422`,
    },
  ]);
  // Applying twice changes nothing the second time.
  const rewritten = withRequiredChecks(read(['quality']), QI);
  const again = run('--apply', { [W]: QI }, { fetch: () => [{ ...read([]), rules: rewritten.rules }], put: () => { throw new Error('wrote on a second run'); } });
  expect('a second apply changes nothing', again, {
    lines: [`${W}: ruleset "protect main" (23709809) already requires exactly [quality@15368, image@15368]`, 'applied: now run node scripts/check-ci-governance.mjs --live'],
    error: undefined,
  });
  const twoNamed = run('--dry-run', { [W]: pinned('quality') }, { fetch: () => [read(['quality']), read(['quality'])], put: () => {} });

  expect('two rulesets named protect main are refused', twoNamed.error, `${W}: expected exactly one ruleset named "protect main", found 2`);

  // Spawned: no mode, and --dry-run without gh authentication.
  const dir = mkdtempSync(join(tmpdir(), 'apply-required-checks-'));
  try {
    const env = { ...process.env, GH_CONFIG_DIR: dir };
    for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete env[name];
    const spawn = (args) => spawnSync(process.execPath, [SELF, ...args], { encoding: 'utf8', env });
    for (const [args, message] of [[[], USAGE], [['--dry-run', '--apply'], USAGE], [['--dry-run'], GH_UNAUTHENTICATED]]) {
      const result = spawn(args);
      expect(`spawned with ${JSON.stringify(args)}`, [result.status, result.stderr], [1, `apply-required-checks: ${message}\n`]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`apply-required-checks self-test failed: ${failure}`);
    process.exit(1);
  }
  console.log(
    'apply-required-checks self-test passed: every other rule byte-identical, the checks list replaced exactly, a strict policy kept, a ruleset without the rule refused, ' +
      'a live list with a stale extra check replaced by exactly the versioned pairs (2 cases), 5 change sets computed, --dry-run wrote nothing, --apply wrote only the differing ruleset, a failed PUT stopped naming the repository, a second apply changed nothing, a duplicate ruleset refused, ' +
      '3 spawned runs without a mode or authentication exited 1',
  );
}

function main(mode) {
  if (!ghAuthenticated()) fail(GH_UNAUTHENTICATED);
  let checks;
  try {
    checks = readRequiredChecks();
  } catch (error) {
    fail(error.message);
  }
  const put = (repo, id, body) => gh(['api', '--method', 'PUT', `repos/${repo}/rulesets/${id}`, '--input', '-'], JSON.stringify(body));
  const result = run(mode, checks, { fetch: fetchProtectMain, put });
  for (const line of result.lines) console.log(line);
  if (result.error) fail(result.error);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(SELF)) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    selfTest();
  } else {
    const modes = args.filter((arg) => arg === '--dry-run' || arg === '--apply');
    if (modes.length !== 1 || args.length !== 1) fail(USAGE);
    main(modes[0]);
  }
}
