// The documented down command of the local Kubernetes cluster (S9a; K8S-08):
//
//   node scripts/k8s-down.mjs
//
// Deletes the kind cluster `fiapx`, and only it: `kind delete cluster --name
// fiapx --kubeconfig ~/.kube/kind-fiapx.config`, built by scripts/kube.mjs,
// so no other cluster, kubeconfig or context is touched. The cluster's data
// (the Postgres and storage volumes) goes with it. Exits 0 when the cluster
// does not exist.
//
// `--self-test` spawns nothing: it runs the command against a fake kind
// spawner and requires the exact argument list of every call.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { KIND_CLUSTER, KUBECONFIG_PATH, kind } from './kube.mjs';

const SELF = fileURLToPath(import.meta.url);

// Returns { status, message }; `spawner` runs kind (spawnSync by default).
export function down(spawner = spawnSync) {
  const run = (args) => kind(args, {}, spawner);
  const list = run(['get', 'clusters']);
  if (list.error?.code === 'ENOENT') return { status: 1, message: 'kind not found on PATH (install kind v0.33 or later)' };
  if (list.error || list.status !== 0) return { status: 1, message: `kind get clusters failed: ${(list.error?.message ?? list.stderr ?? '').trim()}` };
  if (!list.stdout.split('\n').map((l) => l.trim()).includes(KIND_CLUSTER)) {
    return { status: 0, message: `the kind cluster ${KIND_CLUSTER} does not exist; nothing to delete` };
  }
  const deleted = run(['delete', 'cluster']);
  if (deleted.error || deleted.status !== 0) {
    return { status: 1, message: `kind delete cluster ${KIND_CLUSTER} failed: ${(deleted.error?.message ?? deleted.stderr ?? '').trim()}` };
  }
  return { status: 0, message: `deleted the kind cluster ${KIND_CLUSTER}` };
}

function selfTest() {
  const failures = [];
  let passed = 0;
  const expect = (name, actual, expected) => {
    if (JSON.stringify(actual) === JSON.stringify(expected)) passed += 1;
    else failures.push(`${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  };
  // A fake kind: `clusters` is what `get clusters` prints; `answers` forces a
  // result per subcommand.
  const fake = (clusters, answers = {}) => {
    const calls = [];
    const spawner = (command, args) => {
      calls.push([command, ...args]);
      return answers[args[0]] ?? { status: 0, stdout: args[0] === 'get' ? clusters : '', stderr: '' };
    };
    return { calls, spawner };
  };
  const list = ['kind', 'get', 'clusters'];
  const remove = ['kind', 'delete', 'cluster', '--name', 'fiapx', '--kubeconfig', KUBECONFIG_PATH];

  {
    const { calls, spawner } = fake('kind\nfiapx\n');
    expect('an existing cluster is deleted', down(spawner), { status: 0, message: 'deleted the kind cluster fiapx' });
    expect('an existing cluster: the exact commands', calls, [list, remove]);
  }
  {
    const { calls, spawner } = fake('kind\nfiapx-old\n');
    expect('an absent cluster exits 0', down(spawner), { status: 0, message: 'the kind cluster fiapx does not exist; nothing to delete' });
    expect('an absent cluster (another one named fiapx-old): nothing deleted', calls, [list]);
  }
  {
    const { calls, spawner } = fake('');
    expect('no cluster at all exits 0', down(spawner).status, 0);
    expect('no cluster at all: nothing deleted', calls, [list]);
  }
  {
    const { spawner } = fake('', { get: { status: null, stdout: '', stderr: '', error: Object.assign(new Error('spawn kind ENOENT'), { code: 'ENOENT' }) } });
    expect('kind missing exits 1 naming it', down(spawner), { status: 1, message: 'kind not found on PATH (install kind v0.33 or later)' });
  }
  {
    const { spawner } = fake('fiapx\n', { delete: { status: 1, stdout: '', stderr: 'ERROR: failed to delete cluster "fiapx"\n' } });
    expect('a failed delete exits 1 with kind\'s message', down(spawner), { status: 1, message: 'kind delete cluster fiapx failed: ERROR: failed to delete cluster "fiapx"' });
  }
  // The script itself never names a context: kind's argument list carries
  // only --name fiapx and the cluster's own kubeconfig.
  expect('the delete names only fiapx and its own kubeconfig', remove.slice(3), ['--name', KIND_CLUSTER, '--kubeconfig', KUBECONFIG_PATH]);

  if (failures.length > 0) {
    for (const failure of failures) console.error(`k8s-down self-test failed: ${failure}`);
    process.exit(1);
  }
  console.log(`k8s-down self-test passed: ${passed} assertions (delete of fiapx with its exact command, absent cluster, kind missing, failed delete)`);
}

if (process.argv[1] === SELF) {
  if (process.argv.includes('--self-test')) {
    selfTest();
  } else {
    const { status, message } = down();
    (status === 0 ? console.log : console.error)(`k8s-down: ${message}`);
    process.exit(status);
  }
}
