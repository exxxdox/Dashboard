/**
 * Strip build-only weight out of an installed dependency tree, for the runtime
 * image.
 *
 * Everything here is dead at runtime *for this project*, and only for this
 * project, so it lives in a reviewed script rather than in an opaque Dockerfile
 * one-liner:
 *
 *   - `better-sqlite3` ships a prebuilt binary for every platform it supports.
 *     The container only ever loads the one matching its own platform and arch,
 *     so the other seven are ~15 MB of never-executed code.
 *   - Its `deps/` directory is the SQLite amalgamation that node-gyp compiles
 *     against. `allowBuilds` in pnpm-workspace.yaml keeps that build switched
 *     off and the shipped prebuild is what gets loaded, so those sources are
 *     never read.
 *   - A handful of whole directories in other packages are equally dead, for
 *     the reasons recorded beside `DEAD_PATHS` below.
 *
 * Deliberately narrow: it touches known-safe paths inside named packages
 * instead of pruning by pattern across the whole tree, where a wrong guess
 * becomes a runtime "cannot find module" that only shows up on first use. The
 * patterns it does apply -- `*.map`, `*.d.ts`, `*.md`, a package's own tests --
 * are inert by definition rather than by an argument about any one package: no
 * `require` or `import` can resolve to any of them.
 *
 * Usage: node scripts/prune-runtime-deps.mjs [root]   (default: .)
 */

import { readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PACKAGE = 'better-sqlite3';

/**
 * The prebuild `better-sqlite3` will load, named the way it names them: a musl
 * system reports no glibc version, and its binaries are `linuxmusl-*`. Reading
 * the same signal the package reads is what stops an alpine install from
 * keeping the glibc binary -- which loads nowhere and fails on the first query.
 */
function runtimeTarget() {
  const onMusl =
    process.platform === 'linux' &&
    !process.report?.getReport()?.header?.glibcVersionRuntime;
  return `${onMusl ? 'linuxmusl' : process.platform}-${process.arch}`;
}

const keep = runtimeTarget();

/**
 * Directories that are unreachable, or reachable only through a `require` that
 * is already written to fail, keyed by package name. `.` means the whole
 * package.
 *
 *   - `zod/src` is exported only under the `@zod/source` condition, which Node
 *     never selects; both `import` and `require` resolve to the compiled files
 *     sitting beside it. `zod/v3` is the previous major's compat entry point,
 *     reachable only by importing that subpath, which nothing in the built
 *     server, the shared package or the client does.
 *   - `cpu-features` is an *optional* dependency of ssh2, read inside a bare
 *     `try {} catch {}`. Removing it is the same outcome as a build that never
 *     produced it, which ssh2 answers by falling back to pure JS -- and that is
 *     what `allowBuilds` in pnpm-workspace.yaml already relies on.
 *   - `nan` and `node-addon-api` are reachable only from `cpu-features`, which
 *     needed them in order to compile. Nothing else in the tree depends on them.
 */
const DEAD_PATHS = new Map([
  ['zod', ['src', 'v3']],
  ['cpu-features', ['.']],
  ['nan', ['.']],
  ['node-addon-api', ['.']],
]);

/** Every `node_modules/<name>` directory for `names` under `root`, pnpm layout included. */
function findInstalls(directory, names, found = [], depth = 0) {
  if (depth > 12) return found;

  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    // Symlinks are skipped: following them would visit the same install twice.
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);

    if (names.has(entry.name)) {
      found.push(path);
      continue;
    }
    const isVersioned = [...names].some((name) => entry.name.startsWith(`${name}@`));
    if (entry.name === 'node_modules' || entry.name === '.pnpm' || isVersioned) {
      findInstalls(path, names, found, depth + 1);
    }
  }

  return found;
}

function sizeOf(path) {
  const info = statSync(path, { throwIfNoEntry: false });
  if (!info) return 0;
  if (!info.isDirectory()) return info.size;
  return readdirSync(path, { withFileTypes: true }).reduce(
    (total, entry) => total + sizeOf(join(path, entry.name)),
    0,
  );
}

/** Names of directories that hold a package's own tests and fixtures. */
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'test-fixtures']);

/**
 * Kept deliberately: the image redistributes every one of these packages, and
 * an MIT or BSD licence travels with the copy that contains it. Deleting them
 * would be a licence violation for a rounding error's worth of bytes.
 */
const LICENCE = /^(licen[cs]e|copying|notice|copyright|authors|contributors)/i;

/**
 * Files that no `require` or `import` can ever resolve, so removing them cannot
 * produce a "cannot find module":
 *
 *   - `*.map`, read only under `--enable-source-maps`, which the server does
 *     not start with.
 *   - `*.d.ts` and friends, which exist for a typechecker and are not modules.
 *   - `*.md` and a package's own tests, which nothing loads at runtime.
 *
 * This is the one place the script works by pattern across the whole tree
 * rather than by name, and it can, because the property being relied on is
 * about what Node's resolver does rather than about any particular package.
 */
function isInert(name) {
  if (LICENCE.test(name)) return false;
  return (
    name.endsWith('.map') ||
    /\.d\.(ts|cts|mts)$/.test(name) ||
    /\.md$/i.test(name) ||
    /\.(test|spec)\.[cm]?js$/.test(name)
  );
}

/** Removes everything `isInert` matches, plus whole test directories. */
function removeInertFiles(directory, depth = 0) {
  if (depth > 12) return;

  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (TEST_DIRS.has(entry.name)) {
        freed += sizeOf(path);
        rmSync(path, { recursive: true, force: true });
        continue;
      }
      removeInertFiles(path, depth + 1);
    } else if (isInert(entry.name)) {
      freed += sizeOf(path);
      rmSync(path, { force: true });
    }
  }
}

const root = resolve(process.argv[2] ?? '.');
const installs = findInstalls(root, new Set([PACKAGE]));

if (installs.length === 0) {
  console.error(`prune-runtime-deps: no ${PACKAGE} install found under ${root}`);
  process.exit(1);
}

let freed = 0;

for (const install of installs) {
  const prebuilds = join(install, 'prebuilds');

  // Fail before deleting anything if the binary this container needs is absent:
  // a silent prune would produce an image that only breaks on first query.
  if (!statSync(join(prebuilds, `${keep}.node`), { throwIfNoEntry: false })) {
    console.error(`prune-runtime-deps: ${install} has no ${keep} prebuild to keep`);
    process.exit(1);
  }

  for (const entry of readdirSync(prebuilds, { withFileTypes: true })) {
    if (entry.name === `${keep}.node`) continue;
    const path = join(prebuilds, entry.name);
    freed += sizeOf(path);
    rmSync(path, { recursive: true, force: true });
  }

  for (const name of ['deps', 'src']) {
    const path = join(install, name);
    if (!statSync(path, { throwIfNoEntry: false })) continue;
    freed += sizeOf(path);
    rmSync(path, { recursive: true, force: true });
  }
}

for (const [name, subpaths] of DEAD_PATHS) {
  for (const install of findInstalls(root, new Set([name]))) {
    for (const subpath of subpaths) {
      const path = subpath === '.' ? install : join(install, subpath);
      if (!statSync(path, { throwIfNoEntry: false })) continue;
      freed += sizeOf(path);
      rmSync(path, { recursive: true, force: true });
    }
  }
}

removeInertFiles(join(root, 'node_modules'));

console.log(`prune-runtime-deps: freed ${(freed / 1024 / 1024).toFixed(1)} MB (kept ${keep})`);
