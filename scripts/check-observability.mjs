// Fails when the observability wiring stops matching what the stack promises
// (OBS-74, with structural backing for OBS-61..67).
//
// Default mode reads the repository and `docker compose config` (rendered
// with WORKER_REPLICAS unset, so the default is what is checked) and requires:
//
//   prometheus.yml   scrape every 15 s with a 10 s timeout; static targets
//                    api:3000, catalog:3001, notification:3003 and
//                    rabbitmq:15692; the worker found by an A-record lookup
//                    of `worker` on 3002 and never as a static target; no
//                    credentials on any job;
//   grafana          one datasource, uid `prometheus`, type prometheus, at
//                    http://prometheus:9090, the default; a file provider
//                    whose path compose mounts from grafana/dashboards;
//   dashboards       every grafana/dashboards/*.json parses, has a uid, and
//                    every panel and query names the `prometheus` uid; every
//                    PromQL metric is one the services or the broker export;
//                    no query selects or groups by an owner, email, user or
//                    request/correlation id label, and neither does any
//                    query template variable; `fiapx-overview` exists;
//   rabbitmq         enabled_plugins lists rabbitmq_management and
//                    rabbitmq_prometheus and compose mounts it; rabbitmq.conf
//                    sets the metrics port 15692 and per-object metrics;
//   compose          prometheus and grafana have an image, a health check and
//                    their configuration mounted read-only; grafana publishes
//                    3005; prometheus depends on nothing and no business
//                    service depends on prometheus or grafana; the worker
//                    runs 1 replica by default.
//
// `--live` probes a running stack: each service's /metrics answers 200 with
// a `fiapx_` line and /health/live answers 200 (every worker replica, by the
// host port compose published for it); the broker serves per-queue depth;
// Prometheus reports every target up, one worker target per replica; Grafana
// serves the provisioned overview dashboard.
//
// `--self-test` needs nothing external: it corrupts an in-memory copy of the
// repository once per invariant and requires the exact message, probes the
// live checks with injected answers, runs the load test's self-test, and
// spawns this script against a corrupted copy, which must exit non-zero.
//
// The YAML files are read with the small strict parser below: the repository
// has no package.json. It understands block maps, block sequences and flow
// sequences, and throws on anything else, so a construct it does not know
// fails the check rather than being misread.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = process.env.OBS_ROOT ?? join(dirname(SELF), '..');

const MONITORING = new Set(['prometheus', 'grafana']);
const STATIC_TARGETS = ['api:3000', 'catalog:3001', 'notification:3003', 'rabbitmq:15692'];
const DATASOURCE_UID = 'prometheus';
const DASHBOARD_MOUNT = '/var/lib/grafana/dashboards';
const PROVISIONING_MOUNT = '/etc/grafana/provisioning';
const OVERVIEW_UID = 'fiapx-overview';
const WORK_QUEUES = ['video-validation', 'processing', 'notification.terminal'];

// Every metric family a dashboard may query, from each service's
// src/observability/metrics.ts on feat/observability (Notification: its
// design), the broker plugin, and Prometheus's own `up`. Histograms may be
// queried through their _bucket, _sum and _count series.
// SPEC_DEVIATION: no fiapx_node_* family. No service registers prom-client's
// default metrics, so the design's "Node" row has no series (design.md).
const COUNTERS_AND_GAUGES = [
  'fiapx_uploads_total', 'fiapx_downloads_total', 'fiapx_http_requests_total',
  'fiapx_outbox_pending_rows', 'fiapx_outbox_oldest_pending_seconds', 'fiapx_outbox_publish_failures_total',
  'fiapx_events_consumed_total',
  'fiapx_validation_total', 'fiapx_processing_total', 'fiapx_jobs_inflight',
  'fiapx_email_delivery_total',
  'rabbitmq_queue_messages',
  'up',
];
const HISTOGRAMS = ['fiapx_http_request_duration_seconds', 'fiapx_processing_duration_seconds', 'fiapx_email_send_duration_seconds'];
const KNOWN_METRICS = new Set([
  ...COUNTERS_AND_GAUGES,
  ...HISTOGRAMS.flatMap((h) => [`${h}_bucket`, `${h}_sum`, `${h}_count`]),
]);
// Label names that would carry personal data or an unbounded id (AD-015).
const PII_LABEL = /owner|email|user|^sub$|request_?id|correlation/i;
const PROMQL_WORDS = new Set(['by', 'without', 'on', 'ignoring', 'group_left', 'group_right', 'bool', 'and', 'or', 'unless', 'offset', 'inf', 'nan']);

// ---------------------------------------------------------------- YAML subset

function stripComment(line) {
  let quote;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function splitFlow(inner, n) {
  const items = [];
  let current = '';
  let quote;
  for (const c of inner) {
    if (quote) {
      current += c;
      if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'") {
      quote = c;
      current += c;
    } else if (c === ',') {
      items.push(current);
      current = '';
    } else if ('[]{}'.includes(c)) {
      throw new Error(`line ${n}: nested flow collections are not supported`);
    } else {
      current += c;
    }
  }
  if (current.trim() !== '') items.push(current);
  return items.map((item) => scalar(item.trim(), n));
}

function scalar(value, n) {
  if (value.startsWith('[')) {
    if (!value.endsWith(']')) throw new Error(`line ${n}: unterminated flow sequence`);
    return splitFlow(value.slice(1, -1), n);
  }
  if (/^["']/.test(value)) {
    if (value.length < 2 || value.at(-1) !== value[0]) throw new Error(`line ${n}: unterminated string`);
    return value.slice(1, -1);
  }
  if (/^[{|>&*!%@`]/.test(value)) throw new Error(`line ${n}: unsupported YAML value "${value}"`);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

const MAP_ENTRY = /^([A-Za-z_][\w.-]*|"[^"]*"|'[^']*'):(?:\s+(.*))?$/;

export function parseYaml(text) {
  const lines = [];
  text.split('\n').forEach((raw, index) => {
    const line = stripComment(raw).replace(/\s+$/, '');
    if (line.trim() === '') return;
    const lead = /^\s*/.exec(line)[0];
    if (lead.includes('\t')) throw new Error(`line ${index + 1}: tab indentation`);
    if (/^(---|\.\.\.)$/.test(line.trim())) throw new Error(`line ${index + 1}: multi-document YAML is not supported`);
    lines.push({ n: index + 1, indent: lead.length, text: line.trim() });
  });
  if (lines.length === 0) return null;
  let i = 0;
  const isItem = (line) => line.text === '-' || line.text.startsWith('- ');

  function block(indent) {
    return isItem(lines[i]) ? sequence(indent) : map(indent);
  }
  function map(indent) {
    const out = {};
    while (i < lines.length && lines[i].indent === indent && !isItem(lines[i])) {
      const { n, text } = lines[i];
      const match = MAP_ENTRY.exec(text);
      if (!match) throw new Error(`line ${n}: expected "key: value", got "${text}"`);
      const key = scalar(match[1], n);
      if (Object.hasOwn(out, key)) throw new Error(`line ${n}: duplicate key "${key}"`);
      i += 1;
      if (match[2] !== undefined && match[2] !== '') {
        out[key] = scalar(match[2], n);
      } else if (i < lines.length && lines[i].indent > indent) {
        out[key] = block(lines[i].indent);
      } else if (i < lines.length && lines[i].indent === indent && isItem(lines[i])) {
        out[key] = sequence(indent);
      } else {
        out[key] = null;
      }
    }
    return out;
  }
  function sequence(indent) {
    const out = [];
    while (i < lines.length && lines[i].indent === indent && isItem(lines[i])) {
      const { n, text } = lines[i];
      const rest = text === '-' ? '' : text.slice(2).trim();
      if (rest === '') {
        i += 1;
        if (i >= lines.length || lines[i].indent <= indent) throw new Error(`line ${n}: empty sequence item`);
        out.push(block(lines[i].indent));
      } else if (MAP_ENTRY.test(rest)) {
        const childIndent = indent + text.indexOf(rest);
        lines[i] = { n, indent: childIndent, text: rest };
        out.push(map(childIndent));
      } else {
        out.push(scalar(rest, n));
        i += 1;
      }
    }
    return out;
  }
  const result = block(lines[0].indent);
  if (i !== lines.length) throw new Error(`line ${lines[i].n}: unexpected indentation`);
  return result;
}

// ---------------------------------------------------------------- PromQL

// The metric names and the label names one expression uses. String literals,
// range and subquery brackets are dropped first; label names are collected
// from selectors and from by/without/on/ignoring clauses; what remains that
// is an identifier not followed by "(" is a metric name.
export function promqlNames(expr) {
  const labels = [];
  let rest = expr.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`/g, '""');
  rest = rest.replace(/\{([^}]*)\}/g, (_, inner) => {
    for (const m of inner.matchAll(/([A-Za-z_]\w*)\s*(?:=~|!~|!=|=)/g)) labels.push(m[1]);
    return ' ';
  });
  rest = rest.replace(/\b(by|without|on|ignoring|group_left|group_right)\s*\(([^)]*)\)/g, (_, _kw, inner) => {
    for (const name of inner.split(',').map((s) => s.trim()).filter(Boolean)) labels.push(name);
    return ' ';
  });
  rest = rest.replace(/\[[^\]]*\]/g, ' ');
  const metrics = [];
  for (const m of rest.matchAll(/[A-Za-z_:][\w:]*/g)) {
    const after = rest.slice(m.index + m[0].length);
    if (/^\s*\(/.test(after)) continue;
    if (PROMQL_WORDS.has(m[0].toLowerCase())) continue;
    if (/^\d/.test(rest.slice(m.index - 1, m.index))) continue;
    metrics.push(m[0]);
  }
  return { metrics, labels };
}

// The names a query template variable uses. Grafana's Prometheus variable
// forms are label_values([selector,] label), query_result(expr) and a bare
// expression; label_values' last argument is a label, not a metric.
export function variableNames(query) {
  const values = /^\s*label_values\s*\((.*)\)\s*$/s.exec(query);
  if (values) {
    const comma = values[1].lastIndexOf(',');
    const label = values[1].slice(comma + 1).trim();
    const selector = comma === -1 ? { metrics: [], labels: [] } : promqlNames(values[1].slice(0, comma));
    return { metrics: selector.metrics, labels: [...selector.labels, label] };
  }
  const result = /^\s*query_result\s*\((.*)\)\s*$/s.exec(query);
  return promqlNames(result ? result[1] : query);
}

// ---------------------------------------------------------------- structure

// A duration in Prometheus's "15s" / "1m" form, in seconds; NaN otherwise.
function seconds(value) {
  const m = /^(\d+)(ms|s|m|h)$/.exec(String(value ?? ''));
  if (!m) return NaN;
  return Number(m[1]) * { ms: 0.001, s: 1, m: 60, h: 3600 }[m[2]];
}

function readYaml(tree, rel, problems) {
  const text = tree.read(rel);
  if (text === undefined) {
    problems.push(`${rel}: missing`);
    return undefined;
  }
  try {
    return parseYaml(text);
  } catch (err) {
    problems.push(`${rel}: ${err.message}`);
    return undefined;
  }
}

function prometheusProblems(tree, problems) {
  const config = readYaml(tree, 'prometheus/prometheus.yml', problems);
  if (!config) return;
  const where = 'prometheus/prometheus.yml';
  if (seconds(config.global?.scrape_interval) !== 15) {
    problems.push(`${where}: global.scrape_interval must be 15s, got ${JSON.stringify(config.global?.scrape_interval)}`);
  }
  if (seconds(config.global?.scrape_timeout) !== 10) {
    problems.push(`${where}: global.scrape_timeout must be 10s, got ${JSON.stringify(config.global?.scrape_timeout)}`);
  }
  const jobs = Array.isArray(config.scrape_configs) ? config.scrape_configs : [];
  const statics = jobs.flatMap((job) => (job.static_configs ?? []).flatMap((c) => c.targets ?? []));
  for (const target of STATIC_TARGETS) {
    if (!statics.includes(target)) problems.push(`${where}: no job scrapes ${target}`);
  }
  if (statics.some((t) => /^worker(:|$)/.test(t))) {
    problems.push(`${where}: the worker must not be a static target; a static target reaches one replica only`);
  }
  const workerSd = jobs.flatMap((job) => job.dns_sd_configs ?? [])
    .find((sd) => Array.isArray(sd.names) && sd.names.includes('worker'));
  if (!workerSd || workerSd.type !== 'A' || workerSd.port !== 3002) {
    problems.push(`${where}: the worker must be discovered by dns_sd_configs {names: [worker], type: A, port: 3002}`);
  }
  for (const job of jobs) {
    for (const key of ['basic_auth', 'authorization', 'bearer_token', 'bearer_token_file', 'oauth2']) {
      if (Object.hasOwn(job, key)) problems.push(`${where}: job ${job.job_name} sets ${key}; /metrics needs no credentials`);
    }
  }
}

function grafanaProvisioningProblems(tree, problems) {
  const ds = readYaml(tree, 'grafana/provisioning/datasources/prometheus.yml', problems);
  if (ds) {
    const list = Array.isArray(ds.datasources) ? ds.datasources : [];
    const prom = list.find((d) => d.uid === DATASOURCE_UID);
    if (!prom || prom.type !== 'prometheus' || prom.url !== 'http://prometheus:9090' || prom.isDefault !== true) {
      problems.push(`grafana/provisioning/datasources/prometheus.yml: needs the default prometheus datasource uid "${DATASOURCE_UID}" at http://prometheus:9090`);
    }
  }
  const dash = readYaml(tree, 'grafana/provisioning/dashboards/dashboards.yml', problems);
  if (dash) {
    const providers = Array.isArray(dash.providers) ? dash.providers : [];
    if (!providers.some((p) => p.type === 'file' && p.options?.path === DASHBOARD_MOUNT)) {
      problems.push(`grafana/provisioning/dashboards/dashboards.yml: needs a file provider with options.path ${DASHBOARD_MOUNT}`);
    }
  }
}

function namesProblems(where, { metrics, labels }, problems) {
  for (const metric of metrics) {
    if (!KNOWN_METRICS.has(metric)) problems.push(`${where}: unknown metric ${metric}`);
  }
  for (const label of labels) {
    if (PII_LABEL.test(label)) problems.push(`${where}: label ${label} may carry personal data or an unbounded id`);
  }
}

function dashboardProblems(tree, problems) {
  const files = tree.list('grafana/dashboards').filter((f) => f.endsWith('.json') && !f.startsWith('._'));
  if (files.length === 0) problems.push('grafana/dashboards: no dashboard JSON');
  const uids = [];
  for (const file of files) {
    const rel = `grafana/dashboards/${file}`;
    let dashboard;
    try {
      dashboard = JSON.parse(tree.read(rel));
    } catch {
      problems.push(`${rel}: not valid JSON`);
      continue;
    }
    if (typeof dashboard.uid !== 'string' || dashboard.uid === '') problems.push(`${rel}: no uid`);
    uids.push(dashboard.uid);
    const panels = (dashboard.panels ?? []).flatMap((p) => [p, ...(p.panels ?? [])]).filter((p) => p.type !== 'row');
    if (panels.length === 0) problems.push(`${rel}: no panels`);
    for (const panel of panels) {
      const name = `${rel} panel "${panel.title}"`;
      if (panel.datasource?.uid !== DATASOURCE_UID) problems.push(`${name}: datasource must be uid "${DATASOURCE_UID}"`);
      const targets = panel.targets ?? [];
      if (targets.length === 0) problems.push(`${name}: no query`);
      for (const target of targets) {
        if (target.datasource && target.datasource.uid !== DATASOURCE_UID) {
          problems.push(`${name} query ${target.refId}: datasource must be uid "${DATASOURCE_UID}"`);
        }
        if (typeof target.expr !== 'string' || target.expr.trim() === '') {
          problems.push(`${name} query ${target.refId}: no expression`);
          continue;
        }
        const { metrics, labels } = promqlNames(target.expr);
        if (metrics.length === 0) problems.push(`${name} query ${target.refId}: references no metric`);
        namesProblems(`${name} query ${target.refId}`, { metrics, labels }, problems);
      }
    }
    // A query variable runs PromQL too: the same metric and label rules hold
    // for its query (a string, or { query } in newer Grafana) and definition.
    for (const variable of dashboard.templating?.list ?? []) {
      if (variable.type !== 'query') continue;
      const query = typeof variable.query === 'string' ? variable.query : variable.query?.query;
      const expressions = new Set([query, variable.definition].filter((e) => typeof e === 'string' && e.trim() !== ''));
      for (const expression of expressions) {
        namesProblems(`${rel} variable "${variable.name}"`, variableNames(expression), problems);
      }
    }
  }
  if (!uids.includes(OVERVIEW_UID)) problems.push(`grafana/dashboards: no dashboard with uid ${OVERVIEW_UID}`);
}

function rabbitmqProblems(tree, problems) {
  const plugins = tree.read('rabbitmq/enabled_plugins');
  if (plugins === undefined) {
    problems.push('rabbitmq/enabled_plugins: missing');
  } else {
    const m = /^\s*\[([^\]]*)\]\.\s*$/.exec(plugins);
    const names = m ? m[1].split(',').map((s) => s.trim()) : [];
    for (const plugin of ['rabbitmq_management', 'rabbitmq_prometheus']) {
      if (!names.includes(plugin)) problems.push(`rabbitmq/enabled_plugins: must list ${plugin}`);
    }
  }
  const conf = tree.read('rabbitmq/rabbitmq.conf') ?? '';
  const settings = new Map(conf.split('\n')
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean)
    .map((l) => l.split('=').map((s) => s.trim())));
  if (settings.get('prometheus.tcp.port') !== '15692') problems.push('rabbitmq/rabbitmq.conf: prometheus.tcp.port must be 15692');
  if (settings.get('prometheus.return_per_object_metrics') !== 'true') {
    problems.push('rabbitmq/rabbitmq.conf: prometheus.return_per_object_metrics must be true, or queue depth has no queue label');
  }
}

function mountedReadOnly(service, source, target) {
  return (service?.volumes ?? []).some((v) => v.type === 'bind' && v.source === source && v.target === target && v.read_only === true);
}

function composeProblems(tree, problems) {
  const services = tree.compose?.services ?? {};
  const root = tree.root;
  for (const name of MONITORING) {
    const svc = services[name];
    if (!svc) {
      problems.push(`compose: no ${name} service`);
      continue;
    }
    if (!svc.image) problems.push(`compose: ${name} has no pinned image`);
    if (!Array.isArray(svc.healthcheck?.test) || svc.healthcheck.test.length === 0 || svc.healthcheck.disable) {
      problems.push(`compose: ${name} has no health check`);
    }
  }
  if (services.prometheus && !mountedReadOnly(services.prometheus, join(root, 'prometheus/prometheus.yml'), '/etc/prometheus/prometheus.yml')) {
    problems.push('compose: prometheus must mount prometheus/prometheus.yml read-only at /etc/prometheus/prometheus.yml');
  }
  if (services.prometheus?.depends_on && Object.keys(services.prometheus.depends_on).length > 0) {
    problems.push(`compose: prometheus must depend on nothing, it depends on ${Object.keys(services.prometheus.depends_on).join(', ')}`);
  }
  if (services.grafana) {
    if (!mountedReadOnly(services.grafana, join(root, 'grafana/provisioning'), PROVISIONING_MOUNT)) {
      problems.push(`compose: grafana must mount grafana/provisioning read-only at ${PROVISIONING_MOUNT}`);
    }
    if (!mountedReadOnly(services.grafana, join(root, 'grafana/dashboards'), DASHBOARD_MOUNT)) {
      problems.push(`compose: grafana must mount grafana/dashboards read-only at ${DASHBOARD_MOUNT}`);
    }
    if (!(services.grafana.ports ?? []).some((p) => String(p.published) === '3005')) problems.push('compose: grafana must publish host port 3005');
  }
  for (const [name, svc] of Object.entries(services)) {
    if (MONITORING.has(name)) continue;
    for (const dep of Object.keys(svc?.depends_on ?? {})) {
      if (MONITORING.has(dep)) problems.push(`compose: business service ${name} depends on ${dep}; the stack must start without monitoring`);
    }
  }
  if (services.rabbitmq && !mountedReadOnly(services.rabbitmq, join(root, 'rabbitmq/enabled_plugins'), '/etc/rabbitmq/enabled_plugins')) {
    problems.push('compose: rabbitmq must mount rabbitmq/enabled_plugins read-only at /etc/rabbitmq/enabled_plugins');
  }
  if (services.worker?.deploy?.replicas !== 1) {
    problems.push(`compose: the worker must run 1 replica when WORKER_REPLICAS is unset, got ${JSON.stringify(services.worker?.deploy?.replicas)}`);
  }
}

export function structuralProblems(tree) {
  const problems = [];
  prometheusProblems(tree, problems);
  grafanaProvisioningProblems(tree, problems);
  dashboardProblems(tree, problems);
  rabbitmqProblems(tree, problems);
  composeProblems(tree, problems);
  return problems;
}

// ---------------------------------------------------------------- live

async function httpGet(url, headers = {}) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    return { status: res.status, text: await res.text() };
  } catch (err) {
    return { status: 0, text: `unreachable (${err.cause?.code ?? err.message})` };
  }
}

// The host ports compose published for each worker replica's 3002.
function workerPortsFromPs(output) {
  const text = output.trim();
  if (text === '') return [];
  const rows = text.startsWith('[') ? JSON.parse(text) : text.split('\n').map((l) => JSON.parse(l));
  return rows.flatMap((row) => (row.Publishers ?? [])
    .filter((p) => p.TargetPort === 3002 && p.PublishedPort > 0)
    .map((p) => p.PublishedPort))
    .filter((port, i, all) => all.indexOf(port) === i);
}

const LIVE_JOBS = ['api', 'catalog', 'worker', 'notification', 'rabbitmq'];

export async function liveProblems({ http = httpGet, workerPs, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), waitMs = 90000, host = 'localhost' }) {
  const problems = [];
  const workerPorts = workerPortsFromPs(workerPs());
  if (workerPorts.length === 0) problems.push('live: no worker replica publishes port 3002 on the host');
  const services = [
    ['api', 3000], ['catalog', 3001], ['notification', 3003],
    ...workerPorts.map((port, i) => [`worker replica ${i + 1}`, port]),
  ];
  for (const [name, port] of services) {
    const metrics = await http(`http://${host}:${port}/metrics`);
    if (metrics.status !== 200 || !/^fiapx_\w+/m.test(metrics.text)) {
      problems.push(`live: ${name} /metrics answered ${metrics.status} without a fiapx_ line`);
    }
    const live = await http(`http://${host}:${port}/health/live`);
    if (live.status !== 200) problems.push(`live: ${name} /health/live answered ${live.status}, expected 200`);
  }
  const broker = await http(`http://${host}:15692/metrics`);
  for (const queue of WORK_QUEUES) {
    if (!new RegExp(`^rabbitmq_queue_messages\\{[^}]*queue="${queue.replace('.', '\\.')}"`, 'm').test(broker.text)) {
      problems.push(`live: the broker's /metrics has no rabbitmq_queue_messages for ${queue}`);
    }
  }

  // Prometheus scrapes every 15 s: wait until every target has been scraped
  // up, or report what is still missing at the deadline.
  const deadline = now() + waitMs;
  let targetProblems;
  for (;;) {
    targetProblems = [];
    const answer = await http(`http://${host}:9090/api/v1/targets?state=active`);
    let targets = [];
    try {
      targets = JSON.parse(answer.text).data.activeTargets;
    } catch {
      targetProblems.push(`live: Prometheus targets answered ${answer.status} with no target list`);
    }
    for (const job of LIVE_JOBS) {
      const ofJob = targets.filter((t) => t.labels?.job === job);
      if (ofJob.length === 0) targetProblems.push(`live: Prometheus has no ${job} target`);
      for (const t of ofJob) {
        if (t.health !== 'up') targetProblems.push(`live: Prometheus target ${job} ${t.labels.instance} is ${t.health}`);
      }
    }
    const workers = targets.filter((t) => t.labels?.job === 'worker').length;
    if (workers !== workerPorts.length) targetProblems.push(`live: Prometheus scrapes ${workers} worker targets, compose runs ${workerPorts.length} replicas`);
    if (targetProblems.length === 0 || now() >= deadline) break;
    await sleep(5000);
  }
  problems.push(...targetProblems);

  const auth = { Authorization: `Basic ${Buffer.from('admin:admin').toString('base64')}` };
  const dashboard = await http(`http://${host}:3005/api/dashboards/uid/${OVERVIEW_UID}`, auth);
  let provisioned = false;
  try {
    provisioned = JSON.parse(dashboard.text).meta?.provisioned === true;
  } catch {
    provisioned = false;
  }
  if (dashboard.status !== 200 || !provisioned) problems.push(`live: Grafana does not serve the provisioned ${OVERVIEW_UID} dashboard (answered ${dashboard.status})`);
  return problems;
}

// ---------------------------------------------------------------- modes

function diskTree(root, composeJson) {
  return {
    root,
    read: (rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : undefined),
    list: (rel) => (existsSync(join(root, rel)) ? readdirSync(join(root, rel)) : []),
    compose: JSON.parse(composeJson),
  };
}

function renderCompose() {
  if (process.env.OBS_COMPOSE_JSON !== undefined) return process.env.OBS_COMPOSE_JSON;
  const env = { ...process.env };
  delete env.WORKER_REPLICAS;
  const run = spawnSync('docker', ['compose', 'config', '--format', 'json'], { cwd: REPO_ROOT, encoding: 'utf8', env });
  if (run.error) fail(`could not run docker: ${run.error.message}`);
  if (run.status !== 0) fail(`docker compose config failed:\n${run.stderr.trim()}`);
  return run.stdout;
}

function fail(message) {
  console.error(`check-observability: ${message}`);
  process.exit(1);
}

function report(problems, okMessage) {
  if (problems.length > 0) {
    for (const problem of problems) console.error(`check-observability: ${problem}`);
    process.exit(1);
  }
  console.log(okMessage);
}

// A copy of the real repository files in memory, with a rendered compose
// shaped like `docker compose config --format json` for the parts checked.
function memoryTree(root) {
  const files = {};
  for (const rel of [
    'prometheus/prometheus.yml',
    'grafana/provisioning/datasources/prometheus.yml',
    'grafana/provisioning/dashboards/dashboards.yml',
    'rabbitmq/enabled_plugins',
    'rabbitmq/rabbitmq.conf',
  ]) files[rel] = readFileSync(join(REPO_ROOT, rel), 'utf8');
  for (const f of readdirSync(join(REPO_ROOT, 'grafana/dashboards')).filter((f) => f.endsWith('.json') && !f.startsWith('._'))) {
    files[`grafana/dashboards/${f}`] = readFileSync(join(REPO_ROOT, 'grafana/dashboards', f), 'utf8');
  }
  const bind = (src, target) => ({ type: 'bind', source: join(root, src), target, read_only: true, bind: {} });
  const compose = {
    services: {
      prometheus: {
        image: 'prom/prometheus:v3.15.0',
        volumes: [bind('prometheus/prometheus.yml', '/etc/prometheus/prometheus.yml')],
        healthcheck: { test: ['CMD', 'wget', '--spider', 'http://localhost:9090/-/healthy'] },
      },
      grafana: {
        image: 'grafana/grafana:13.2.2',
        volumes: [bind('grafana/provisioning', PROVISIONING_MOUNT), bind('grafana/dashboards', DASHBOARD_MOUNT)],
        ports: [{ target: 3005, published: '3005' }],
        depends_on: { prometheus: { condition: 'service_healthy', required: true } },
        healthcheck: { test: ['CMD', 'curl', '-fsS', 'http://localhost:3005/api/health'] },
      },
      rabbitmq: { image: 'rabbitmq:4-management-alpine', volumes: [bind('rabbitmq/enabled_plugins', '/etc/rabbitmq/enabled_plugins')] },
      api: { build: {}, depends_on: { rabbitmq: { condition: 'service_healthy' }, catalog: { condition: 'service_healthy' } } },
      catalog: { build: {}, depends_on: { rabbitmq: { condition: 'service_healthy' } } },
      worker: { build: {}, deploy: { replicas: 1 }, depends_on: { rabbitmq: { condition: 'service_healthy' } } },
      notification: { build: {}, depends_on: { rabbitmq: { condition: 'service_healthy' } } },
    },
  };
  return {
    root,
    files,
    compose,
    read(rel) { return this.files[rel]; },
    list(rel) { return Object.keys(this.files).filter((k) => k.startsWith(`${rel}/`)).map((k) => k.slice(rel.length + 1)); },
  };
}

async function selfTest() {
  const failures = [];
  let rejected = 0;
  const root = '/repo';
  const expectProblems = (name, mutate, expected) => {
    const tree = memoryTree(root);
    mutate(tree);
    const got = structuralProblems(tree);
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      failures.push(`${name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
    } else if (expected.length > 0) {
      rejected += 1;
    }
  };
  const edit = (rel, from, to) => (tree) => {
    if (!tree.files[rel].includes(from)) throw new Error(`self-test fixture: "${from}" not in ${rel}`);
    tree.files[rel] = tree.files[rel].replace(from, to);
  };
  const overview = 'grafana/dashboards/overview.json';
  const editDashboard = (fn) => (tree) => {
    const d = JSON.parse(tree.files[overview]);
    fn(d);
    tree.files[overview] = JSON.stringify(d);
  };
  const panelTitled = (d, title) => d.panels.find((p) => p.title === title);

  // The real repository is the good case every rejection is measured against.
  expectProblems('the repository as committed', () => {}, []);

  // Prometheus.
  expectProblems('catalog target dropped', edit('prometheus/prometheus.yml', "['catalog:3001']", "['catalogue:3001']"),
    ['prometheus/prometheus.yml: no job scrapes catalog:3001']);
  expectProblems('worker as a static target', edit('prometheus/prometheus.yml',
    "    dns_sd_configs:\n      - names: ['worker']\n        type: A\n        port: 3002\n        refresh_interval: 15s",
    "    static_configs:\n      - targets: ['worker:3002']"),
  ['prometheus/prometheus.yml: the worker must not be a static target; a static target reaches one replica only',
    'prometheus/prometheus.yml: the worker must be discovered by dns_sd_configs {names: [worker], type: A, port: 3002}']);
  expectProblems('worker SRV lookup', edit('prometheus/prometheus.yml', 'type: A', 'type: SRV'),
    ['prometheus/prometheus.yml: the worker must be discovered by dns_sd_configs {names: [worker], type: A, port: 3002}']);
  expectProblems('scrape interval 1m', edit('prometheus/prometheus.yml', 'scrape_interval: 15s', 'scrape_interval: 1m'),
    ['prometheus/prometheus.yml: global.scrape_interval must be 15s, got "1m"']);
  expectProblems('scrape timeout 15s', edit('prometheus/prometheus.yml', 'scrape_timeout: 10s', 'scrape_timeout: 15s'),
    ['prometheus/prometheus.yml: global.scrape_timeout must be 10s, got "15s"']);
  expectProblems('credentials on a job', edit('prometheus/prometheus.yml', '  - job_name: api\n', '  - job_name: api\n    basic_auth:\n      username: x\n'),
    ['prometheus/prometheus.yml: job api sets basic_auth; /metrics needs no credentials']);
  expectProblems('unsupported YAML', edit('prometheus/prometheus.yml', 'global:', 'global: &g'),
    ['prometheus/prometheus.yml: line 8: unsupported YAML value "&g"']);

  // Grafana provisioning.
  expectProblems('datasource uid renamed', edit('grafana/provisioning/datasources/prometheus.yml', 'uid: prometheus', 'uid: prom'),
    ['grafana/provisioning/datasources/prometheus.yml: needs the default prometheus datasource uid "prometheus" at http://prometheus:9090']);
  expectProblems('provider path not mounted', edit('grafana/provisioning/dashboards/dashboards.yml', 'path: /var/lib/grafana/dashboards', 'path: /var/lib/grafana/dash'),
    ['grafana/provisioning/dashboards/dashboards.yml: needs a file provider with options.path /var/lib/grafana/dashboards']);

  // Dashboards.
  expectProblems('dashboard JSON corrupted', (tree) => { tree.files[overview] = tree.files[overview].slice(0, -3); },
    ['grafana/dashboards/overview.json: not valid JSON', 'grafana/dashboards: no dashboard with uid fiapx-overview']);
  expectProblems('panel on another datasource', editDashboard((d) => { panelTitled(d, 'Queue depth').datasource.uid = 'other'; }),
    ['grafana/dashboards/overview.json panel "Queue depth": datasource must be uid "prometheus"']);
  expectProblems('query on another datasource', editDashboard((d) => { panelTitled(d, 'Queue depth').targets[0].datasource = { uid: 'prometheusx' }; }),
    ['grafana/dashboards/overview.json panel "Queue depth" query A: datasource must be uid "prometheus"']);
  expectProblems('unknown metric (near miss)', editDashboard((d) => {
    const t = panelTitled(d, 'Processing and validation throughput').targets[0];
    t.expr = t.expr.replace('fiapx_processing_total', 'fiapx_processing_totals');
  }), ['grafana/dashboards/overview.json panel "Processing and validation throughput" query A: unknown metric fiapx_processing_totals']);
  expectProblems('node default metric', editDashboard((d) => { panelTitled(d, 'Target health').targets[0].expr = 'fiapx_node_heap_size_used_bytes'; }),
    ['grafana/dashboards/overview.json panel "Target health" query A: unknown metric fiapx_node_heap_size_used_bytes']);
  expectProblems('personal-data label', editDashboard((d) => { panelTitled(d, 'Uploads by outcome').targets[0].expr = 'sum by (owner_user_id) (fiapx_uploads_total)'; }),
    ['grafana/dashboards/overview.json panel "Uploads by outcome" query A: label owner_user_id may carry personal data or an unbounded id']);
  expectProblems('request id selector', editDashboard((d) => { panelTitled(d, 'Uploads by outcome').targets[0].expr = 'fiapx_uploads_total{processingRequestId="x"}'; }),
    ['grafana/dashboards/overview.json panel "Uploads by outcome" query A: label processingRequestId may carry personal data or an unbounded id']);
  expectProblems('overview uid changed', editDashboard((d) => { d.uid = 'fiapx-overview-2'; }),
    ['grafana/dashboards: no dashboard with uid fiapx-overview']);
  const variable = (query, definition = query) => ({
    name: 'v', type: 'query', datasource: { uid: DATASOURCE_UID }, query: { query, refId: 'PrometheusVariableQueryEditor-VariableQuery' }, definition,
  });
  expectProblems('M9: a template variable listing owner emails', editDashboard((d) => {
    d.templating.list.push(variable('label_values(fiapx_uploads_total, owner_email)'));
  }), ['grafana/dashboards/overview.json variable "v": label owner_email may carry personal data or an unbounded id']);
  expectProblems('a template variable on an unknown metric (near miss)', editDashboard((d) => {
    d.templating.list.push({ ...variable('label_values(fiapx_upload_total, outcome)'), query: 'label_values(fiapx_upload_total, outcome)' });
  }), ['grafana/dashboards/overview.json variable "v": unknown metric fiapx_upload_total']);
  expectProblems('a template variable whose definition selects by request id', editDashboard((d) => {
    d.templating.list.push(variable('label_values(outcome)', 'query_result(fiapx_uploads_total{request_id="x"})'));
  }), ['grafana/dashboards/overview.json variable "v": label request_id may carry personal data or an unbounded id']);
  expectProblems('a template variable listing replicas (good)', editDashboard((d) => {
    d.templating.list.push(variable('label_values(fiapx_processing_total, instance)'), { name: 'c', type: 'custom', query: 'owner,email' });
  }), []);

  // RabbitMQ.
  expectProblems('management plugin dropped', edit('rabbitmq/enabled_plugins', 'rabbitmq_management,', ''),
    ['rabbitmq/enabled_plugins: must list rabbitmq_management']);
  expectProblems('prometheus plugin dropped', edit('rabbitmq/enabled_plugins', ',rabbitmq_prometheus', ''),
    ['rabbitmq/enabled_plugins: must list rabbitmq_prometheus']);
  expectProblems('per-object metrics off', edit('rabbitmq/rabbitmq.conf', 'prometheus.return_per_object_metrics = true', 'prometheus.return_per_object_metrics = false'),
    ['rabbitmq/rabbitmq.conf: prometheus.return_per_object_metrics must be true, or queue depth has no queue label']);
  expectProblems('metrics port moved', edit('rabbitmq/rabbitmq.conf', 'prometheus.tcp.port = 15692', 'prometheus.tcp.port = 15693'),
    ['rabbitmq/rabbitmq.conf: prometheus.tcp.port must be 15692']);

  // Compose.
  expectProblems('business service depends on prometheus', (tree) => { tree.compose.services.api.depends_on.prometheus = { condition: 'service_started' }; },
    ['compose: business service api depends on prometheus; the stack must start without monitoring']);
  expectProblems('business service depends on grafana', (tree) => { tree.compose.services.worker.depends_on.grafana = { condition: 'service_healthy' }; },
    ['compose: business service worker depends on grafana; the stack must start without monitoring']);
  expectProblems('prometheus waits for the stack', (tree) => { tree.compose.services.prometheus.depends_on = { api: { condition: 'service_healthy' } }; },
    ['compose: prometheus must depend on nothing, it depends on api']);
  expectProblems('grafana without a health check', (tree) => { delete tree.compose.services.grafana.healthcheck; },
    ['compose: grafana has no health check']);
  expectProblems('prometheus config writable', (tree) => { tree.compose.services.prometheus.volumes[0].read_only = false; },
    ['compose: prometheus must mount prometheus/prometheus.yml read-only at /etc/prometheus/prometheus.yml']);
  expectProblems('dashboards not mounted', (tree) => { tree.compose.services.grafana.volumes.pop(); },
    ['compose: grafana must mount grafana/dashboards read-only at /var/lib/grafana/dashboards']);
  expectProblems('no prometheus service', (tree) => { delete tree.compose.services.prometheus; },
    ['compose: no prometheus service']);
  expectProblems('enabled_plugins not mounted', (tree) => { tree.compose.services.rabbitmq.volumes = []; },
    ['compose: rabbitmq must mount rabbitmq/enabled_plugins read-only at /etc/rabbitmq/enabled_plugins']);
  expectProblems('worker default 2 replicas', (tree) => { tree.compose.services.worker.deploy.replicas = 2; },
    ['compose: the worker must run 1 replica when WORKER_REPLICAS is unset, got 2']);

  // --live, with injected answers: a healthy stack, then one fault at a time.
  const healthy = {
    'http://h:3000/metrics': 'fiapx_uploads_total{outcome="accepted"} 0',
    'http://h:3001/metrics': 'fiapx_outbox_pending_rows 0',
    'http://h:3003/metrics': 'fiapx_email_delivery_total{outcome="sent"} 0',
    'http://h:3011/metrics': 'fiapx_processing_total{outcome="completed"} 0',
    'http://h:3012/metrics': 'fiapx_processing_total{outcome="completed"} 0',
    'http://h:15692/metrics': WORK_QUEUES.map((q) => `rabbitmq_queue_messages{vhost="/",queue="${q}"} 0`).join('\n'),
    'http://h:9090/api/v1/targets?state=active': JSON.stringify({ data: { activeTargets: [
      ...['api', 'catalog', 'notification', 'rabbitmq'].map((job) => ({ labels: { job, instance: `${job}:1` }, health: 'up' })),
      { labels: { job: 'worker', instance: '10.0.0.5:3002' }, health: 'up' },
      { labels: { job: 'worker', instance: '10.0.0.6:3002' }, health: 'up' },
    ] } }),
    'http://h:3005/api/dashboards/uid/fiapx-overview': JSON.stringify({ meta: { provisioned: true } }),
  };
  const ps = JSON.stringify([
    { Service: 'worker', Publishers: [{ TargetPort: 3002, PublishedPort: 3011 }] },
    { Service: 'worker', Publishers: [{ TargetPort: 3002, PublishedPort: 3012 }] },
  ]);
  const runLive = async (overrides = {}, workerPs = ps) => {
    const answers = { ...healthy, ...overrides };
    let t = 0;
    return liveProblems({
      host: 'h',
      workerPs: () => workerPs,
      now: () => t,
      sleep: async (ms) => { t += ms; },
      waitMs: 10000,
      http: async (url) => {
        if (url.endsWith('/health/live')) return { status: overrides[url]?.status ?? 200, text: '' };
        const answer = answers[url];
        if (answer === undefined) return { status: 0, text: 'unreachable' };
        return typeof answer === 'object' ? answer : { status: 200, text: answer };
      },
    });
  };
  const expectLive = async (name, overrides, expected, workerPs) => {
    const got = await runLive(overrides, workerPs);
    if (JSON.stringify(got) !== JSON.stringify(expected)) failures.push(`${name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
    else if (expected.length > 0) rejected += 1;
  };
  await expectLive('live: healthy stack', {}, []);
  await expectLive('live: /metrics without a fiapx_ line', { 'http://h:3001/metrics': 'process_cpu_seconds_total 1\n# fiapx_ in a comment' },
    ['live: catalog /metrics answered 200 without a fiapx_ line']);
  await expectLive('live: a replica not live', { 'http://h:3012/health/live': { status: 503 } },
    ['live: worker replica 2 /health/live answered 503, expected 200']);
  await expectLive('live: aggregated queue metrics', { 'http://h:15692/metrics': 'rabbitmq_queue_messages 0' },
    WORK_QUEUES.map((q) => `live: the broker's /metrics has no rabbitmq_queue_messages for ${q}`));
  const oneWorkerDown = JSON.parse(healthy['http://h:9090/api/v1/targets?state=active']);
  oneWorkerDown.data.activeTargets[5].health = 'down';
  await expectLive('live: a worker target down', { 'http://h:9090/api/v1/targets?state=active': JSON.stringify(oneWorkerDown) },
    ['live: Prometheus target worker 10.0.0.6:3002 is down']);
  const oneWorkerScraped = JSON.parse(healthy['http://h:9090/api/v1/targets?state=active']);
  oneWorkerScraped.data.activeTargets.pop();
  await expectLive('live: fewer worker targets than replicas', { 'http://h:9090/api/v1/targets?state=active': JSON.stringify(oneWorkerScraped) },
    ['live: Prometheus scrapes 1 worker targets, compose runs 2 replicas']);
  await expectLive('live: dashboard not provisioned', { 'http://h:3005/api/dashboards/uid/fiapx-overview': JSON.stringify({ meta: { provisioned: false } }) },
    ['live: Grafana does not serve the provisioned fiapx-overview dashboard (answered 200)']);

  // The load test's own self-test is part of this gate's composition.
  const load = spawnSync(process.execPath, [join(dirname(SELF), 'load-test.mjs'), '--self-test'], { encoding: 'utf8' });
  if (load.status !== 0 || !/^load-test self-test passed: \d+ assertions/m.test(load.stdout)) {
    failures.push(`load-test --self-test exited ${load.status}: ${load.stderr.trim()}`);
  }

  // The script itself, against a copy of the repository whose dashboard is
  // corrupted, must exit non-zero with the message on stderr.
  const scratch = mkdtempSync(join(tmpdir(), 'check-observability-'));
  try {
    const good = memoryTree(scratch);
    for (const [rel, content] of Object.entries(good.files)) {
      mkdirSync(dirname(join(scratch, rel)), { recursive: true });
      writeFileSync(join(scratch, rel), rel === overview ? content.slice(0, -3) : content);
    }
    const spawned = spawnSync(process.execPath, [SELF], {
      encoding: 'utf8',
      env: { ...process.env, OBS_ROOT: scratch, OBS_COMPOSE_JSON: JSON.stringify(good.compose) },
    });
    const expected = 'check-observability: grafana/dashboards/overview.json: not valid JSON\ncheck-observability: grafana/dashboards: no dashboard with uid fiapx-overview\n';
    if (spawned.status === 0) failures.push('spawned run with a corrupted dashboard exited 0, expected non-zero');
    if (spawned.stderr !== expected) failures.push(`spawned run printed ${JSON.stringify(spawned.stderr)}, expected ${JSON.stringify(expected)}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`check-observability self-test failed: ${failure}`);
    process.exit(1);
  }
  console.log(`check-observability self-test passed: ${rejected} corruptions rejected with the exact message, the committed tree and a healthy live stack accepted, load-test self-test passed, spawned failure exited non-zero`);
}

if (process.argv.includes('--self-test')) {
  await selfTest();
} else if (process.argv.includes('--live')) {
  const ps = () => {
    const run = spawnSync('docker', ['compose', 'ps', '--format', 'json', 'worker'], { cwd: REPO_ROOT, encoding: 'utf8' });
    if (run.status !== 0) fail(`docker compose ps failed:\n${(run.stderr ?? '').trim()}`);
    return run.stdout;
  };
  report(await liveProblems({ workerPs: ps }), 'check-observability --live: every service serves fiapx_ metrics and /health/live, the broker serves per-queue depth, every Prometheus target is up, Grafana serves the overview dashboard');
} else {
  report(structuralProblems(diskTree(REPO_ROOT, renderCompose())), 'check-observability: prometheus, grafana, the dashboards, the broker plugin and the compose wiring match the observability invariants');
}
