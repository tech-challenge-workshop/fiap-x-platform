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
import { randomInt } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIND_CLUSTER, KUBECTL_BIN, NAMESPACE, kind, kubectl } from './kube.mjs';

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(SELF), '..');
const DOWN_HINT = 'run node scripts/k8s-down.mjs first';
const HOST_CONFIGMAP = 'fiapx-host';
const DEFAULT_PORTS = { CATALOG_HOST_PORT: 3001, STORAGE_HOST_PORT: 9000 };
const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

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

async function main() {
  try {
    await provision(realDeps, process.env);
  } catch (error) {
    if (!(error instanceof UpError)) throw error;
    console.error(`k8s-up: ${error.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- self-test

// Fakes of every effect. `world` describes the machine: tools present, the
// daemon, the clusters kind lists, node readiness, the recorded host map,
// the Secrets present and the busy ports.
function fakeDeps(world = {}) {
  const w = { tools: { kind: true, kubectl: true, docker: true }, daemon: true, clusters: [], nodes: 'fiapx-control-plane=True', api: true, hostMap: undefined, secrets: {}, busy: [], ...world };
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

  if (failures.length > 0) {
    for (const failure of failures) console.error(`k8s-up self-test failed: ${failure}`);
    process.exit(1);
  }
  console.log(`k8s-up self-test passed: ${passed} assertions (kind config rendering, preflight, busy ports, cluster reuse and refusal, fiapx-host, Secret shapes and fixtures, definitions rewrite, create-if-absent, ghcr-pull)`);
}

if (process.argv[1] === SELF) {
  if (process.argv.includes('--self-test')) {
    await selfTest();
  } else {
    await main();
  }
}
