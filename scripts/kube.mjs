// The only way the platform's scripts reach a Kubernetes cluster (K8S-04).
//
// This machine's current kube context can be a real cluster from another
// project, so no script may run a bare `kubectl`: every call goes through
// `kubectl()` below, which always prepends `--context kind-fiapx` and refuses
// any argument that could point the call somewhere else (`--context`,
// `--kubeconfig`, `--cluster`, `--server`/`-s`, `--user`) or read or change
// the kubeconfig (`config` is refused as a subcommand). The subcommand must
// be the first argument, so that refusal cannot be dodged by a leading flag.
// Arguments after a `--` belong to the command run inside a container
// (`exec … -- psql …`) and are not checked.
//
// `scripts/check-kubernetes.mjs` fails when any other script spawns kubectl
// directly. The binary names stay private to this file: no export is a bare
// `kubectl` or `kind` another script could spawn (the self-test checks every
// export), and the scan also refuses the identifiers KUBECTL, KUBECTL_BIN,
// KIND and KIND_BIN outside this file. Other scripts print commands through
// kubectlHint(), which always names the cluster's kubeconfig and context.
//
// The cluster lives in its own kubeconfig, KUBECONFIG_PATH
// (~/.kube/kind-fiapx.config), never in ~/.kube/config: `kind create
// cluster` sets `current-context` in the file it writes and has no flag to
// stop it, so writing the default file would switch the machine's current
// context away from the cluster it points at today. `kind()` below passes
// `--kubeconfig KUBECONFIG_PATH` to every create and delete, and `kubectl()`
// runs with KUBECONFIG set to that file alone, so the other contexts are not
// even loaded.
// SPEC_DEVIATION: design.md runs `kind create cluster` against the default
// kubeconfig. Reason: kind v0.33 always sets current-context in the file it
// writes (pkg/cluster/internal/kubeconfig/internal/kubeconfig/merge.go),
// which K8S-04 forbids.
//
// `--self-test` spawns nothing: it drives `kubectl()` with an injected
// spawner and requires the exact argument list, and requires each refused
// argument to throw its message without spawning.
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// This module's own exports, which the self-test inspects.
import * as self from './kube.mjs';

export const KIND_CLUSTER = 'fiapx';
export const KUBE_CONTEXT = `kind-${KIND_CLUSTER}`;
export const NAMESPACE = 'fiapx';
// The binaries' names. Not exported: a script holding one could spawn it
// against the machine's current context (K8S-04).
const KUBECTL = 'kubectl';
const KIND = 'kind';
export const KUBECONFIG_PATH = join(homedir(), '.kube', `${KUBE_CONTEXT}.config`);
// The message when the kube client is not installed.
export const KUBECTL_NOT_FOUND = `${KUBECTL} not found on PATH (install ${KUBECTL} v1.36 or later)`;
// The topology job's render step in .github/workflows/ci.yml, which
// check-ci-governance compares, never runs. `kubectl kustomize` renders the
// manifests locally and reads no cluster.
export const KUSTOMIZE_RENDER_STEP = `${KUBECTL} kustomize --load-restrictor LoadRestrictionsNone k8s > rendered-k8s.yaml`;

// Flags that would send the call to another cluster or credential set.
const REDIRECTING_FLAGS = ['--context', '--kubeconfig', '--cluster', '--server', '-s', '--user'];

// The full argument list for one kubectl call; throws on anything that could
// make it act outside kind-fiapx.
export function kubectlArgs(args) {
  if (!Array.isArray(args) || args.length === 0 || args.some((arg) => typeof arg !== 'string')) {
    throw new Error('kubectl: arguments must be a non-empty array of strings');
  }
  const separator = args.indexOf('--');
  const own = separator === -1 ? args : args.slice(0, separator);
  if (own[0].startsWith('-')) {
    throw new Error(`kubectl: the subcommand must be the first argument, got "${own[0]}"`);
  }
  if (own[0] === 'config') {
    const words = own.slice(0, 2).join(' ');
    throw new Error(`kubectl: "${words}" is refused; scripts never read or change the kubeconfig`);
  }
  for (const arg of own) {
    const flag = REDIRECTING_FLAGS.find((f) => arg === f || arg.startsWith(`${f}=`));
    if (flag) throw new Error(`kubectl: ${flag} is refused; every call is pinned to --context ${KUBE_CONTEXT}`);
  }
  return ['--context', KUBE_CONTEXT, ...args];
}

// Runs `kubectl --context kind-fiapx <args>` with KUBECONFIG set to
// KUBECONFIG_PATH alone and returns spawnSync's result. `opts` go to the
// spawner (input, env, maxBuffer, ...); utf8 by default; an `env` given is
// kept except for KUBECONFIG.
export function kubectl(args, opts = {}, spawner = spawnSync) {
  const env = { ...(opts.env ?? process.env), KUBECONFIG: KUBECONFIG_PATH };
  return spawner(KUBECTL, kubectlArgs(args), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts, env });
}

// A kubectl command line for a person to run, for hints and messages:
// `KUBECONFIG=<KUBECONFIG_PATH> kubectl --context kind-fiapx -n fiapx <rest>`.
// It names the cluster's own kubeconfig and context, so it reaches kind-fiapx
// or nothing. `rest` may not name another context, kubeconfig, cluster,
// server or user.
export function kubectlHint(rest) {
  if (typeof rest !== 'string' || rest.trim() === '') throw new Error('kubectlHint: the command must be a non-empty string');
  const flag = REDIRECTING_FLAGS.find((f) => rest.split(/\s+/).some((arg) => arg === f || arg.startsWith(`${f}=`)));
  if (flag) throw new Error(`kubectlHint: ${flag} is refused; every command is pinned to --context ${KUBE_CONTEXT}`);
  return `KUBECONFIG=${KUBECONFIG_PATH} ${KUBECTL} --context ${KUBE_CONTEXT} -n ${NAMESPACE} ${rest}`;
}

// The kind commands the scripts run. `create cluster` and `delete cluster`
// always name the cluster `fiapx` and write KUBECONFIG_PATH; the caller may
// not pass `--name` or `--kubeconfig` itself.
const KIND_COMMANDS = ['version', 'get clusters', 'create cluster', 'delete cluster'];
export function kindArgs(args) {
  if (!Array.isArray(args) || args.length === 0 || args.some((arg) => typeof arg !== 'string')) {
    throw new Error('kind: arguments must be a non-empty array of strings');
  }
  const command = KIND_COMMANDS.find((c) => args.slice(0, c.split(' ').length).join(' ') === c);
  if (!command) throw new Error(`kind: only ${KIND_COMMANDS.join(', ')} are run, got "${args.slice(0, 2).join(' ')}"`);
  const flag = args.find((arg) => ['--name', '--kubeconfig', '-n'].some((f) => arg === f || arg.startsWith(`${f}=`)));
  if (flag) throw new Error(`kind: ${flag.split('=')[0]} is refused; the cluster is always ${KIND_CLUSTER} in ${KUBECONFIG_PATH}`);
  return command.endsWith(' cluster') ? [...args, '--name', KIND_CLUSTER, '--kubeconfig', KUBECONFIG_PATH] : [...args];
}

// Runs `kind <args>` (see kindArgs) and returns spawnSync's result.
export function kind(args, opts = {}, spawner = spawnSync) {
  return spawner(KIND, kindArgs(args), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

function selfTest() {
  const failures = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const expect = (name, actual, expected) => {
    if (!same(actual, expected)) failures.push(`${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  };
  const calls = [];
  const spawner = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0, stdout: 'ok', stderr: '' };
  };

  expect('KIND_CLUSTER', KIND_CLUSTER, 'fiapx');
  expect('KUBE_CONTEXT', KUBE_CONTEXT, 'kind-fiapx');
  expect('NAMESPACE', NAMESPACE, 'fiapx');

  // Accepted calls: the spawned command line starts with the pinned context.
  const accepted = [
    [['get', 'pods', '-n', 'fiapx'], ['--context', 'kind-fiapx', 'get', 'pods', '-n', 'fiapx']],
    [['kustomize', '--load-restrictor', 'LoadRestrictionsNone', 'k8s'], ['--context', 'kind-fiapx', 'kustomize', '--load-restrictor', 'LoadRestrictionsNone', 'k8s']],
    [['apply', '--server-side', '-f', '-'], ['--context', 'kind-fiapx', 'apply', '--server-side', '-f', '-']],
    [['create', 'configmap', 'fiapx-host', '-n', 'fiapx'], ['--context', 'kind-fiapx', 'create', 'configmap', 'fiapx-host', '-n', 'fiapx']],
    // After `--` the arguments are the container's command, not kubectl's.
    [['exec', '-i', 'statefulset/postgres', '--', 'psql', '-s', '--user=postgres'], ['--context', 'kind-fiapx', 'exec', '-i', 'statefulset/postgres', '--', 'psql', '-s', '--user=postgres']],
  ];
  for (const [args, expected] of accepted) {
    calls.length = 0;
    let result;
    try {
      result = kubectl(args, {}, spawner);
    } catch (error) {
      failures.push(`${JSON.stringify(args)}: threw ${JSON.stringify(error.message)}, expected it to run`);
      continue;
    }
    expect(`${JSON.stringify(args)} spawns one command`, calls.length, 1);
    expect(`${JSON.stringify(args)} command`, calls[0]?.command, 'kubectl');
    expect(`${JSON.stringify(args)} arguments`, calls[0]?.args, expected);
    expect(`${JSON.stringify(args)} result`, result?.stdout, 'ok');
  }
  calls.length = 0;
  kubectl(['apply', '-f', '-'], { input: 'x' }, spawner);
  expect('options pass through', [calls[0]?.options.input, calls[0]?.options.encoding], ['x', 'utf8']);
  // The cluster's own kubeconfig, never ~/.kube/config, and nothing else.
  expect('KUBECONFIG_PATH', KUBECONFIG_PATH, join(homedir(), '.kube', 'kind-fiapx.config'));
  expect('KUBECONFIG is the cluster file', calls[0]?.options.env?.KUBECONFIG, KUBECONFIG_PATH);
  calls.length = 0;
  kubectl(['get', 'pods'], { env: { PATH: '/bin', KUBECONFIG: '/home/me/.kube/config' } }, spawner);
  expect('a given env keeps its variables but not its KUBECONFIG', calls[0]?.options.env, { PATH: '/bin', KUBECONFIG: KUBECONFIG_PATH });

  // Refused calls: each throws its message and spawns nothing.
  const pinned = (flag) => `kubectl: ${flag} is refused; every call is pinned to --context kind-fiapx`;
  const refused = [
    [['get', 'pods', '--context', 'tech-challenge-eks-cluster'], pinned('--context')],
    [['get', 'pods', '--context=tech-challenge-eks-cluster'], pinned('--context')],
    [['apply', '-f', '-', '--kubeconfig', '/tmp/other'], pinned('--kubeconfig')],
    [['apply', '-f', '-', '--kubeconfig=/tmp/other'], pinned('--kubeconfig')],
    [['get', 'pods', '--cluster=eks'], pinned('--cluster')],
    [['get', 'pods', '--server', 'https://eks.example'], pinned('--server')],
    [['get', 'pods', '-s', 'https://eks.example'], pinned('-s')],
    [['get', 'pods', '--user=eks-admin'], pinned('--user')],
    [['config', 'use-context', 'kind-fiapx'], 'kubectl: "config use-context" is refused; scripts never read or change the kubeconfig'],
    [['config', 'current-context'], 'kubectl: "config current-context" is refused; scripts never read or change the kubeconfig'],
    [['-n', 'fiapx', 'config', 'use-context', 'eks'], 'kubectl: the subcommand must be the first argument, got "-n"'],
    [[], 'kubectl: arguments must be a non-empty array of strings'],
    [['get', 3], 'kubectl: arguments must be a non-empty array of strings'],
  ];
  for (const [args, message] of refused) {
    calls.length = 0;
    try {
      kubectl(args, {}, spawner);
      failures.push(`${JSON.stringify(args)}: ran, expected it to throw ${JSON.stringify(message)}`);
    } catch (error) {
      expect(`${JSON.stringify(args)} message`, error.message, message);
    }
    expect(`${JSON.stringify(args)} spawns nothing`, calls.length, 0);
  }

  // kind: create and delete always name fiapx and write KUBECONFIG_PATH.
  const kindAccepted = [
    [['version'], ['version']],
    [['get', 'clusters'], ['get', 'clusters']],
    [['create', 'cluster', '--config', '/tmp/k.yaml', '--wait', '120s'], ['create', 'cluster', '--config', '/tmp/k.yaml', '--wait', '120s', '--name', 'fiapx', '--kubeconfig', KUBECONFIG_PATH]],
    [['delete', 'cluster'], ['delete', 'cluster', '--name', 'fiapx', '--kubeconfig', KUBECONFIG_PATH]],
  ];
  for (const [args, expected] of kindAccepted) {
    calls.length = 0;
    try {
      kind(args, {}, spawner);
      expect(`kind ${JSON.stringify(args)} command`, [calls[0]?.command, calls[0]?.args], ['kind', expected]);
    } catch (error) {
      failures.push(`kind ${JSON.stringify(args)}: threw ${JSON.stringify(error.message)}, expected it to run`);
    }
  }
  const kindRefused = [
    [['delete', 'cluster', '--name', 'other'], `kind: --name is refused; the cluster is always fiapx in ${KUBECONFIG_PATH}`],
    [['create', 'cluster', '--kubeconfig=/home/me/.kube/config'], `kind: --kubeconfig is refused; the cluster is always fiapx in ${KUBECONFIG_PATH}`],
    [['export', 'kubeconfig'], 'kind: only version, get clusters, create cluster, delete cluster are run, got "export kubeconfig"'],
    [['delete', 'clusters', '--all'], 'kind: only version, get clusters, create cluster, delete cluster are run, got "delete clusters"'],
    [[], 'kind: arguments must be a non-empty array of strings'],
  ];
  for (const [args, message] of kindRefused) {
    calls.length = 0;
    try {
      kind(args, {}, spawner);
      failures.push(`kind ${JSON.stringify(args)}: ran, expected it to throw ${JSON.stringify(message)}`);
    } catch (error) {
      expect(`kind ${JSON.stringify(args)} message`, error.message, message);
    }
    expect(`kind ${JSON.stringify(args)} spawns nothing`, calls.length, 0);
  }

  // Hints name the cluster's kubeconfig and context and refuse a redirect.
  expect('kubectlHint', kubectlHint('get hpa -w'), `KUBECONFIG=${KUBECONFIG_PATH} kubectl --context kind-fiapx -n fiapx get hpa -w`);
  for (const [rest, message] of [
    ['get pods --context=eks', 'kubectlHint: --context is refused; every command is pinned to --context kind-fiapx'],
    ['get pods --kubeconfig /home/me/.kube/config', 'kubectlHint: --kubeconfig is refused; every command is pinned to --context kind-fiapx'],
    ['', 'kubectlHint: the command must be a non-empty string'],
  ]) {
    try {
      kubectlHint(rest);
      failures.push(`kubectlHint ${JSON.stringify(rest)}: returned, expected it to throw ${JSON.stringify(message)}`);
    } catch (error) {
      expect(`kubectlHint ${JSON.stringify(rest)} message`, error.message, message);
    }
  }

  // No export hands another script a spawnable binary name (K8S-04): no
  // exported string is, or ends in a path to, kubectl or kind.
  const exported = self;
  const spawnable = Object.entries(exported)
    .filter(([, value]) => typeof value === 'string' && /^(?:\S*\/)?(?:kubectl|kind)$/.test(value.trim()))
    .map(([name]) => name);
  expect('exports holding a binary name', spawnable, []);
  expect('exports', Object.keys(exported).sort(),
    ['KIND_CLUSTER', 'KUBECONFIG_PATH', 'KUBECTL_NOT_FOUND', 'KUBE_CONTEXT', 'KUSTOMIZE_RENDER_STEP', 'NAMESPACE', 'kind', 'kindArgs', 'kubectl', 'kubectlArgs', 'kubectlHint']);

  if (failures.length > 0) {
    for (const failure of failures) console.error(`kube self-test failed: ${failure}`);
    process.exit(1);
  }
  console.log(
    `kube self-test passed: ${accepted.length + 2} calls spawned with --context kind-fiapx first and KUBECONFIG ${KUBECONFIG_PATH}, ${refused.length} refused calls threw the expected message and spawned nothing; ${kindAccepted.length} kind calls built exactly, ${kindRefused.length} refused; hints pinned, 3 refused; no export holds a binary name`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    selfTest();
  } else {
    console.error('kube: a library for the other scripts; run it with --self-test');
    process.exit(1);
  }
}
