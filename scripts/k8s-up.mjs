// The documented up command of the local Kubernetes cluster (S9a; K8S-01,
// K8S-05..07, K8S-15):
//
//   node scripts/k8s-up.mjs
//
// 1. Preflight: kind, kubectl and Docker on PATH and the Docker daemon
//    reachable (K8S-05), before anything is created.
// 2. The kind cluster `fiapx`: reused when it exists, its node is Ready and
//    its recorded host-port map (ConfigMap `fiapx-host`) equals this run's;
//    otherwise every host port it would publish must be free (a TCP bind
//    probe; K8S-06) and it is created from k8s/kind-config.template.yaml with
//    CATALOG_HOST_PORT and STORAGE_HOST_PORT substituted (defaults 3001 and
//    9000, the variables Compose uses). A cluster that exists but is not
//    healthy, or publishes another map, stops the run with the hint to run
//    `node scripts/k8s-down.mjs` first.
// 3. Namespace `fiapx`, ConfigMap `fiapx-host` (the host-port map and the
//    API's STORAGE_PUBLIC_ENDPOINT), and every Secret the manifests read,
//    each created only if absent so a re-run never rotates a credential
//    under running pods (K8S-07, K8S-15). Generated values are alphanumeric
//    (KEDA refuses special characters in the management URL); the Postgres
//    role passwords are the db/init fixtures. RabbitMQ's definitions are the
//    repository's rabbitmq/definitions.json with `guest` replaced by the
//    generated user. With GHCR_TOKEN set, a `ghcr-pull` Secret is created and
//    the namespace's default ServiceAccount pulls with it (the fallback while
//    the GHCR packages are private).
// 4. KEDA v2.21.0: the release manifest downloaded from GitHub, its sha256
//    checked against the pinned value, applied server-side (its CRDs exceed
//    the client-side annotation limit), and its three Deployments waited for
//    (the admission webhook must answer before a ScaledObject is applied).
// 5. The topology: `kubectl kustomize --load-restrictor LoadRestrictionsNone
//    k8s` applied. A finished Job `storage-init` is deleted first, always:
//    a Job's pod template is immutable and carries the bootstrap
//    ConfigMap's hash suffix, so re-applying a changed bootstrap onto a
//    finished Job would fail; the bootstrap is idempotent, so running it
//    again on every up is harmless. A Job still running is left alone.
// 6. The wait (K8S-02, K8S-03, K8S-19): every Deployment and StatefulSet in
//    `fiapx` with all replicas updated and Ready, Job `storage-init`
//    Complete, and the HPA KEDA creates for the Worker (`keda-hpa-worker`)
//    present, within 600 s. On timeout, or at once when `storage-init`
//    fails, each workload that is not ready is printed with the waiting
//    reason of its pods (ImagePullBackOff, CrashLoopBackOff,
//    CreateContainerConfigError, ...) and the command exits 1. On success it
//    prints the host endpoints and how to read the generated admin
//    passwords.
//
// Every kubectl and kind call goes through scripts/kube.mjs: kubectl always
// runs as `--context kind-fiapx` against the cluster's own kubeconfig, and
// kind always creates `fiapx` into that file, so the machine's current
// context is never read or changed (K8S-04).
//
// `--self-test` spawns nothing: it drives every step with injected fakes of
// kubectl, kind, docker and the port probe, and requires the exact commands,
// objects and messages.
import { spawnSync } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIND_CLUSTER, KUBECONFIG_PATH, KUBECTL_BIN, KUBE_CONTEXT, NAMESPACE, kind, kubectl } from './kube.mjs';

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(SELF), '..');
const DOWN_HINT = 'run node scripts/k8s-down.mjs first';
const HOST_CONFIGMAP = 'fiapx-host';
const DEFAULT_PORTS = { CATALOG_HOST_PORT: 3001, STORAGE_HOST_PORT: 9000 };
const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// KEDA's release manifest, pinned by version and content.
export const KEDA = {
  version: '2.21.0',
  url: 'https://github.com/kedacore/keda/releases/download/v2.21.0/keda-2.21.0.yaml',
  sha256: 'b43c89ffeef81722d7e2dd2c079d74789767a0f89cae1336cff784994814f6d7',
  namespace: 'keda',
  deployments: ['keda-operator', 'keda-metrics-apiserver', 'keda-admission'],
};
const WAIT_BUDGET_MS = 600000;
const POLL_MS = 5000;
const WORKER_HPA = 'keda-hpa-worker';
const BOOTSTRAP_JOB = 'storage-init';

// Fixture passwords of the roles db/init/01-schemas.sql creates (spec
// Assumptions: test identities of a throwaway cluster, not secrets).
const DB_ROLE_FIXTURES = { CATALOG_DB_PASSWORD: 'catalog', NOTIFICATION_DB_PASSWORD: 'notification' };

export class UpError extends Error {}

// ---------------------------------------------------------------- pure parts

// The two overridable host ports, validated.
export function hostPorts(env) {
  const ports = {};
  for (const [name, fallback] of Object.entries(DEFAULT_PORTS)) {
    const raw = env[name] ?? String(fallback);
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) {
      throw new UpError(`${name} must be a port number between 1 and 65535, got ${JSON.stringify(raw)}`);
    }
    ports[name] = Number(raw);
  }
  return ports;
}

export function renderKindConfig(template, ports) {
  let text = template;
  for (const [name, port] of Object.entries(ports)) text = text.replaceAll(`\${${name}}`, String(port));
  const left = /\$\{[A-Z_]+\}/.exec(text);
  if (left) throw new UpError(`k8s/kind-config.template.yaml has a placeholder this command does not fill: ${left[0]}`);
  return text;
}

// Every host port a rendered kind config publishes, in file order.
export function publishedPorts(config) {
  return [...config.matchAll(/^\s*hostPort:\s*(\d+)\s*$/gm)].map((m) => Number(m[1]));
}

export function randomAlphanumeric(length, next = randomInt) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHANUMERIC[next(ALPHANUMERIC.length)];
  return out;
}

// The data of ConfigMap fiapx-host.
export function hostMapData(ports) {
  return {
    CATALOG_HOST_PORT: String(ports.CATALOG_HOST_PORT),
    STORAGE_HOST_PORT: String(ports.STORAGE_HOST_PORT),
    STORAGE_PUBLIC_ENDPOINT: `http://localhost:${ports.STORAGE_HOST_PORT}`,
  };
}

// The repository's definitions with its users and permissions replaced by
// the one generated user (administrator, full rights on every vhost the
// file grants).
export function rewriteDefinitions(text, username, password) {
  const definitions = JSON.parse(text);
  const vhosts = [...new Set((definitions.permissions ?? []).map((p) => p.vhost))];
  definitions.users = [{ name: username, password, tags: ['administrator'] }];
  definitions.permissions = (vhosts.length > 0 ? vhosts : ['/']).map((vhost) => ({ user: username, vhost, configure: '.*', write: '.*', read: '.*' }));
  return `${JSON.stringify(definitions, null, 2)}\n`;
}

// The string data of every Secret the manifests read, from the RabbitMQ
// credentials and a generator of random alphanumeric values.
export function secretData({ rabbit, random, definitions }) {
  const { username, password } = rabbit;
  return {
    'fiapx-postgres': { POSTGRES_PASSWORD: random(32), ...DB_ROLE_FIXTURES },
    'fiapx-storage': { ACCESS_KEY: random(20), SECRET_KEY: random(40) },
    'fiapx-rabbitmq': {
      USERNAME: username,
      PASSWORD: password,
      URL: `amqp://${username}:${password}@rabbitmq:5672`,
      'definitions.json': rewriteDefinitions(definitions, username, password),
    },
    'fiapx-keda-rabbitmq': { host: `http://${username}:${password}@rabbitmq.${NAMESPACE}.svc:15672/` },
    'fiapx-identity-admin': { KC_BOOTSTRAP_ADMIN_USERNAME: 'admin', KC_BOOTSTRAP_ADMIN_PASSWORD: random(24) },
    'fiapx-grafana-admin': { GF_SECURITY_ADMIN_USER: 'admin', GF_SECURITY_ADMIN_PASSWORD: random(24) },
  };
}

const secretObject = (name, stringData, type = 'Opaque') => ({
  apiVersion: 'v1',
  kind: 'Secret',
  metadata: { name, namespace: NAMESPACE, labels: { 'app.kubernetes.io/managed-by': 'k8s-up' } },
  type,
  stringData,
});

export function ghcrPullSecret(token, username = 'fiapx') {
  const auth = Buffer.from(`${username}:${token}`).toString('base64');
  return secretObject('ghcr-pull', { '.dockerconfigjson': JSON.stringify({ auths: { 'ghcr.io': { auth } } }) }, 'kubernetes.io/dockerconfigjson');
}

// What to do with the cluster: 'create' or 'reuse'; throws when neither is
// safe. `state` is what clusterState() observed.
export function clusterDecision(state, ports) {
  if (!state.exists) return 'create';
  if (!state.healthy) throw new UpError(`the kind cluster ${KIND_CLUSTER} exists but is not healthy (${state.why}); ${DOWN_HINT}`);
  if (!state.hostMap) {
    throw new UpError(`the kind cluster ${KIND_CLUSTER} has no recorded host-port map (ConfigMap ${NAMESPACE}/${HOST_CONFIGMAP}); ${DOWN_HINT}`);
  }
  const differs = Object.keys(DEFAULT_PORTS).filter((name) => state.hostMap[name] !== String(ports[name]));
  if (differs.length > 0) {
    const was = differs.map((name) => `${name}=${state.hostMap[name] ?? 'unset'}`).join(', ');
    const now = differs.map((name) => `${name}=${ports[name]}`).join(', ');
    throw new UpError(`the kind cluster ${KIND_CLUSTER} was created with ${was}, this run asks for ${now}; ${DOWN_HINT}, or set the same values`);
  }
  return 'reuse';
}

// Whether a Deployment or StatefulSet has every replica updated and Ready.
function rolledOut(obj) {
  const desired = obj.spec?.replicas ?? 1;
  const st = obj.status ?? {};
  return (st.observedGeneration ?? 0) >= (obj.metadata?.generation ?? 0) && (st.updatedReplicas ?? 0) >= desired && (st.readyReplicas ?? 0) >= desired;
}
const jobCondition = (job, type) => (job.status?.conditions ?? []).some((c) => c.type === type && c.status === 'True');

// What still stands between the topology and Ready, from `get
// deployments,statefulsets,jobs -o json` and the HPA names: a list of
// { id, app, state } plus `failed` when the bootstrap Job has failed.
export function pendingWorkloads(workloads, hpas) {
  const pending = [];
  let failed = false;
  const items = workloads.items ?? [];
  for (const obj of items) {
    const id = `${obj.kind}/${obj.metadata.name}`;
    const app = obj.metadata.labels?.app ?? obj.metadata.name;
    if (obj.kind === 'Job') {
      if (obj.metadata.name !== BOOTSTRAP_JOB || jobCondition(obj, 'Complete')) continue;
      failed = failed || jobCondition(obj, 'Failed');
      pending.push({ id, app, state: jobCondition(obj, 'Failed') ? 'failed' : 'not complete' });
    } else if (!rolledOut(obj)) {
      pending.push({ id, app, state: `${obj.status?.readyReplicas ?? 0}/${obj.spec?.replicas ?? 1} ready` });
    }
  }
  if (!items.some((o) => o.kind === 'Job' && o.metadata.name === BOOTSTRAP_JOB)) pending.push({ id: `Job/${BOOTSTRAP_JOB}`, app: BOOTSTRAP_JOB, state: 'not created' });
  if (!hpas.includes(WORKER_HPA)) pending.push({ id: `HorizontalPodAutoscaler/${WORKER_HPA}`, app: null, state: `not created by KEDA yet (see ${KUBECTL_BIN} --context ${KUBE_CONTEXT} -n ${NAMESPACE} describe scaledobject worker)` });
  return { pending, failed };
}

// Why a pod is not ready: every container's (init containers first) waiting
// reason, or its last termination reason, or the pod's phase.
export function podReasons(pod) {
  const reasons = [];
  for (const status of [...(pod.status?.initContainerStatuses ?? []), ...(pod.status?.containerStatuses ?? [])]) {
    const waiting = status.state?.waiting;
    if (waiting?.reason && waiting.reason !== 'PodInitializing') {
      const detail = /ImagePull|ErrImage|InvalidImageName/.test(waiting.reason) ? ` (${status.image})` : waiting.reason === 'CreateContainerConfigError' && waiting.message ? ` (${waiting.message})` : '';
      reasons.push(`${status.name} ${waiting.reason}${detail}`);
    } else if (status.state?.terminated && status.state.terminated.reason !== 'Completed') {
      reasons.push(`${status.name} ${status.state.terminated.reason ?? 'terminated'} (exit ${status.state.terminated.exitCode})`);
    } else if (status.state?.running && status.ready === false && !status.name.startsWith('wait-')) {
      reasons.push(`${status.name} running, not ready`);
    } else if (status.state?.running && status.name.startsWith('wait-')) {
      reasons.push(`${status.name} still waiting`);
    }
  }
  if (reasons.length === 0) reasons.push(pod.status?.phase === 'Pending' ? `Pending${pod.status?.conditions?.find((c) => c.type === 'PodScheduled' && c.status === 'False')?.reason ? ` (${pod.status.conditions.find((c) => c.type === 'PodScheduled').reason})` : ''}` : (pod.status?.phase ?? 'unknown'));
  return reasons;
}

// The report printed when the topology is not ready: one line per pending
// workload, with the reasons of each of its pods (matched by label app).
export function pendingReport(pending, pods) {
  return pending.map(({ id, app, state }) => {
    if (app === null) return `  ${id}: ${state}`;
    const own = (pods.items ?? []).filter((pod) => pod.metadata.labels?.app === app);
    const why = own.length === 0 ? 'no pod' : own.map((pod) => `${pod.metadata.name}: ${podReasons(pod).join(', ')}`).join('; ');
    return `  ${id} ${state}: ${why}`;
  }).join('\n');
}

// ---------------------------------------------------------------- effects

// A port is free when both the wildcard and the loopback address bind.
function bindable(port, host) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
  });
}
async function portFree(port) {
  return (await bindable(port, '0.0.0.0')) && (await bindable(port, '127.0.0.1'));
}

export const realDeps = {
  kubectl: (args, opts) => kubectl(args, opts),
  kind: (args, opts) => kind(args, opts),
  docker: (args) => spawnSync('docker', args, { encoding: 'utf8' }),
  portFree,
  random: (length) => randomAlphanumeric(length),
  readRepoFile: (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8'),
  log: (line) => console.log(line),
  fetchText: async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new UpError(`downloading ${url} answered ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const missing = (run) => run.error?.code === 'ENOENT';
const output = (run) => (run.error ? run.error.message : (run.stderr || run.stdout || '').trim());

// K8S-05: every tool present and the daemon reachable, or one error naming
// each problem.
export function preflightTools(deps) {
  const problems = [];
  if (missing(deps.kind(['version']))) problems.push('kind not found on PATH (install kind v0.33 or later)');
  if (missing(deps.kubectl(['version', '--client']))) problems.push(`${KUBECTL_BIN} not found on PATH (install ${KUBECTL_BIN} v1.36 or later)`);
  const docker = deps.docker(['info', '--format', '{{.ServerVersion}}']);
  if (missing(docker)) problems.push('docker not found on PATH (install Docker)');
  else if (docker.status !== 0 || docker.error) problems.push(`the Docker daemon is not reachable (docker info: ${output(docker)})`);
  if (problems.length > 0) throw new UpError(`preflight failed, nothing was created: ${problems.join('; ')}`);
}

function must(run, what) {
  if (run.error || run.status !== 0) throw new UpError(`${what} failed: ${output(run)}`);
  return run.stdout;
}

// Whether `fiapx` exists, whether its node is Ready, and its recorded
// host-port map (null when ConfigMap fiapx-host is absent).
export function clusterState(deps) {
  const clusters = must(deps.kind(['get', 'clusters']), 'kind get clusters').split('\n').map((l) => l.trim());
  if (!clusters.includes(KIND_CLUSTER)) return { exists: false };
  const nodes = deps.kubectl(['get', 'nodes', '-o', 'jsonpath={range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\\n"}{end}']);
  if (nodes.error || nodes.status !== 0) return { exists: true, healthy: false, why: `its API server does not answer: ${output(nodes)}` };
  const rows = nodes.stdout.split('\n').filter((l) => l.trim() !== '');
  const notReady = rows.filter((row) => !row.endsWith('=True')).map((row) => row.split('=')[0]);
  if (rows.length === 0) return { exists: true, healthy: false, why: 'it has no node' };
  if (notReady.length > 0) return { exists: true, healthy: false, why: `node ${notReady.join(', ')} is not Ready` };
  const map = deps.kubectl(['get', 'configmap', HOST_CONFIGMAP, '-n', NAMESPACE, '-o', 'json']);
  if (map.status !== 0 && /NotFound/.test(output(map))) return { exists: true, healthy: true, hostMap: null };
  return { exists: true, healthy: true, hostMap: JSON.parse(must(map, `reading ConfigMap ${HOST_CONFIGMAP}`)).data ?? {} };
}

// K8S-06: every published host port free, or one error naming each busy one.
export async function busyPortProblems(ports, config, deps) {
  const busy = [];
  for (const port of publishedPorts(config)) if (!(await deps.portFree(port))) busy.push(port);
  if (busy.length === 0) return;
  const overrides = Object.entries(ports).filter(([, port]) => busy.includes(port)).map(([name]) => name);
  const tip = overrides.length > 0 ? `, or move ${overrides.join('/')} to a free port` : '';
  throw new UpError(`host port ${busy.join(', ')} ${busy.length === 1 ? 'is' : 'are'} already in use; the cluster publishes the Compose ports, so stop whatever holds ${busy.length === 1 ? 'it' : 'them'} (the Compose stack: docker compose down)${tip}`);
}

function createCluster(config, deps) {
  const dir = mkdtempSync(join(tmpdir(), 'fiapx-kind-'));
  try {
    const file = join(dir, 'kind-config.yaml');
    writeFileSync(file, config);
    must(deps.kind(['create', 'cluster', '--config', file, '--wait', '120s'], { stdio: ['ignore', 'inherit', 'pipe'] }), `kind create cluster ${KIND_CLUSTER}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const applyJson = (deps, object, what) => must(deps.kubectl(['apply', '-f', '-'], { input: JSON.stringify(object) }), what);

// The names of the Secrets namespace fiapx already holds.
function existingSecrets(deps) {
  const out = must(deps.kubectl(['get', 'secrets', '-n', NAMESPACE, '-o', 'jsonpath={.items[*].metadata.name}']), 'listing the Secrets');
  return new Set(out.split(/\s+/).filter(Boolean));
}

function readSecret(deps, name) {
  const data = JSON.parse(must(deps.kubectl(['get', 'secret', name, '-n', NAMESPACE, '-o', 'json']), `reading Secret ${name}`)).data ?? {};
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Buffer.from(v, 'base64').toString('utf8')]));
}

// The RabbitMQ user: the one already in a Secret when one of the two
// RabbitMQ Secrets exists (a run stopped between them), otherwise new.
function rabbitCredentials(deps, existing) {
  if (existing.has('fiapx-rabbitmq')) {
    const { USERNAME: username, PASSWORD: password } = readSecret(deps, 'fiapx-rabbitmq');
    return { username, password };
  }
  if (existing.has('fiapx-keda-rabbitmq')) {
    const url = new URL(readSecret(deps, 'fiapx-keda-rabbitmq').host);
    return { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
  }
  return { username: `fiapx${deps.random(8)}`, password: deps.random(32) };
}

// Namespace, fiapx-host and every Secret (create-if-absent); returns the
// names of the Secrets it created.
export function provisionNamespace(ports, deps, env) {
  must(deps.kubectl(['apply', '-f', '-'], { input: deps.readRepoFile('k8s/namespace.yaml') }), `creating namespace ${NAMESPACE}`);
  applyJson(deps, { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: HOST_CONFIGMAP, namespace: NAMESPACE }, data: hostMapData(ports) }, `writing ConfigMap ${HOST_CONFIGMAP}`);

  const existing = existingSecrets(deps);
  const rabbit = rabbitCredentials(deps, existing);
  const wanted = Object.entries(secretData({ rabbit, random: deps.random, definitions: deps.readRepoFile('rabbitmq/definitions.json') }))
    .map(([name, data]) => secretObject(name, data));
  if (env.GHCR_TOKEN) wanted.push(ghcrPullSecret(env.GHCR_TOKEN, env.GHCR_USERNAME));
  const created = [];
  for (const secret of wanted) {
    if (existing.has(secret.metadata.name)) continue;
    // `create`, not `apply`: apply would keep the values in the
    // last-applied-configuration annotation.
    must(deps.kubectl(['create', '-f', '-'], { input: JSON.stringify(secret) }), `creating Secret ${secret.metadata.name}`);
    created.push(secret.metadata.name);
  }
  if (env.GHCR_TOKEN) {
    applyJson(deps, { apiVersion: 'v1', kind: 'ServiceAccount', metadata: { name: 'default', namespace: NAMESPACE }, imagePullSecrets: [{ name: 'ghcr-pull' }] }, 'attaching ghcr-pull to the default ServiceAccount');
  }
  return created;
}

// KEDA's pinned release, server-side applied, its Deployments Available.
export async function installKeda(deps) {
  let body;
  try {
    body = await deps.fetchText(KEDA.url);
  } catch (error) {
    throw new UpError(`could not download KEDA v${KEDA.version} from ${KEDA.url}: ${error.message}`);
  }
  const actual = createHash('sha256').update(body).digest('hex');
  if (actual !== KEDA.sha256) {
    throw new UpError(`the KEDA v${KEDA.version} manifest does not match its pinned checksum: expected sha256 ${KEDA.sha256}, got ${actual}; nothing was applied`);
  }
  deps.log(`k8s-up: installing KEDA v${KEDA.version}`);
  must(deps.kubectl(['apply', '--server-side', '--force-conflicts', '-f', '-'], { input: body.toString('utf8') }), `applying KEDA v${KEDA.version}`);
  must(deps.kubectl(['wait', '--for=condition=Available', '--timeout=180s', '-n', KEDA.namespace, ...KEDA.deployments.map((d) => `deployment/${d}`)]), `waiting for KEDA (${KEDA.deployments.join(', ')})`);
}

// A finished bootstrap Job is deleted so the apply can recreate it (its
// template is immutable); a running one is left alone.
function clearFinishedBootstrap(deps) {
  const run = deps.kubectl(['get', 'job', BOOTSTRAP_JOB, '-n', NAMESPACE, '-o', 'json']);
  if (run.status !== 0 && /NotFound/.test(output(run))) return false;
  const job = JSON.parse(must(run, `reading Job ${BOOTSTRAP_JOB}`));
  if (!jobCondition(job, 'Complete') && !jobCondition(job, 'Failed')) return false;
  must(deps.kubectl(['delete', 'job', BOOTSTRAP_JOB, '-n', NAMESPACE, '--wait=true']), `deleting the finished Job ${BOOTSTRAP_JOB}`);
  return true;
}

export function applyTopology(deps) {
  if (clearFinishedBootstrap(deps)) deps.log(`k8s-up: deleted the finished Job ${BOOTSTRAP_JOB}; the apply runs the bootstrap again`);
  const rendered = must(deps.kubectl(['kustomize', '--load-restrictor', 'LoadRestrictionsNone', join(REPO_ROOT, 'k8s')]), 'rendering k8s/');
  must(deps.kubectl(['apply', '-f', '-'], { input: rendered }), 'applying the topology');
}

// Polls until the topology is ready; throws the named report on timeout or
// when the bootstrap Job fails.
export async function waitForTopology(deps, budgetMs = WAIT_BUDGET_MS) {
  const deadline = deps.now() + budgetMs;
  deps.log(`k8s-up: waiting up to ${budgetMs / 1000} s for every workload in ${NAMESPACE}`);
  for (;;) {
    const workloads = JSON.parse(must(deps.kubectl(['get', 'deployments,statefulsets,jobs', '-n', NAMESPACE, '-o', 'json']), 'reading the workloads'));
    const hpas = must(deps.kubectl(['get', 'hpa', '-n', NAMESPACE, '-o', 'jsonpath={.items[*].metadata.name}']), 'reading the HPAs').split(/\s+/).filter(Boolean);
    const { pending, failed } = pendingWorkloads(workloads, hpas);
    if (pending.length === 0) return;
    const timedOut = deps.now() >= deadline;
    if (failed || timedOut) {
      const pods = JSON.parse(must(deps.kubectl(['get', 'pods', '-n', NAMESPACE, '-o', 'json']), 'reading the pods'));
      const head = failed ? `Job ${BOOTSTRAP_JOB} failed; the topology cannot become ready` : `not ready after ${budgetMs / 1000} s`;
      throw new UpError(`${head}:\n${pendingReport(pending, pods)}`);
    }
    await deps.sleep(POLL_MS);
  }
}

export function endpoints(ports) {
  const read = (secret, key) => `KUBECONFIG=${KUBECONFIG_PATH} ${KUBECTL_BIN} --context ${KUBE_CONTEXT} -n ${NAMESPACE} get secret ${secret} -o jsonpath='{.data.${key}}' | base64 -d`;
  return [
    'k8s-up: the topology is ready on the kind cluster fiapx',
    '  API           http://localhost:3000',
    `  Catalog       http://localhost:${ports.CATALOG_HOST_PORT}`,
    '  Notification  http://localhost:3003',
    '  Keycloak      http://localhost:8080 (issuer http://localhost:8080/realms/fiapx)',
    `  Storage (S3)  http://localhost:${ports.STORAGE_HOST_PORT}`,
    '  Mailpit       http://localhost:8025',
    '  RabbitMQ      http://localhost:15672 (metrics :15692)',
    '  Prometheus    http://localhost:9090',
    '  Grafana       http://localhost:3005 (user admin)',
    'Generated passwords:',
    `  Grafana admin:   ${read('fiapx-grafana-admin', 'GF_SECURITY_ADMIN_PASSWORD')}`,
    `  Keycloak admin:  ${read('fiapx-identity-admin', 'KC_BOOTSTRAP_ADMIN_PASSWORD')}`,
    `  RabbitMQ user:   ${read('fiapx-rabbitmq', 'USERNAME')}, password ${read('fiapx-rabbitmq', 'PASSWORD')}`,
    `Watch the Worker scale: KUBECONFIG=${KUBECONFIG_PATH} ${KUBECTL_BIN} --context ${KUBE_CONTEXT} -n ${NAMESPACE} get hpa -w`,
  ].join('\n');
}

// Part 1 of the up command: preflight, cluster, namespace, fiapx-host and
// Secrets.
export async function provision(deps, env) {
  const ports = hostPorts(env);
  const config = renderKindConfig(deps.readRepoFile('k8s/kind-config.template.yaml'), ports);
  preflightTools(deps);
  const decision = clusterDecision(clusterState(deps), ports);
  if (decision === 'create') {
    await busyPortProblems(ports, config, deps);
    deps.log(`k8s-up: creating the kind cluster ${KIND_CLUSTER} (host ports ${publishedPorts(config).join(', ')})`);
    createCluster(config, deps);
  } else {
    deps.log(`k8s-up: reusing the kind cluster ${KIND_CLUSTER}`);
  }
  const created = provisionNamespace(ports, deps, env);
  deps.log(`k8s-up: namespace ${NAMESPACE} ready; Secrets created: ${created.length > 0 ? created.join(', ') : 'none (all present)'}`);
  return { decision, ports, created };
}

// The whole up command.
export async function up(deps, env) {
  const { ports } = await provision(deps, env);
  await installKeda(deps);
  applyTopology(deps);
  await waitForTopology(deps);
  deps.log(endpoints(ports));
}

async function main() {
  try {
    await up(realDeps, process.env);
  } catch (error) {
    if (!(error instanceof UpError)) throw error;
    console.error(`k8s-up: ${error.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- self-test

// A KEDA body whose sha256 is the pinned one cannot be forged here, so the
// fakes serve a stand-in and the tests pin KEDA.sha256 to its hash for the
// duration of a run (withPinned).
const KEDA_FIXTURE = 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: keda\n';
const sha = (text) => createHash('sha256').update(text).digest('hex');
async function withPinned(hash, run) {
  const pinned = KEDA.sha256;
  KEDA.sha256 = hash;
  try {
    return await run();
  } finally {
    KEDA.sha256 = pinned;
  }
}

const deployment = (name, desired, ready, extra = {}) => ({ kind: 'Deployment', metadata: { name, generation: 1, labels: { app: name } }, spec: { replicas: desired }, status: { observedGeneration: 1, updatedReplicas: ready, readyReplicas: ready, ...extra } });
const statefulSet = (name, ready) => ({ kind: 'StatefulSet', metadata: { name, generation: 1, labels: { app: name } }, spec: { replicas: 1 }, status: { observedGeneration: 1, updatedReplicas: 1, readyReplicas: ready } });
const job = (condition) => ({ kind: 'Job', metadata: { name: 'storage-init', labels: { app: 'storage-init' } }, status: { conditions: condition ? [{ type: condition, status: 'True' }] : [] } });
const TOPOLOGY = ['api', 'catalog', 'notification', 'worker', 'rabbitmq', 'identity', 'mailpit', 'prometheus', 'grafana'];
// Every workload ready, the Job complete, the HPA present; `change` edits it.
function readyRound(change = (r) => r) {
  return change({
    workloads: { items: [...TOPOLOGY.map((n) => deployment(n, 1, 1)), statefulSet('postgres', 1), statefulSet('storage', 1), job('Complete')] },
    hpas: ['keda-hpa-worker'],
  });
}
const replaceItem = (round, name, item) => ({ ...round, workloads: { items: round.workloads.items.map((o) => (o.metadata.name === name ? item : o)) } });

// Fakes of every effect. `world` describes the machine: tools present, the
// daemon, the clusters kind lists, node readiness, the recorded host map,
// the Secrets present and the busy ports.
function fakeDeps(world = {}) {
  const w = { tools: { kind: true, kubectl: true, docker: true }, daemon: true, clusters: [], nodes: 'fiapx-control-plane=True', api: true, hostMap: undefined, secrets: {}, busy: [], keda: KEDA_FIXTURE, job: undefined, rounds: [readyRound()], pods: { items: [] }, clock: 0, ...world };
  w.clusters = [...w.clusters];
  w.secrets = { ...w.secrets };
  const calls = [];
  const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
  const enoent = () => ({ status: null, stdout: '', stderr: '', error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) });
  const b64 = (data) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Buffer.from(v).toString('base64')]));
  const deps = {
    calls,
    probed: [],
    logs: [],
    world: w,
    kind(args, opts) {
      calls.push({ tool: 'kind', args, opts });
      if (!w.tools.kind) return enoent();
      if (args[0] === 'get') return ok(w.clusters.map((c) => `${c}\n`).join(''));
      if (args[0] === 'create') {
        deps.createdConfig = readFileSync(args[args.indexOf('--config') + 1], 'utf8');
        w.clusters.push('fiapx');
      }
      return ok();
    },
    kubectl(args, opts) {
      calls.push({ tool: KUBECTL_BIN, args, opts });
      if (!w.tools.kubectl) return enoent();
      const [verb, what, name] = args;
      if (verb === 'version') return ok('Client Version: v1.36.1');
      if (verb === 'get' && what === 'nodes') return w.api ? ok(`${w.nodes}\n`) : { status: 1, stdout: '', stderr: 'The connection to the server 127.0.0.1:6443 was refused' };
      if (verb === 'get' && what === 'configmap') {
        return w.hostMap ? ok(JSON.stringify({ data: w.hostMap })) : { status: 1, stdout: '', stderr: `Error from server (NotFound): configmaps "${name}" not found` };
      }
      if (verb === 'get' && what === 'secrets') return ok(Object.keys(w.secrets).join(' '));
      if (verb === 'get' && what === 'job') return w.job ? ok(JSON.stringify(w.job)) : { status: 1, stdout: '', stderr: `Error from server (NotFound): jobs.batch "${name}" not found` };
      if (verb === 'get' && what === 'deployments,statefulsets,jobs') {
        deps.polls += 1;
        return ok(JSON.stringify(w.rounds[Math.min(deps.polls - 1, w.rounds.length - 1)].workloads));
      }
      if (verb === 'get' && what === 'hpa') return ok(w.rounds[Math.min(deps.polls - 1, w.rounds.length - 1)].hpas.join(' '));
      if (verb === 'get' && what === 'pods') return ok(JSON.stringify(w.pods));
      if (verb === 'kustomize') return ok('rendered topology');
      if (verb === 'get' && what === 'secret') return ok(JSON.stringify({ data: b64(w.secrets[name]) }));
      if (verb === 'create') {
        const secret = JSON.parse(opts.input);
        w.secrets[secret.metadata.name] = secret.stringData;
      }
      return ok();
    },
    docker(args) {
      calls.push({ tool: 'docker', args });
      if (!w.tools.docker) return enoent();
      return w.daemon ? ok('29.0.0') : { status: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock' };
    },
    async portFree(port) {
      deps.probed.push(port);
      return !w.busy.includes(port);
    },
    random: (length) => randomAlphanumeric(length),
    readRepoFile: (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8'),
    log: (line) => deps.logs.push(line),
    polls: 0,
    fetchText: async (url) => {
      calls.push({ tool: 'fetch', args: [url] });
      return Buffer.from(w.keda);
    },
    now: () => w.clock,
    sleep: async (ms) => {
      w.clock += ms;
    },
  };
  return deps;
}

async function selfTest() {
  const TEMPLATE = readFileSync(join(REPO_ROOT, 'k8s', 'kind-config.template.yaml'), 'utf8');
  const DEFINITIONS = readFileSync(join(REPO_ROOT, 'rabbitmq', 'definitions.json'), 'utf8');
  const failures = [];
  let passed = 0;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const expect = (name, actual, expected) => {
    if (same(actual, expected)) passed += 1;
    else failures.push(`${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  };
  const expectThrows = async (name, run, message) => {
    try {
      await run();
      failures.push(`${name}: succeeded, expected ${JSON.stringify(message)}`);
    } catch (error) {
      if (!(error instanceof UpError)) failures.push(`${name}: threw a non-UpError ${error.stack}`);
      else expect(`${name} message`, error.message, message);
    }
  };
  const created = (deps) => deps.calls.filter((c) => c.tool === 'kind' && c.args[0] === 'create').length;
  const mutations = (deps) => deps.calls.filter((c) => (c.tool === 'kind' && c.args[0] === 'create') || (c.tool === KUBECTL_BIN && ['apply', 'create'].includes(c.args[0])));
  const alnum = /^[A-Za-z0-9]+$/;

  // Rendering the kind config (T8's template).
  const defaults = hostPorts({});
  expect('default host ports', defaults, { CATALOG_HOST_PORT: 3001, STORAGE_HOST_PORT: 9000 });
  const rendered = renderKindConfig(TEMPLATE, defaults);
  expect('default published ports', publishedPorts(rendered), [3000, 3001, 3003, 8080, 9000, 8025, 15672, 15692, 9090, 3005]);
  expect('rendered cluster name', /^name: (\S+)$/m.exec(rendered)?.[1], KIND_CLUSTER);
  const moved = renderKindConfig(TEMPLATE, hostPorts({ CATALOG_HOST_PORT: '33001', STORAGE_HOST_PORT: '39000' }));
  expect('overridden published ports', publishedPorts(moved), [3000, 33001, 3003, 8080, 39000, 8025, 15672, 15692, 9090, 3005]);
  expect('only the two placeholders change', moved.replace('33001', '${CATALOG_HOST_PORT}').replace('39000', '${STORAGE_HOST_PORT}'), TEMPLATE);
  await expectThrows('a non-numeric CATALOG_HOST_PORT', () => hostPorts({ CATALOG_HOST_PORT: 'abc' }), 'CATALOG_HOST_PORT must be a port number between 1 and 65535, got "abc"');
  await expectThrows('STORAGE_HOST_PORT out of range', () => hostPorts({ STORAGE_HOST_PORT: '70000' }), 'STORAGE_HOST_PORT must be a port number between 1 and 65535, got "70000"');
  await expectThrows('an unfilled placeholder', () => renderKindConfig(`${TEMPLATE}\n# \${GRAFANA_HOST_PORT}\n`, defaults),
    'k8s/kind-config.template.yaml has a placeholder this command does not fill: ${GRAFANA_HOST_PORT}');

  // K8S-05: preflight names each missing tool and creates nothing.
  const preflight = [
    ['kind missing', { tools: { kind: false, kubectl: true, docker: true } }, 'preflight failed, nothing was created: kind not found on PATH (install kind v0.33 or later)'],
    ['the kube client missing', { tools: { kind: true, kubectl: false, docker: true } }, `preflight failed, nothing was created: ${KUBECTL_BIN} not found on PATH (install ${KUBECTL_BIN} v1.36 or later)`],
    ['docker missing', { tools: { kind: true, kubectl: true, docker: false } }, 'preflight failed, nothing was created: docker not found on PATH (install Docker)'],
    ['Docker daemon down', { daemon: false }, 'preflight failed, nothing was created: the Docker daemon is not reachable (docker info: Cannot connect to the Docker daemon at unix:///var/run/docker.sock)'],
    ['kind and docker missing', { tools: { kind: false, kubectl: true, docker: false } }, 'preflight failed, nothing was created: kind not found on PATH (install kind v0.33 or later); docker not found on PATH (install Docker)'],
  ];
  for (const [name, world, message] of preflight) {
    const deps = fakeDeps(world);
    await expectThrows(name, () => provision(deps, {}), message);
    expect(`${name}: nothing created or applied`, mutations(deps).length, 0);
  }

  // K8S-06: a busy host port stops the run before the cluster is created.
  {
    const deps = fakeDeps({ busy: [3001] });
    await expectThrows('Compose holding the catalog port', () => provision(deps, {}),
      'host port 3001 is already in use; the cluster publishes the Compose ports, so stop whatever holds it (the Compose stack: docker compose down), or move CATALOG_HOST_PORT to a free port');
    expect('busy port: nothing created or applied', mutations(deps).length, 0);
    expect('busy port: every published port probed', deps.probed, [3000, 3001, 3003, 8080, 9000, 8025, 15672, 15692, 9090, 3005]);
  }
  {
    const deps = fakeDeps({ busy: [8080, 39000] });
    await expectThrows('two busy ports, one overridden', () => provision(deps, { STORAGE_HOST_PORT: '39000' }),
      'host port 8080, 39000 are already in use; the cluster publishes the Compose ports, so stop whatever holds them (the Compose stack: docker compose down), or move STORAGE_HOST_PORT to a free port');
    expect('two busy ports: no cluster created', created(deps), 0);
  }

  // An existing cluster that is unhealthy or publishes another map.
  const existing = { clusters: ['kind', 'fiapx'], hostMap: hostMapData(defaults) };
  const reuseFailures = [
    ['node not Ready', { ...existing, nodes: 'fiapx-control-plane=False' }, `the kind cluster fiapx exists but is not healthy (node fiapx-control-plane is not Ready); ${DOWN_HINT}`],
    ['API server down (a stopped node container)', { ...existing, api: false }, `the kind cluster fiapx exists but is not healthy (its API server does not answer: The connection to the server 127.0.0.1:6443 was refused); ${DOWN_HINT}`],
    ['no recorded host map', { ...existing, hostMap: undefined }, `the kind cluster fiapx has no recorded host-port map (ConfigMap fiapx/fiapx-host); ${DOWN_HINT}`],
  ];
  for (const [name, world, message] of reuseFailures) {
    const deps = fakeDeps(world);
    await expectThrows(name, () => provision(deps, {}), message);
    expect(`${name}: nothing created or applied`, mutations(deps).length, 0);
  }
  {
    const deps = fakeDeps(existing);
    await expectThrows('a different port map', () => provision(deps, { CATALOG_HOST_PORT: '33001' }),
      `the kind cluster fiapx was created with CATALOG_HOST_PORT=3001, this run asks for CATALOG_HOST_PORT=33001; ${DOWN_HINT}, or set the same values`);
    expect('a different port map: nothing created or applied', mutations(deps).length, 0);
  }

  // A fresh cluster: created from the rendered config, then namespace,
  // fiapx-host and the six Secrets.
  const fresh = fakeDeps();
  const first = await provision(fresh, {});
  expect('fresh: decision', first.decision, 'create');
  expect('fresh: one cluster created', created(fresh), 1);
  const create = fresh.calls.find((c) => c.tool === 'kind' && c.args[0] === 'create');
  expect('fresh: kind create arguments', [create.args.slice(0, 3), create.args.slice(4)], [['create', 'cluster', '--config'], ['--wait', '120s']]);
  expect('fresh: the cluster config is the rendered template', fresh.createdConfig, rendered);
  const applied = fresh.calls.filter((c) => c.tool === KUBECTL_BIN && c.args[0] === 'apply').map((c) => c.opts.input);
  expect('fresh: namespace applied from k8s/namespace.yaml', applied[0], readFileSync(join(REPO_ROOT, 'k8s', 'namespace.yaml'), 'utf8'));
  expect('fresh: fiapx-host', JSON.parse(applied[1]), { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'fiapx-host', namespace: 'fiapx' }, data: { CATALOG_HOST_PORT: '3001', STORAGE_HOST_PORT: '9000', STORAGE_PUBLIC_ENDPOINT: 'http://localhost:9000' } });
  expect('fresh: Secrets created', first.created, ['fiapx-postgres', 'fiapx-storage', 'fiapx-rabbitmq', 'fiapx-keda-rabbitmq', 'fiapx-identity-admin', 'fiapx-grafana-admin']);
  const creates = fresh.calls.filter((c) => c.tool === KUBECTL_BIN && c.args[0] === 'create');
  expect('fresh: Secrets go through create -f -, never apply', creates.map((c) => c.args), creates.map(() => ['create', '-f', '-']));
  expect('fresh: no Secret is ever applied', applied.some((i) => i.includes('"kind":"Secret"')), false);
  const s = fresh.world.secrets;
  expect('fiapx-postgres keys', Object.keys(s['fiapx-postgres']), ['POSTGRES_PASSWORD', 'CATALOG_DB_PASSWORD', 'NOTIFICATION_DB_PASSWORD']);
  expect('fiapx-postgres: superuser random, roles the db/init fixtures', [alnum.test(s['fiapx-postgres'].POSTGRES_PASSWORD) && s['fiapx-postgres'].POSTGRES_PASSWORD.length, s['fiapx-postgres'].CATALOG_DB_PASSWORD, s['fiapx-postgres'].NOTIFICATION_DB_PASSWORD], [32, 'catalog', 'notification']);
  expect('fiapx-storage keys and lengths', Object.entries(s['fiapx-storage']).map(([k, v]) => [k, alnum.test(v) && v.length]), [['ACCESS_KEY', 20], ['SECRET_KEY', 40]]);
  const r = s['fiapx-rabbitmq'];
  expect('fiapx-rabbitmq keys', Object.keys(r), ['USERNAME', 'PASSWORD', 'URL', 'definitions.json']);
  expect('fiapx-rabbitmq user and password alphanumeric', [/^fiapx[A-Za-z0-9]{8}$/.test(r.USERNAME), alnum.test(r.PASSWORD) && r.PASSWORD.length], [true, 32]);
  expect('fiapx-rabbitmq URL', r.URL, `amqp://${r.USERNAME}:${r.PASSWORD}@rabbitmq:5672`);
  expect('fiapx-keda-rabbitmq host', s['fiapx-keda-rabbitmq'], { host: `http://${r.USERNAME}:${r.PASSWORD}@rabbitmq.fiapx.svc:15672/` });
  const defs = JSON.parse(r['definitions.json']);
  const repoDefs = JSON.parse(DEFINITIONS);
  expect('definitions: guest replaced by the generated user', [defs.users, defs.permissions],
    [[{ name: r.USERNAME, password: r.PASSWORD, tags: ['administrator'] }], [{ user: r.USERNAME, vhost: '/', configure: '.*', write: '.*', read: '.*' }]]);
  expect('definitions: no guest left', r['definitions.json'].includes('guest'), false);
  expect('definitions: everything else unchanged', { ...defs, users: repoDefs.users, permissions: repoDefs.permissions }, repoDefs);
  expect('fiapx-identity-admin', [s['fiapx-identity-admin'].KC_BOOTSTRAP_ADMIN_USERNAME, alnum.test(s['fiapx-identity-admin'].KC_BOOTSTRAP_ADMIN_PASSWORD) && s['fiapx-identity-admin'].KC_BOOTSTRAP_ADMIN_PASSWORD.length], ['admin', 24]);
  expect('fiapx-grafana-admin', [s['fiapx-grafana-admin'].GF_SECURITY_ADMIN_USER, alnum.test(s['fiapx-grafana-admin'].GF_SECURITY_ADMIN_PASSWORD) && s['fiapx-grafana-admin'].GF_SECURITY_ADMIN_PASSWORD.length], ['admin', 24]);
  expect('no ghcr-pull without GHCR_TOKEN', Object.hasOwn(s, 'ghcr-pull'), false);
  const other = fakeDeps();
  await provision(other, {});
  expect('two clusters get different generated values', ['POSTGRES_PASSWORD'].map((k) => other.world.secrets['fiapx-postgres'][k] === s['fiapx-postgres'][k]).concat(other.world.secrets['fiapx-rabbitmq'].PASSWORD === r.PASSWORD), [false, false]);

  // K8S-07: a second run reuses the cluster, probes no port, creates nothing
  // and rotates no Secret.
  const before = JSON.stringify(fresh.world.secrets);
  fresh.world.hostMap = hostMapData(defaults);
  fresh.calls.length = 0;
  fresh.probed.length = 0;
  const second = await provision(fresh, {});
  expect('re-run: decision', second.decision, 'reuse');
  expect('re-run: no cluster created, no port probed', [created(fresh), fresh.probed.length], [0, 0]);
  expect('re-run: no Secret created', second.created, []);
  expect('re-run: Secrets unchanged', JSON.stringify(fresh.world.secrets), before);

  // A run stopped between the two RabbitMQ Secrets: the missing one reuses
  // the present one's user.
  {
    const deps = fakeDeps({ ...existing, secrets: { 'fiapx-rabbitmq': { USERNAME: 'fiapxAbc', PASSWORD: 'Pass1', URL: 'amqp://fiapxAbc:Pass1@rabbitmq:5672', 'definitions.json': '{}' } } });
    const run = await provision(deps, {});
    expect('partial: the KEDA Secret reuses the broker user', deps.world.secrets['fiapx-keda-rabbitmq'], { host: 'http://fiapxAbc:Pass1@rabbitmq.fiapx.svc:15672/' });
    expect('partial: the broker Secret is kept', [run.created.includes('fiapx-rabbitmq'), deps.world.secrets['fiapx-rabbitmq'].PASSWORD], [false, 'Pass1']);
  }
  {
    const deps = fakeDeps({ ...existing, secrets: { 'fiapx-keda-rabbitmq': { host: 'http://fiapxXyz:Word2@rabbitmq.fiapx.svc:15672/' } } });
    await provision(deps, {});
    expect('partial: the broker Secret reuses the KEDA user', [deps.world.secrets['fiapx-rabbitmq'].USERNAME, deps.world.secrets['fiapx-rabbitmq'].PASSWORD], ['fiapxXyz', 'Word2']);
  }

  // GHCR_TOKEN: a dockerconfigjson Secret and the default ServiceAccount.
  {
    const deps = fakeDeps();
    await provision(deps, { GHCR_TOKEN: 'ghp_token', GHCR_USERNAME: 'octo' });
    const auth = JSON.parse(deps.world.secrets['ghcr-pull']['.dockerconfigjson']).auths['ghcr.io'].auth;
    expect('ghcr-pull auth', Buffer.from(auth, 'base64').toString(), 'octo:ghp_token');
    const sa = deps.calls.filter((c) => c.tool === KUBECTL_BIN && c.args[0] === 'apply').map((c) => c.opts.input).find((i) => i.includes('ServiceAccount'));
    expect('default ServiceAccount pulls with ghcr-pull', JSON.parse(sa ?? '{}'), { apiVersion: 'v1', kind: 'ServiceAccount', metadata: { name: 'default', namespace: 'fiapx' }, imagePullSecrets: [{ name: 'ghcr-pull' }] });
    const createInput = deps.calls.find((c) => c.tool === KUBECTL_BIN && c.args[0] === 'create' && c.opts.input.includes('ghcr-pull'))?.opts.input;
    expect('ghcr-pull type', JSON.parse(createInput ?? '{}').type, 'kubernetes.io/dockerconfigjson');
  }

  // The effects go through kube.mjs, which adds the context and kubeconfig:
  // no argument list built here names either.
  expect('no context or kubeconfig flag built here', fresh.calls.some((c) => c.args.some((a) => /^--(context|kubeconfig)/.test(a))), false);
  expect('realDeps use the kube.mjs helpers', [realDeps.kubectl.toString().includes('kubectl(args'), realDeps.kind.toString().includes('kind(args')], [true, true]);

  // ---- part 2: KEDA, apply, wait.
  const kubectlCalls = (deps) => deps.calls.filter((c) => c.tool === KUBECTL_BIN);

  // The pinned value is the real release's sha256 (downloaded once, T25).
  expect('KEDA pin', [KEDA.url, KEDA.sha256, KEDA.deployments], ['https://github.com/kedacore/keda/releases/download/v2.21.0/keda-2.21.0.yaml', 'b43c89ffeef81722d7e2dd2c079d74789767a0f89cae1336cff784994814f6d7', ['keda-operator', 'keda-metrics-apiserver', 'keda-admission']]);
  // A checksum mismatch names both hashes and applies nothing.
  {
    const deps = fakeDeps({ keda: `${KEDA_FIXTURE}# tampered\n` });
    await withPinned(sha(KEDA_FIXTURE), () => expectThrows('KEDA checksum mismatch', () => installKeda(deps),
      `the KEDA v2.21.0 manifest does not match its pinned checksum: expected sha256 ${sha(KEDA_FIXTURE)}, got ${sha(`${KEDA_FIXTURE}# tampered\n`)}; nothing was applied`));
    expect('KEDA checksum mismatch: nothing applied', kubectlCalls(deps).length, 0);
  }
  {
    const deps = fakeDeps();
    deps.fetchText = async () => { throw new Error('getaddrinfo ENOTFOUND github.com'); };
    await expectThrows('KEDA download failure', () => installKeda(deps), `could not download KEDA v2.21.0 from ${KEDA.url}: getaddrinfo ENOTFOUND github.com`);
  }
  // A matching download: fetched from the pinned URL, applied server-side
  // with its exact bytes, then its three Deployments waited for.
  {
    const deps = fakeDeps();
    await withPinned(sha(KEDA_FIXTURE), () => installKeda(deps));
    expect('KEDA fetched from the pinned URL', deps.calls.filter((c) => c.tool === 'fetch').map((c) => c.args[0]), [KEDA.url]);
    const [apply, wait] = kubectlCalls(deps);
    expect('KEDA applied server-side with the downloaded bytes', [apply?.args, apply?.opts.input], [['apply', '--server-side', '--force-conflicts', '-f', '-'], KEDA_FIXTURE]);
    expect('KEDA Deployments waited for', wait?.args, ['wait', '--for=condition=Available', '--timeout=180s', '-n', 'keda', 'deployment/keda-operator', 'deployment/keda-metrics-apiserver', 'deployment/keda-admission']);
  }

  // The apply: a finished storage-init Job is deleted first, a running or
  // absent one is not; the render goes to apply -f - unchanged.
  const applyCase = (name, jobState, deletes) => {
    const deps = fakeDeps({ job: jobState });
    applyTopology(deps);
    const verbs = kubectlCalls(deps).map((c) => c.args.slice(0, 3).join(' '));
    const expected = ['get job storage-init', ...(deletes ? ['delete job storage-init'] : []), `kustomize --load-restrictor LoadRestrictionsNone`, 'apply -f -'];
    expect(`apply with ${name}`, verbs, expected);
    expect(`apply with ${name}: the render is applied`, kubectlCalls(deps).at(-1).opts.input, 'rendered topology');
    expect(`apply with ${name}: the kustomization directory`, kubectlCalls(deps).find((c) => c.args[0] === 'kustomize').args[3], join(REPO_ROOT, 'k8s'));
  };
  applyCase('no bootstrap Job yet', undefined, false);
  applyCase('a completed bootstrap Job', job('Complete'), true);
  applyCase('a failed bootstrap Job', job('Failed'), true);
  applyCase('a running bootstrap Job', job(null), false);

  // The wait: ready at once, ready after two polls.
  {
    const deps = fakeDeps();
    await waitForTopology(deps);
    expect('wait: ready at once polls once and sleeps never', [deps.polls, deps.world.clock], [1, 0]);
  }
  {
    const slow = readyRound((r) => replaceItem(r, 'identity', deployment('identity', 1, 0)));
    const deps = fakeDeps({ rounds: [slow, readyRound((r) => ({ ...r, hpas: [] })), readyRound()] });
    await waitForTopology(deps);
    expect('wait: keeps polling until the workloads and the HPA are ready', [deps.polls, deps.world.clock], [3, 10000]);
  }
  // Timeout: each workload not ready, named with its pods' reasons.
  const pod = (name, app, statuses, init = [], phase = 'Pending') => ({ metadata: { name, labels: { app } }, status: { phase, initContainerStatuses: init, containerStatuses: statuses } });
  const waiting = (name, reason, image, message) => ({ name, image, ready: false, state: { waiting: { reason, ...(message ? { message } : {}) } } });
  {
    const stuck = readyRound((r) => replaceItem(replaceItem(replaceItem(r, 'worker', deployment('worker', 1, 0)), 'api', deployment('api', 1, 0)), 'catalog', deployment('catalog', 1, 0)));
    const pods = { items: [
      pod('worker-7d9f-abc', 'worker', [waiting('worker', 'ImagePullBackOff', 'ghcr.io/tech-challenge-workshop/processing-worker:main')], [{ name: 'wait-for-bucket', ready: true, state: { terminated: { reason: 'Completed', exitCode: 0 } } }]),
      pod('api-5c6d-def', 'api', [waiting('api', 'CrashLoopBackOff', 'ghcr.io/tech-challenge-workshop/fiap-x-api:main')], [], 'Running'),
      pod('catalog-1a2b-ghi', 'catalog', [waiting('catalog', 'CreateContainerConfigError', 'x', 'secret "fiapx-postgres" not found')]),
      pod('mailpit-0-jkl', 'mailpit', [{ name: 'mailpit', ready: true, state: { running: {} } }], [], 'Running'),
    ] };
    const deps = fakeDeps({ rounds: [stuck], pods });
    await expectThrows('wait: timeout names each workload and its reason', () => waitForTopology(deps), [
      'not ready after 600 s:',
      '  Deployment/api 0/1 ready: api-5c6d-def: api CrashLoopBackOff',
      '  Deployment/catalog 0/1 ready: catalog-1a2b-ghi: catalog CreateContainerConfigError (secret "fiapx-postgres" not found)',
      '  Deployment/worker 0/1 ready: worker-7d9f-abc: worker ImagePullBackOff (ghcr.io/tech-challenge-workshop/processing-worker:main)',
    ].join('\n'));
    expect('wait: the budget is 600 s of 5 s polls', [deps.world.clock, deps.polls], [600000, 121]);
  }
  {
    const stuck = readyRound((r) => ({ ...replaceItem(r, 'grafana', deployment('grafana', 1, 0)), hpas: [] }));
    const deps = fakeDeps({ rounds: [stuck], pods: { items: [pod('grafana-x', 'grafana', [{ name: 'grafana', ready: false, state: { running: {} } }], [], 'Running')] } });
    await expectThrows('wait: a running pod that is not ready and a missing HPA', () => waitForTopology(deps, 10000), [
      'not ready after 10 s:',
      '  Deployment/grafana 0/1 ready: grafana-x: grafana running, not ready',
      `  HorizontalPodAutoscaler/keda-hpa-worker: not created by KEDA yet (see ${KUBECTL_BIN} --context kind-fiapx -n fiapx describe scaledobject worker)`,
    ].join('\n'));
  }
  // The bootstrap Job failing stops the wait at once, naming it; the API
  // and Worker still waiting for the bucket are named too.
  {
    const broken = readyRound((r) => replaceItem(replaceItem(r, 'storage-init', job('Failed')), 'api', deployment('api', 1, 0)));
    const pods = { items: [
      pod('storage-init-p1', 'storage-init', [{ name: 'bootstrap', ready: false, state: { terminated: { reason: 'Error', exitCode: 254 } } }], [], 'Failed'),
      pod('api-q1', 'api', [waiting('api', 'PodInitializing', 'img')], [{ name: 'wait-for-bucket', ready: false, state: { running: {} } }]),
    ] };
    const deps = fakeDeps({ rounds: [broken], pods });
    await expectThrows('wait: the bootstrap Job failed', () => waitForTopology(deps), [
      'Job storage-init failed; the topology cannot become ready:',
      '  Deployment/api 0/1 ready: api-q1: wait-for-bucket still waiting',
      '  Job/storage-init failed: storage-init-p1: bootstrap Error (exit 254)',
    ].join('\n'));
    expect('wait: a failed Job stops without sleeping', deps.world.clock, 0);
  }
  // A rollout still in progress (new pods not all updated) is not ready.
  expect('wait: an old generation or a partial update is pending', pendingWorkloads({ items: [deployment('api', 1, 1, { observedGeneration: 0 }), deployment('worker', 3, 3, { updatedReplicas: 2 }), job('Complete'), statefulSet('postgres', 0)] }, ['keda-hpa-worker']).pending.map((p) => p.id),
    ['Deployment/api', 'Deployment/worker', 'StatefulSet/postgres']);
  expect('wait: a scaled-out Worker with every replica ready is ready', pendingWorkloads({ items: [deployment('worker', 4, 4), job('Complete')] }, ['keda-hpa-worker']).pending, []);
  expect('wait: no bootstrap Job at all is pending', pendingWorkloads({ items: [] }, ['keda-hpa-worker']).pending.map((p) => p.id), ['Job/storage-init']);
  expect('wait: a pending unschedulable pod names why', podReasons({ status: { phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'False', reason: 'Unschedulable' }] } }), ['Pending (Unschedulable)']);

  // The whole command on a fresh machine: provision, KEDA, apply, wait,
  // endpoints, in that order.
  {
    const deps = fakeDeps();
    await withPinned(sha(KEDA_FIXTURE), () => up(deps, {}));
    const order = deps.calls.map((c) => (c.tool === 'kind' ? `kind ${c.args[0]}` : c.tool === 'fetch' ? 'fetch' : c.tool === 'docker' ? 'docker' : `${c.args[0]} ${c.args[1] ?? ''}`.trim()))
      .filter((step) => ['kind create', 'fetch', 'apply --server-side', 'wait --for=condition=Available', 'kustomize --load-restrictor', 'get deployments,statefulsets,jobs'].includes(step) || step.startsWith('create -f'));
    expect('up: steps in order', [...new Set(order)], ['kind create', 'create -f', 'fetch', 'apply --server-side', 'wait --for=condition=Available', 'kustomize --load-restrictor', 'get deployments,statefulsets,jobs']);
    const printed = deps.logs.at(-1);
    expect('up: endpoints and the password hints', [printed.startsWith('k8s-up: the topology is ready on the kind cluster fiapx'), printed.includes(`KUBECONFIG=${KUBECONFIG_PATH} ${KUBECTL_BIN} --context kind-fiapx -n fiapx get secret fiapx-grafana-admin -o jsonpath='{.data.GF_SECURITY_ADMIN_PASSWORD}' | base64 -d`)], [true, true]);
    expect('up: moved ports are the ones printed', endpoints({ CATALOG_HOST_PORT: 33001, STORAGE_HOST_PORT: 39000 }).split('\n').filter((l) => /Catalog|Storage/.test(l)), ['  Catalog       http://localhost:33001', '  Storage (S3)  http://localhost:39000']);
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`k8s-up self-test failed: ${failure}`);
    process.exit(1);
  }
  console.log(`k8s-up self-test passed: ${passed} assertions (kind config rendering, preflight, busy ports, cluster reuse and refusal, fiapx-host, Secret shapes and fixtures, definitions rewrite, create-if-absent, ghcr-pull; KEDA checksum and install, bootstrap Job handling, apply, the 600 s wait and its named report)`);
}

if (process.argv[1] === SELF) {
  if (process.argv.includes('--self-test')) {
    await selfTest();
  } else {
    await main();
  }
}
