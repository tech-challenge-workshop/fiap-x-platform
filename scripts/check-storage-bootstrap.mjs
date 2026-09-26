// Runs the real storage/bootstrap.sh against named scenarios and fails naming
// each scenario whose outcome is wrong.
//
// The bootstrap runs on every start and rewrites the bucket's whole lifecycle
// configuration, so a loosened refusal would delete a rule an operator added
// (V34). Its refusals and repairs are therefore proven here, on every gate run,
// against the stack's own storage: each scenario prepares a scratch bucket
// `fiapx-scenario-<name>` through the storage-init image (AD-014), runs the
// bootstrap on it with STORAGE_BUCKET overridden, reads the configuration back
// and deletes the bucket, before and after. The live `fiapx` bucket is never
// touched.
//
// BOOTSTRAP_UNDER_TEST mounts another copy of the bootstrap in place of
// storage/bootstrap.sh, so a literal negative can run on a scratch copy.
//
// `--self-test` needs no stack: it feeds every assertion and every scenario's
// expectation bad, near-miss and good observations, and spawns this script
// with a compose file that has no storage-init service, which must exit
// non-zero naming the scenario.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(SELF), '..');
const SCRATCH_PREFIX = 'fiapx-scenario-';

// The three rules the bootstrap owns, written here literally rather than read
// from the bootstrap: a changed rule in the bootstrap must fail, not move the
// expectation with it.
const OWNED_RULES = [
  { ID: 'expire-sources', Status: 'Enabled', Filter: { Prefix: 'sources/' }, Expiration: { Days: 7 } },
  { ID: 'expire-zips', Status: 'Enabled', Filter: { Prefix: 'zips/' }, Expiration: { Days: 7 } },
  { ID: 'abort-incomplete-uploads', Status: 'Enabled', Filter: { Prefix: '' }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } },
];
// S5's configuration, from before the abort rule existed.
const S5_RULES = OWNED_RULES.slice(0, 2);
const OPERATOR_RULE = { ID: 'operator-rule', Status: 'Enabled', Filter: { Prefix: 'reports/' }, Expiration: { Days: 30 } };
const ALREADY_CONFIGURED = [
  'retention on sources/ already configured',
  'retention on zips/ already configured',
  'abort of incomplete uploads already configured',
];

const bucketOf = (scenario) => `${SCRATCH_PREFIX}${scenario}`;

// The owned rules with one rule changed.
function withRule(id, change) {
  return OWNED_RULES.map((rule) => (rule.ID === id ? { ...rule, ...change } : rule));
}
const withAbort = (change) => withRule('abort-incomplete-uploads', change);

// Keys sorted at every level and rules sorted by ID, so two configurations
// compare equal exactly when they hold the same rules.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
function canonicalRules(rules) {
  return JSON.stringify(canonical([...rules].sort((a, b) => String(a.ID).localeCompare(String(b.ID)))));
}

function assertExit(expected, exit, stderr) {
  if (exit !== expected) {
    throw new Error(`bootstrap exited ${exit}, expected ${expected}${stderr ? `; stderr: ${stderr.trim()}` : ''}`);
  }
}

// `config` is the configuration as get-bucket-lifecycle-configuration prints
// it, or null when the bucket has none.
function assertOwnedRules(config) {
  const found = config === null ? 'no lifecycle configuration' : canonicalRules(JSON.parse(config).Rules ?? []);
  if (found !== canonicalRules(OWNED_RULES)) {
    throw new Error(`expected exactly the 3 owned lifecycle rules ${canonicalRules(OWNED_RULES)}, found ${found}`);
  }
}

// Byte for byte: a configuration rewritten with the same rules in another
// order or form is still a rewrite.
function assertUnchanged(before, after) {
  if (before !== after) {
    throw new Error(`lifecycle configuration changed: before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);
  }
}

// Each line must appear whole in stdout.
function assertLines(lines, stdout) {
  const printed = stdout.split('\n').map((line) => line.trim());
  const missing = lines.filter((line) => !printed.includes(line));
  if (missing.length > 0) {
    throw new Error(`bootstrap did not print ${missing.map((line) => JSON.stringify(line)).join(', ')}; stdout: ${stdout.trim()}`);
  }
}

// The refusal must carry this exact fragment, which names what was refused.
function assertStderr(fragment, stderr) {
  if (!stderr.includes(fragment)) {
    throw new Error(`bootstrap's stderr does not contain ${JSON.stringify(fragment)}; stderr: ${stderr.trim()}`);
  }
}

function assertNoScratchBuckets(buckets) {
  const left = buckets.filter((name) => name.startsWith(SCRATCH_PREFIX));
  if (left.length > 0) throw new Error(`scratch bucket(s) left behind: ${left.join(', ')}`);
}

// Pre-state steps, each given the scratch bucket and the IO.
const create = (bucket, io) => io.aws(['s3api', 'create-bucket', '--bucket', bucket]);
const lifecycle = (rules) => (bucket, io) =>
  io.aws(['s3api', 'put-bucket-lifecycle-configuration', '--bucket', bucket, '--lifecycle-configuration', JSON.stringify({ Rules: rules })]);
const openPolicy = (bucket, io) => io.aws(['s3api', 'put-bucket-policy', '--bucket', bucket, '--policy', JSON.stringify({
  Version: '2012-10-17',
  Statement: [{ Effect: 'Allow', Principal: '*', Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${bucket}/*`] }],
})]);
const bootstrapOnce = (bucket, io) => {
  const run = io.runBootstrap(bucket);
  if (run.status !== 0) throw new Error(`preparing with a first bootstrap failed: exit ${run.status}; stderr: ${run.stderr.trim()}`);
};

// Every scenario the gate runs, in order. `expect` is what the observation of
// the last bootstrap run must show.
export const SCENARIOS = [
  { name: 'fresh', prepare: [], expect: { exit: 0, rules: true } },
  { name: 'rerun', prepare: [bootstrapOnce], expect: { exit: 0, lines: ALREADY_CONFIGURED, unchanged: true, rules: true } },
  { name: 'upgrade', prepare: [create, lifecycle(S5_RULES)], expect: { exit: 0, rules: true } },
  {
    name: 'foreign',
    prepare: [create, lifecycle([...OWNED_RULES, OPERATOR_RULE])],
    expect: { exit: 1, stderr: () => '(IDs: operator-rule)', unchanged: true },
  },
  { name: 'abort-disabled', prepare: [create, lifecycle(withAbort({ Status: 'Disabled' }))], expect: { exit: 0, rules: true } },
  {
    name: 'abort-2-days',
    prepare: [create, lifecycle(withAbort({ AbortIncompleteMultipartUpload: { DaysAfterInitiation: 2 } }))],
    expect: { exit: 0, rules: true },
  },
  { name: 'abort-narrowed', prepare: [create, lifecycle(withAbort({ Filter: { Prefix: 'sources/' } }))], expect: { exit: 0, rules: true } },
  // An owned rule carrying a second action still deletes what it should not
  // (V36): the abort rule would also expire every object after 30 days.
  { name: 'abort-extra-expiration', prepare: [create, lifecycle(withAbort({ Expiration: { Days: 30 } }))], expect: { exit: 0, rules: true } },
  {
    name: 'expire-extra-abort',
    prepare: [create, lifecycle(withRule('expire-zips', { AbortIncompleteMultipartUpload: { DaysAfterInitiation: 3 } }))],
    expect: { exit: 0, rules: true },
  },
  { name: 'policy', prepare: [create, openPolicy], expect: { exit: 1, stderr: (bucket) => `bucket ${bucket} has a bucket policy` } },
];

// The scenarios --self-test requires, in order.
const REQUIRED_SCENARIOS = [
  'fresh', 'rerun', 'upgrade', 'foreign', 'abort-disabled', 'abort-2-days', 'abort-narrowed', 'abort-extra-expiration', 'expire-extra-abort', 'policy',
];

// Judges one scenario's observation against its expectation.
function checkScenario(scenario, observation) {
  const { expect } = scenario;
  assertExit(expect.exit, observation.exit, observation.stderr);
  if (expect.lines) assertLines(expect.lines, observation.stdout);
  if (expect.stderr) assertStderr(expect.stderr(bucketOf(scenario.name)), observation.stderr);
  if (expect.unchanged) assertUnchanged(observation.before, observation.after);
  if (expect.rules) assertOwnedRules(observation.after);
}

// Prepares the scratch bucket, runs the bootstrap once and observes it. The
// bucket is deleted first, so a run interrupted earlier leaves nothing in the
// way, and again afterwards, whatever happened in between.
function runScenario(scenario, io) {
  const bucket = bucketOf(scenario.name);
  io.removeBucket(bucket);
  let observation;
  let failure;
  try {
    for (const step of scenario.prepare) step(bucket, io);
    const before = io.readConfig(bucket);
    const run = io.runBootstrap(bucket);
    const after = io.readConfig(bucket);
    observation = { exit: run.status, stdout: run.stdout, stderr: run.stderr, before, after };
  } catch (err) {
    failure = err;
  }
  try {
    io.removeBucket(bucket);
  } catch (err) {
    throw failure ?? err;
  }
  if (failure) throw failure;
  return observation;
}

function compose(args) {
  const result = spawnSync('docker', ['compose', ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.error) throw new Error(`Could not run docker: ${result.error.message}`);
  return result;
}

function composeOk(args) {
  const result = compose(args);
  if (result.status !== 0) throw new Error(`docker compose ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

const RUN = ['run', '--rm', '--no-deps', '-T'];

const liveIo = {
  aws: (args) => composeOk([...RUN, '--entrypoint', 'aws', 'storage-init', ...args]),
  // head-bucket first: deleting a bucket that does not exist is an error.
  removeBucket: (bucket) => composeOk([...RUN, '--entrypoint', '/bin/bash', 'storage-init', '-c',
    `if aws s3api head-bucket --bucket '${bucket}' 2>/dev/null; then aws s3 rb 's3://${bucket}' --force >/dev/null; fi`]),
  // null when the bucket has no configuration, or does not exist yet.
  readConfig: (bucket) => {
    const result = compose([...RUN, '--entrypoint', 'aws', 'storage-init',
      's3api', 'get-bucket-lifecycle-configuration', '--bucket', bucket, '--output', 'json']);
    if (result.status === 0) return result.stdout;
    if (/NoSuchLifecycleConfiguration|NoSuchBucket/.test(result.stderr)) return null;
    throw new Error(`could not read the lifecycle configuration of ${bucket}: ${result.stderr.trim()}`);
  },
  runBootstrap: (bucket) => {
    const override = process.env.BOOTSTRAP_UNDER_TEST;
    const mount = override ? ['-v', `${resolve(override)}:/bootstrap.sh:ro`] : [];
    return compose([...RUN, '-e', `STORAGE_BUCKET=${bucket}`, ...mount, 'storage-init']);
  },
  listBuckets: () => {
    const out = composeOk([...RUN, '--entrypoint', 'aws', 'storage-init', 's3api', 'list-buckets', '--query', 'Buckets[].Name', '--output', 'text']).trim();
    return out === 'None' || out === '' ? [] : out.split(/\s+/);
  },
};

function main({ io = liveIo, log = console.log } = {}) {
  if (process.env.BOOTSTRAP_UNDER_TEST) log(`bootstrap under test: ${resolve(process.env.BOOTSTRAP_UNDER_TEST)}`);
  const failures = [];
  for (const scenario of SCENARIOS) {
    try {
      checkScenario(scenario, runScenario(scenario, io));
      log(`scenario ${scenario.name} passed`);
    } catch (err) {
      failures.push(`scenario ${scenario.name} failed: ${err.message}`);
    }
  }
  try {
    assertNoScratchBuckets(io.listBuckets());
  } catch (err) {
    failures.push(err.message);
  }
  if (failures.length > 0) {
    for (const failure of failures) console.error(`check-storage-bootstrap: ${failure}`);
    process.exitCode = 1;
    return;
  }
  log(`${SCENARIOS.length} bootstrap scenarios passed; no ${SCRATCH_PREFIX}* bucket left`);
}

function selfTest() {
  const pretty = (rules) => JSON.stringify({ Rules: rules }, null, 4);
  const owned = pretty(OWNED_RULES);
  // The same rules in another rule order and key order, as a server may return them.
  const ownedAsServed = pretty([...OWNED_RULES].reverse().map((rule) => Object.fromEntries(Object.entries(rule).reverse())));
  const ownedCanonical = canonicalRules(OWNED_RULES);
  const already = `bucket b exists\nbucket b is private\n${ALREADY_CONFIGURED.join('\n')}\nbucket b expires sources/ and zips/ after 7 days and aborts incomplete uploads after 1 day\n`;
  const rewrote = 'bucket b exists\nbucket b is private\nretention on sources/ and zips/ and abort of incomplete uploads configured\n';
  const foreignRefusal = 'bucket fiapx-scenario-foreign has 1 lifecycle rule(s) this bootstrap does not own (IDs: operator-rule); refusing to overwrite them\n';
  const withOperator = pretty([...OWNED_RULES, OPERATOR_RULE]);
  const policyRefusal = 'bucket fiapx-scenario-policy has a bucket policy, which may allow anonymous access: {...}\n';
  const scenario = (name) => SCENARIOS.find((candidate) => candidate.name === name);
  const check = (name, observation) => () => {
    const found = scenario(name);
    if (!found) throw new Error(`scenario "${name}" is missing from SCENARIOS`);
    checkScenario(found, observation);
  };
  const good = {
    fresh: { exit: 0, stdout: '', stderr: '', before: null, after: ownedAsServed },
    rerun: { exit: 0, stdout: already, stderr: '', before: owned, after: owned },
    upgrade: { exit: 0, stdout: rewrote, stderr: '', before: pretty(S5_RULES), after: owned },
    foreign: { exit: 1, stdout: '', stderr: foreignRefusal, before: withOperator, after: withOperator },
    'abort-disabled': { exit: 0, stdout: rewrote, stderr: '', before: pretty(withAbort({ Status: 'Disabled' })), after: owned },
    'abort-2-days': { exit: 0, stdout: rewrote, stderr: '', before: null, after: owned },
    'abort-narrowed': { exit: 0, stdout: rewrote, stderr: '', before: null, after: owned },
    'abort-extra-expiration': { exit: 0, stdout: rewrote, stderr: '', before: null, after: owned },
    'expire-extra-abort': { exit: 0, stdout: rewrote, stderr: '', before: null, after: owned },
    policy: { exit: 1, stdout: '', stderr: policyRefusal, before: null, after: null },
  };
  const bad = (name, change) => check(name, { ...good[name], ...change });
  const found = (rules) => `expected exactly the 3 owned lifecycle rules ${ownedCanonical}, found ${canonicalRules(rules)}`;
  const twoDays = withAbort({ AbortIncompleteMultipartUpload: { DaysAfterInitiation: 2 } });
  const disabled = withAbort({ Status: 'Disabled' });
  const narrowed = withAbort({ Filter: { Prefix: 'sources/' } });
  const extraExpiration = withAbort({ Expiration: { Days: 30 } });
  const extraAbort = withRule('expire-zips', { AbortIncompleteMultipartUpload: { DaysAfterInitiation: 3 } });
  const allLines = ALREADY_CONFIGURED.map((line) => JSON.stringify(line)).join(', ');

  const rejections = [
    // assertOwnedRules: bad, near-miss, and the other shapes a repair can leave.
    ['no configuration', () => assertOwnedRules(null),
      `expected exactly the 3 owned lifecycle rules ${ownedCanonical}, found no lifecycle configuration`],
    ['two rules', () => assertOwnedRules(pretty(S5_RULES)), found(S5_RULES)],
    ['a fourth rule', () => assertOwnedRules(withOperator), found([...OWNED_RULES, OPERATOR_RULE])],
    ['abort after 2 days (near-miss)', () => assertOwnedRules(pretty(twoDays)), found(twoDays)],
    ['abort rule disabled', () => assertOwnedRules(pretty(disabled)), found(disabled)],
    ['abort rule narrowed', () => assertOwnedRules(pretty(narrowed)), found(narrowed)],
    ['abort rule with an extra Expiration (near-miss: every owned field is right)', () => assertOwnedRules(pretty(extraExpiration)), found(extraExpiration)],
    ['expire rule with an extra abort action', () => assertOwnedRules(pretty(extraAbort)), found(extraAbort)],
    // assertUnchanged: bad, and a near-miss that differs by one space.
    ['configuration rewritten', () => assertUnchanged(withOperator, owned),
      `lifecycle configuration changed: before ${JSON.stringify(withOperator)}, after ${JSON.stringify(owned)}`],
    ['configuration differing by one space (near-miss)', () => assertUnchanged(owned, `${owned} `),
      `lifecycle configuration changed: before ${JSON.stringify(owned)}, after ${JSON.stringify(`${owned} `)}`],
    // assertExit
    ['exit 0 where a refusal is due', () => assertExit(1, 0, ''), 'bootstrap exited 0, expected 1'],
    ['exit 1 where a repair is due', () => assertExit(0, 1, 'boom\n'), 'bootstrap exited 1, expected 0; stderr: boom'],
    ['exit 2 where a refusal is due (near-miss)', () => assertExit(1, 2, ''), 'bootstrap exited 2, expected 1'],
    // assertLines
    ['the rewrite line instead of the three', () => assertLines(ALREADY_CONFIGURED, rewrote),
      `bootstrap did not print ${allLines}; stdout: ${rewrote.trim()}`],
    ['two of the three lines (near-miss)', () => assertLines(ALREADY_CONFIGURED, `${ALREADY_CONFIGURED[0]}\n${ALREADY_CONFIGURED[1]}\n`),
      `bootstrap did not print ${JSON.stringify(ALREADY_CONFIGURED[2])}; stdout: ${ALREADY_CONFIGURED[0]}\n${ALREADY_CONFIGURED[1]}`],
    // assertStderr
    ['another refusal naming the bucket', () => assertStderr('bucket fiapx-scenario-policy has a bucket policy', 'could not read the policy of bucket fiapx-scenario-policy: AccessDenied\n'),
      'bootstrap\'s stderr does not contain "bucket fiapx-scenario-policy has a bucket policy"; stderr: could not read the policy of bucket fiapx-scenario-policy: AccessDenied'],
    ['a foreign rule whose ID extends the expected one (near-miss)', () => assertStderr('(IDs: operator-rule)', foreignRefusal.replace('operator-rule', 'operator-rule-2')),
      `bootstrap's stderr does not contain "(IDs: operator-rule)"; stderr: ${foreignRefusal.replace('operator-rule', 'operator-rule-2').trim()}`],
    // assertNoScratchBuckets
    ['a scratch bucket left', () => assertNoScratchBuckets(['fiapx', 'fiapx-scenario-foreign']), 'scratch bucket(s) left behind: fiapx-scenario-foreign'],
    // Each scenario's own expectation, given one bad observation.
    ['scenario fresh with two rules', bad('fresh', { after: pretty(S5_RULES) }), found(S5_RULES)],
    ['scenario fresh failing', bad('fresh', { exit: 1, stderr: 'boom\n', after: null }), 'bootstrap exited 1, expected 0; stderr: boom'],
    ['scenario rerun rewriting the configuration', bad('rerun', { stdout: rewrote }),
      `bootstrap did not print ${allLines}; stdout: ${rewrote.trim()}`],
    ['scenario rerun changing the bytes', bad('rerun', { after: ownedAsServed }),
      `lifecycle configuration changed: before ${JSON.stringify(owned)}, after ${JSON.stringify(ownedAsServed)}`],
    ['scenario upgrade left at two rules', bad('upgrade', { after: pretty(S5_RULES) }), found(S5_RULES)],
    ['scenario foreign overwriting the rule', bad('foreign', { exit: 0, stderr: '', after: owned }), 'bootstrap exited 0, expected 1'],
    ['scenario foreign deleting the rule and then failing', bad('foreign', { after: owned }),
      `lifecycle configuration changed: before ${JSON.stringify(withOperator)}, after ${JSON.stringify(owned)}`],
    ['scenario foreign failing for another reason', bad('foreign', { stderr: 'could not read the lifecycle configuration of bucket fiapx-scenario-foreign: timeout\n' }),
      'bootstrap\'s stderr does not contain "(IDs: operator-rule)"; stderr: could not read the lifecycle configuration of bucket fiapx-scenario-foreign: timeout'],
    ['scenario abort-disabled left disabled', bad('abort-disabled', { after: pretty(disabled) }), found(disabled)],
    ['scenario abort-2-days left at 2 days', bad('abort-2-days', { after: pretty(twoDays) }), found(twoDays)],
    ['scenario abort-narrowed left narrowed', bad('abort-narrowed', { after: pretty(narrowed) }), found(narrowed)],
    ['scenario abort-extra-expiration keeping the Expiration', bad('abort-extra-expiration', { after: pretty(extraExpiration) }), found(extraExpiration)],
    ['scenario expire-extra-abort keeping the abort action', bad('expire-extra-abort', { after: pretty(extraAbort) }), found(extraAbort)],
    ['scenario policy accepted', bad('policy', { exit: 0, stderr: '' }), 'bootstrap exited 0, expected 1'],
    ['scenario policy refused for another bucket (near-miss)', bad('policy', { stderr: policyRefusal.replace('fiapx-scenario-policy', 'fiapx-scenario-policy-2') }),
      `bootstrap's stderr does not contain "bucket fiapx-scenario-policy has a bucket policy"; stderr: ${policyRefusal.replace('fiapx-scenario-policy', 'fiapx-scenario-policy-2').trim()}`],
  ];

  const acceptances = [
    ['the owned rules in another order', () => assertOwnedRules(ownedAsServed)],
    ['the same bytes', () => assertUnchanged(owned, `${owned}`)],
    ['no configuration before and after', () => assertUnchanged(null, null)],
    ['the expected exit', () => assertExit(1, 1, '')],
    ['the three lines among others', () => assertLines(ALREADY_CONFIGURED, already)],
    ['the refusal naming the bucket', () => assertStderr('bucket fiapx-scenario-policy has a bucket policy', policyRefusal)],
    ['only the live bucket', () => assertNoScratchBuckets(['fiapx'])],
    ...REQUIRED_SCENARIOS.map((name) => [`scenario ${name} given a good observation`, check(name, good[name])]),
  ];

  // runScenario deletes the bucket before and after, and still after a failure.
  const recording = (failOn) => {
    const calls = [];
    const io = {
      aws: (args) => { calls.push(args[1]); },
      removeBucket: (bucket) => { calls.push(`remove ${bucket}`); },
      readConfig: () => { calls.push('read'); return null; },
      runBootstrap: () => {
        calls.push('bootstrap');
        if (failOn === 'bootstrap') throw new Error('Could not run docker: spawn docker ENOENT');
        return { status: 0, stdout: '', stderr: '' };
      },
    };
    return { calls, io };
  };
  const cleanupCases = [
    ['scenario upgrade removes its bucket before and after', () => {
      const { calls, io } = recording();
      runScenario(scenario('upgrade'), io);
      return calls;
    }, ['remove fiapx-scenario-upgrade', 'create-bucket', 'put-bucket-lifecycle-configuration', 'read', 'bootstrap', 'read', 'remove fiapx-scenario-upgrade']],
    ['scenario fresh removes its bucket after a failed run', () => {
      const { calls, io } = recording('bootstrap');
      try {
        runScenario(scenario('fresh'), io);
      } catch (err) {
        calls.push(err.message);
      }
      return calls;
    }, ['remove fiapx-scenario-fresh', 'read', 'bootstrap', 'remove fiapx-scenario-fresh', 'Could not run docker: spawn docker ENOENT']],
  ];

  const failures = [];
  const names = SCENARIOS.map((candidate) => candidate.name);
  if (JSON.stringify(names) !== JSON.stringify(REQUIRED_SCENARIOS)) {
    failures.push(`SCENARIOS is ${JSON.stringify(names)}, expected ${JSON.stringify(REQUIRED_SCENARIOS)}`);
  }
  for (const [name, run, expected] of rejections) {
    try {
      run();
      failures.push(`${name}: accepted, expected rejection with ${JSON.stringify(expected)}`);
    } catch (err) {
      if (err.message !== expected) failures.push(`${name}: rejected with ${JSON.stringify(err.message)}, expected ${JSON.stringify(expected)}`);
    }
  }
  for (const [name, run] of acceptances) {
    try {
      run();
    } catch (err) {
      failures.push(`${name}: rejected a good input with ${JSON.stringify(err.message)}`);
    }
  }
  for (const [name, run, expected] of cleanupCases) {
    const calls = run();
    if (JSON.stringify(calls) !== JSON.stringify(expected)) failures.push(`${name}: calls were ${JSON.stringify(calls)}, expected ${JSON.stringify(expected)}`);
  }

  // The script itself, as the gate runs it, against a project with no
  // storage-init service: it must exit non-zero naming the first scenario.
  const dir = mkdtempSync(join(tmpdir(), 'fiapx-bootstrap-self-test-'));
  try {
    writeFileSync(join(dir, 'compose.yaml'), 'services:\n  placeholder:\n    image: busybox\n');
    const spawned = spawnSync(process.execPath, [SELF], { encoding: 'utf8', env: { ...process.env, COMPOSE_FILE: join(dir, 'compose.yaml') } });
    const expected = 'check-storage-bootstrap: scenario fresh failed: ';
    if (spawned.status === 0) failures.push('spawned run against a project without storage-init exited 0, expected non-zero');
    if (!spawned.stderr.split('\n').some((line) => line.startsWith(expected))) {
      failures.push(`spawned run's stderr has no line starting ${JSON.stringify(expected)}; stderr: ${JSON.stringify(spawned.stderr)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`check-storage-bootstrap self-test failed: ${failure}`);
    process.exit(1);
  }
  console.log(
    `check-storage-bootstrap self-test passed: ${REQUIRED_SCENARIOS.length} required scenarios present, ${rejections.length} bad inputs rejected with the expected message, `
      + `${acceptances.length} good inputs accepted, ${cleanupCases.length} cleanup orders held, spawned failure exited non-zero`,
  );
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  main();
}
