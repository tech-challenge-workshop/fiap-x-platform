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
// directly.
//
// `--self-test` spawns nothing: it drives `kubectl()` with an injected
// spawner and requires the exact argument list, and requires each refused
// argument to throw its message without spawning.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const KIND_CLUSTER = 'fiapx';
export const KUBE_CONTEXT = `kind-${KIND_CLUSTER}`;
export const NAMESPACE = 'fiapx';

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

// Runs `kubectl --context kind-fiapx <args>` and returns spawnSync's result.
// `opts` go to the spawner (input, env, maxBuffer, ...); utf8 by default.
export function kubectl(args, opts = {}, spawner = spawnSync) {
  return spawner('kubectl', kubectlArgs(args), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
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

  if (failures.length > 0) {
    for (const failure of failures) console.error(`kube self-test failed: ${failure}`);
    process.exit(1);
  }
  console.log(
    `kube self-test passed: ${accepted.length + 1} calls spawned with --context kind-fiapx first, ${refused.length} refused calls threw the expected message and spawned nothing`,
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
