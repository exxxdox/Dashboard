import { describe, expect, test } from 'vitest';

import {
  assertSafeRelative,
  isInside,
  joinRoot,
  normalizePosix,
  relativeDir,
} from './paths.js';

describe('normalizePosix', () => {
  test('collapses redundant separators and dot segments', () => {
    expect(normalizePosix('/srv//scripts/./api.sh')).toBe('/srv/scripts/api.sh');
    expect(normalizePosix('a/b/../c')).toBe('a/c');
  });

  test('does not walk above an absolute root', () => {
    expect(normalizePosix('/srv/../../etc/passwd')).toBe('/etc/passwd');
  });

  test('preserves leading traversal in a relative path so callers can detect it', () => {
    expect(normalizePosix('../../etc')).toBe('../../etc');
  });

  test('reduces an empty relative path to the current directory', () => {
    expect(normalizePosix('')).toBe('.');
  });
});

describe('assertSafeRelative', () => {
  test('passes through an ordinary relative path', () => {
    expect(assertSafeRelative('deploy/api.sh')).toBe('deploy/api.sh');
  });

  test('treats the root itself as the empty string', () => {
    expect(assertSafeRelative('.')).toBe('');
  });

  test('rejects a path that escapes its root', () => {
    expect(() => assertSafeRelative('../secrets')).toThrow(/escapes its root/);
    expect(() => assertSafeRelative('deploy/../../secrets')).toThrow(/escapes its root/);
  });

  test('rejects an absolute path', () => {
    expect(() => assertSafeRelative('/etc/passwd')).toThrow(/absolute/);
  });

  test('rejects a backslash rather than translating it', () => {
    // On a Linux target a backslash is a legal filename character, so
    // translating it would address a different file than the caller named.
    expect(() => assertSafeRelative('deploy\\api.sh')).toThrow(/backslash/);
  });

  test('rejects a NUL byte', () => {
    expect(() => assertSafeRelative('a\0b')).toThrow(/NUL/);
  });
});

describe('joinRoot', () => {
  test('joins a relative path onto a root', () => {
    expect(joinRoot('/workspace', 'repos/acme/api.sh')).toBe('/workspace/repos/acme/api.sh');
  });

  test('returns the root for an empty relative path', () => {
    expect(joinRoot('/workspace/', '')).toBe('/workspace');
  });

  test('refuses to join a path that escapes', () => {
    expect(() => joinRoot('/workspace', '../etc')).toThrow(/escapes its root/);
  });
});

describe('isInside', () => {
  test('accepts the root itself and anything beneath it', () => {
    expect(isInside('/workspace', '/workspace')).toBe(true);
    expect(isInside('/workspace', '/workspace/a/b')).toBe(true);
  });

  test('rejects a sibling that merely shares a prefix', () => {
    // The classic bug: plain string prefix matching would accept /workspace-other.
    expect(isInside('/workspace', '/workspace-other/api.sh')).toBe(false);
  });

  test('rejects a path outside entirely', () => {
    expect(isInside('/workspace', '/etc/passwd')).toBe(false);
  });
});

describe('relativeDir', () => {
  test('splits a root-relative path', () => {
    expect(relativeDir('deploy/api.sh')).toBe('deploy');
    expect(relativeDir('api.sh')).toBe('');
  });
});
