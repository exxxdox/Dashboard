/**
 * Validation for public GitHub repositories.
 *
 * Only public repos are supported, so the clone URL is always an unauthenticated
 * HTTPS URL. The validation is strict on purpose: the derived values end up in a
 * remote `git clone` command line, so anything that could be read as a git flag
 * or a shell metacharacter has to be rejected here rather than escaped later.
 */

export type GithubRepoRef = {
  owner: string;
  repo: string;
  /** HTTPS clone URL, always with a `.git` suffix. */
  cloneUrl: string;
  /** Browser URL for display. */
  webUrl: string;
  /** Filesystem-safe directory name derived from owner and repo. */
  slug: string;
};

/**
 * GitHub allows letters, digits, and hyphens in owner names. We additionally
 * forbid a leading `-` so the value can never be mistaken for a CLI flag.
 */
const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

/** Repo names allow dots and underscores. Leading `.`/`-` are rejected. */
const REPO_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/;

const ACCEPTED_HOSTS = new Set(['github.com', 'www.github.com']);

export class InvalidRepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRepoError';
  }
}

/**
 * Parse a GitHub repository reference.
 *
 * Accepts `owner/repo`, `github.com/owner/repo`, and full `https://` URLs.
 * Rejects SSH URLs, credentials in the URL, query strings, and anything that is
 * not on github.com: a public-only deployment has no business cloning elsewhere.
 */
export function parseGithubRepo(input: string): GithubRepoRef {
  const raw = input.trim();
  if (raw === '') throw new InvalidRepoError('Repository reference is empty');

  // The scheme is checked first: for `ssh://git@host/repo` the useful message is
  // that SSH is unsupported, not that the URL happens to contain a user name.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) {
    const scheme = raw.slice(0, raw.indexOf('://'));
    throw new InvalidRepoError(
      `Only https:// repository URLs are supported; got ${scheme}://. ` +
        'The dashboard clones public repositories over HTTPS only.',
    );
  }

  // scp-style SSH, e.g. `git@github.com:owner/repo.git`. Caught separately
  // because it has no scheme for the check above to see.
  if (/^[^/@\s]+@[^/\s]+:/.test(raw)) {
    throw new InvalidRepoError(
      'SSH (scp-style) repository URLs are not supported; use an https:// URL',
    );
  }

  if (raw.includes('@')) {
    throw new InvalidRepoError('Credentials are not allowed in the repository URL');
  }

  const withoutScheme = raw.replace(/^https?:\/\//i, '');

  // Strip query and fragment before splitting, so they cannot smuggle segments.
  const pathPart = withoutScheme.split(/[?#]/, 1)[0] ?? '';
  const segments = pathPart.split('/').filter((segment) => segment !== '');

  let owner: string;
  let repo: string;

  if (segments.length === 1) {
    // Bare `owner/repo` shorthand.
    const [ownerPart, repoPart] = segments[0]!.split('/');
    if (!ownerPart || !repoPart) {
      throw new InvalidRepoError('Expected "owner/repo"');
    }
    [owner, repo] = [ownerPart, repoPart];
  } else if (segments.length === 2) {
    [owner, repo] = [segments[0]!, segments[1]!];
  } else if (segments.length === 3 && ACCEPTED_HOSTS.has(segments[0]!.toLowerCase())) {
    [owner, repo] = [segments[1]!, segments[2]!];
  } else {
    throw new InvalidRepoError('Expected "owner/repo" or "https://github.com/owner/repo"');
  }

  const normalizedRepo = repo.replace(/\.git$/i, '');

  if (!OWNER_PATTERN.test(owner)) {
    throw new InvalidRepoError(`Invalid GitHub owner name: ${JSON.stringify(owner)}`);
  }
  if (!REPO_PATTERN.test(normalizedRepo)) {
    throw new InvalidRepoError(`Invalid GitHub repository name: ${JSON.stringify(normalizedRepo)}`);
  }

  return {
    owner,
    repo: normalizedRepo,
    cloneUrl: `https://github.com/${owner}/${normalizedRepo}.git`,
    webUrl: `https://github.com/${owner}/${normalizedRepo}`,
    // Both segments are already restricted to a safe alphabet, so the join
    // cannot introduce a path separator or a traversal segment.
    slug: `${owner}__${normalizedRepo}`,
  };
}

/** Branch names reach `git clone --branch`, so flag-like names are rejected. */
export function assertValidBranch(branch: string): string {
  const value = branch.trim();
  if (value === '') throw new InvalidRepoError('Branch name is empty');
  if (value.startsWith('-')) throw new InvalidRepoError('Branch name may not start with "-"');
  if (value.includes('..')) throw new InvalidRepoError('Branch name may not contain ".."');
  if (!/^[A-Za-z0-9._/-]{1,200}$/.test(value)) {
    throw new InvalidRepoError(`Invalid branch name: ${JSON.stringify(value)}`);
  }
  return value;
}
