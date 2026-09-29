import { describe, expect, test } from 'vitest';

import { assertValidBranch, InvalidRepoError, parseGithubRepo } from './github.js';

describe('parseGithubRepo', () => {
  test('accepts the shorthand owner/repo form', () => {
    expect(parseGithubRepo('acme/ops-scripts')).toEqual({
      owner: 'acme',
      repo: 'ops-scripts',
      cloneUrl: 'https://github.com/acme/ops-scripts.git',
      webUrl: 'https://github.com/acme/ops-scripts',
      slug: 'acme__ops-scripts',
    });
  });

  test('accepts full URLs, with or without .git', () => {
    const plain = parseGithubRepo('https://github.com/acme/ops');
    const dotted = parseGithubRepo('https://github.com/acme/ops.git');
    expect(plain.cloneUrl).toBe('https://github.com/acme/ops.git');
    expect(dotted.cloneUrl).toBe(plain.cloneUrl);
  });

  test('accepts a host-prefixed reference without a scheme', () => {
    expect(parseGithubRepo('github.com/acme/ops').repo).toBe('ops');
  });

  test('trims surrounding whitespace', () => {
    expect(parseGithubRepo('  acme/ops  ').owner).toBe('acme');
  });

  test('rejects references carrying credentials', () => {
    // Credentials in the URL would end up in a process listing and in our logs.
    expect(() => parseGithubRepo('https://user:token@github.com/acme/ops')).toThrow(
      /Credentials are not allowed/,
    );
  });

  test('rejects non-HTTPS transports by naming the scheme it saw', () => {
    expect(() => parseGithubRepo('ssh://git@github.com/acme/ops')).toThrow(/Only https/);
    expect(() => parseGithubRepo('file:///etc/passwd')).toThrow(/Only https/);
  });

  test('names an scp-style SSH URL as unsupported rather than as bad credentials', () => {
    // The scheme check cannot see `git@host:path`, and "credentials are not
    // allowed" would be a misleading explanation for it.
    expect(() => parseGithubRepo('git@github.com:acme/ops.git')).toThrow(/scp-style/);
  });

  test('rejects hosts other than github.com', () => {
    expect(() => parseGithubRepo('https://gitlab.com/acme/ops')).toThrow(InvalidRepoError);
    expect(() => parseGithubRepo('https://github.com.evil.test/acme/ops')).toThrow(InvalidRepoError);
  });

  test('rejects a name that could be read as a git flag', () => {
    expect(() => parseGithubRepo('-acme/ops')).toThrow(InvalidRepoError);
    expect(() => parseGithubRepo('acme/-upload-pack=evil')).toThrow(InvalidRepoError);
  });

  test('rejects traversal and extra path segments', () => {
    expect(() => parseGithubRepo('acme/..')).toThrow(InvalidRepoError);
    expect(() => parseGithubRepo('acme/ops/extra/path')).toThrow(InvalidRepoError);
  });

  test('ignores a query string or fragment instead of letting it add segments', () => {
    expect(parseGithubRepo('https://github.com/acme/ops?ref=main').repo).toBe('ops');
    expect(parseGithubRepo('https://github.com/acme/ops#readme').repo).toBe('ops');
  });

  test('rejects an empty reference', () => {
    expect(() => parseGithubRepo('   ')).toThrow(/empty/);
  });

  test('produces a slug that cannot escape a directory', () => {
    const { slug } = parseGithubRepo('acme/ops');
    expect(slug).not.toContain('/');
    expect(slug).not.toContain('..');
  });
});

describe('assertValidBranch', () => {
  test('accepts ordinary branch names, including slashes', () => {
    expect(assertValidBranch('main')).toBe('main');
    expect(assertValidBranch('feature/deploy-hooks')).toBe('feature/deploy-hooks');
  });

  test('rejects flag-like and revision-syntax names', () => {
    expect(() => assertValidBranch('--upload-pack=evil')).toThrow(InvalidRepoError);
    expect(() => assertValidBranch('main..evil')).toThrow(/\.\./);
  });

  test('rejects names containing shell or path metacharacters', () => {
    expect(() => assertValidBranch('main; rm -rf /')).toThrow(InvalidRepoError);
    expect(() => assertValidBranch('main branch')).toThrow(InvalidRepoError);
  });

  test('rejects an empty name', () => {
    expect(() => assertValidBranch('  ')).toThrow(/empty/);
  });
});
