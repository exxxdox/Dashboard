/**
 * Path handling inside the shared script root.
 *
 * Everything the server reads or writes on the container side goes through
 * here, so a relative path from the database or a request can never escape the
 * shared root and reach the rest of the filesystem.
 *
 * Only POSIX semantics are implemented: the container is Linux and so is every
 * target, so Windows path rules would add ambiguity for nothing.
 */

/**
 * Collapse `.` and `..` segments and duplicate slashes without touching the
 * filesystem. Leading `..` in a relative path is preserved, so callers can
 * detect that the result escaped its origin.
 */
export function normalizePosix(input: string): string {
  const isAbsolute = input.startsWith('/');
  const output: string[] = [];

  for (const segment of input.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      const last = output[output.length - 1];
      if (last !== undefined && last !== '..') output.pop();
      else if (!isAbsolute) output.push('..');
      // For an absolute path, ".." above the root is dropped, as POSIX requires.
      continue;
    }
    output.push(segment);
  }

  const joined = output.join('/');
  if (isAbsolute) return `/${joined}`;
  return joined === '' ? '.' : joined;
}

/**
 * Validate a path that is meant to be relative to a root, and return it
 * normalised.
 *
 * Backslashes are rejected outright rather than translated: on a Linux target a
 * backslash is a legal filename character, so silently converting it would let
 * a request address a different file than the one the user named.
 */
export function assertSafeRelative(relative: string): string {
  if (relative.includes('\0')) {
    throw new Error('Path contains a NUL byte');
  }
  if (relative.includes('\\')) {
    throw new Error('Path contains a backslash; use forward slashes');
  }
  if (relative.startsWith('/')) {
    throw new Error('Expected a relative path, received an absolute one');
  }

  const normalized = normalizePosix(relative);
  if (normalized === '.') return '';
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Path escapes its root: ${JSON.stringify(relative)}`);
  }
  return normalized;
}

/** Join a validated relative path onto an absolute root. */
export function joinRoot(root: string, relative: string): string {
  const base = normalizePosix(root);
  const rel = assertSafeRelative(relative);
  if (rel === '') return base;
  return base === '/' ? `/${rel}` : `${base}/${rel}`;
}

/** True when `candidate` is `root` itself or lives underneath it. */
export function isInside(root: string, candidate: string): boolean {
  const base = normalizePosix(root);
  const target = normalizePosix(candidate);
  if (target === base) return true;
  return target.startsWith(base === '/' ? '/' : `${base}/`);
}

/** Directory part of a root-relative path; '' when the file sits at the root. */
export function relativeDir(relativePath: string): string {
  const normalized = assertSafeRelative(relativePath);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? '' : normalized.slice(0, index);
}

