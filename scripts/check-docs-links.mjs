// Fails when a relative link in the documentation does not resolve (the
// `docs-links` required check, GRD-02).
//
// Scans README.md and every docs/**/*.md under DOCS_ROOT (default: the
// repository root). Each markdown link `[text](target)` whose target is not
// http:, https:, mailto: or an anchor (#...) is resolved relative to the file
// that holds it, after dropping any `#fragment`. Prints each unresolved link as
// `<file>: [text](target)`, then `N unresolved link(s)`, and exits 1 when N > 0.
//
// `--self-test` needs nothing external: it writes a broken and a good tree into
// a temporary directory, requires the exact report and exit code for each, and
// spawns this script with DOCS_ROOT on the broken tree, which must exit 1.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(SELF), '..');
const DOCS_ROOT = process.env.DOCS_ROOT ? resolve(process.env.DOCS_ROOT) : REPO_ROOT;

const LINK = /\[([^\]]*)\]\(([^)]+)\)/g;
const SKIPPED = /^(https?:|mailto:|#)/;

// Every .md file under `dir`, recursively, as paths relative to `root`.
function markdownUnder(root, dir) {
  if (!existsSync(join(root, dir))) return [];
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return markdownUnder(root, path);
    return entry.name.endsWith('.md') ? [path] : [];
  });
}

const byComponents = (a, b) => {
  const [x, y] = [a.split('/'), b.split('/')];
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return x.length - y.length;
};

// Every unresolved relative link under `root`, as `<file>: [text](target)`, in
// file order and then in the order each file shows them.
export function unresolvedLinks(root) {
  const files = ['README.md', ...markdownUnder(root, 'docs').sort(byComponents)];
  const missing = [];
  for (const file of files) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    for (const [, text, target] of readFileSync(path, 'utf8').matchAll(LINK)) {
      if (SKIPPED.test(target)) continue;
      const withoutFragment = target.split('#')[0].trim();
      if (withoutFragment !== '' && !existsSync(resolve(dirname(path), withoutFragment))) {
        missing.push(`${relative(root, path)}: [${text}](${target})`);
      }
    }
  }
  return missing;
}

export function report(missing) {
  return [missing.length > 0 ? missing.join('\n') : 'all relative links resolve', `${missing.length} unresolved link(s)`].join('\n');
}


function main() {
  const missing = unresolvedLinks(DOCS_ROOT);
  console.log(report(missing));
  if (missing.length > 0) process.exitCode = 1;
}

// Writes `files` ({ relative path: content }) under a new directory in `dir`.
function tree(dir, name, files) {
  const root = join(dir, name);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function selfTest() {
  const failures = [];
  const dir = mkdtempSync(join(tmpdir(), 'check-docs-links-'));
  try {
    // Broken: a missing file, a missing file behind an anchor, and a link from
    // docs/ that exists only relative to the root, not to the file (near-miss).
    const broken = tree(dir, 'broken', {
      'README.md': '# Readme\n\n[x](nope.md) and [ok](docs/guide.md#usage)\n',
      'docs/guide.md': '[home](README.md) [gone](missing.md#part)\n',
    });
    const brokenReport = [
      'README.md: [x](nope.md)',
      'docs/guide.md: [home](README.md)',
      'docs/guide.md: [gone](missing.md#part)',
      '3 unresolved link(s)',
    ].join('\n');
    // Good: external and anchor targets are skipped; a nested file resolves
    // its link relative to itself; an anchor on an existing file resolves.
    const good = tree(dir, 'good', {
      'README.md': '[site](https://example.com) [plain](http://example.com) [mail](mailto:a@b.c) [top](#top) [guide](docs/guide.md#usage)\n',
      'docs/guide.md': '[deep](nested/deep.md)\n',
      'docs/nested/deep.md': '[home](../../README.md)\n',
    });
    const goodReport = 'all relative links resolve\n0 unresolved link(s)';

    const brokenMissing = unresolvedLinks(broken);
    if (report(brokenMissing) !== brokenReport || brokenMissing.length === 0) {
      failures.push(`a broken tree reported ${JSON.stringify(report(brokenMissing))} with ${brokenMissing.length} missing, expected ${JSON.stringify(brokenReport)} and exit 1`);
    }
    const goodMissing = unresolvedLinks(good);
    if (report(goodMissing) !== goodReport || goodMissing.length !== 0) {
      failures.push(`a good tree reported ${JSON.stringify(report(goodMissing))}, expected ${JSON.stringify(goodReport)} and exit 0`);
    }

    // The script itself: exit 1 on the broken tree, exit 0 on the good one.
    const spawn = (root) => spawnSync(process.execPath, [SELF], { encoding: 'utf8', env: { ...process.env, DOCS_ROOT: root } });
    const spawnedBroken = spawn(broken);
    if (spawnedBroken.status !== 1 || spawnedBroken.stdout !== `${brokenReport}\n`) {
      failures.push(`spawned on a broken tree it exited ${spawnedBroken.status} printing ${JSON.stringify(spawnedBroken.stdout)}, expected 1 printing ${JSON.stringify(`${brokenReport}\n`)}`);
    }
    const spawnedGood = spawn(good);
    if (spawnedGood.status !== 0 || spawnedGood.stdout !== `${goodReport}\n`) {
      failures.push(`spawned on a good tree it exited ${spawnedGood.status} printing ${JSON.stringify(spawnedGood.stdout)}, expected 0`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`check-docs-links self-test failed: ${failure}`);
    process.exit(1);
  }
  console.log('check-docs-links self-test passed: a broken tree reported 3 unresolved links and exit 1, a good tree 0 and exit 0, spawned broken run exited 1, spawned good run exited 0');
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(SELF)) {
  if (process.argv.includes('--self-test')) selfTest();
  else main();
}
