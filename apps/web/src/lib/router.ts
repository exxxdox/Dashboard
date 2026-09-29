import { useMemo, useSyncExternalStore } from 'react';

/**
 * Hash router.
 *
 * The dashboard is served as a single HTML entry point from the same origin as
 * the API, so the route lives in the fragment: no server rewrite is needed and
 * a deep link to a run is a URL you can paste into a chat.
 */
export type Route =
  | { name: 'overview' }
  | { name: 'scripts'; scriptId: string | null }
  | { name: 'runs'; executionId: string | null; search: URLSearchParams }
  | { name: 'targets' }
  | { name: 'sources' }
  | { name: 'notFound'; path: string };

const DEFAULT_HASH = '#/';

export function parseRoute(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const queryAt = raw.indexOf('?');
  const path = queryAt === -1 ? raw : raw.slice(0, queryAt);
  const search = new URLSearchParams(queryAt === -1 ? '' : raw.slice(queryAt + 1));
  const [head, tail] = path.split('/').filter((segment) => segment !== '');

  switch (head) {
    case undefined:
      return { name: 'overview' };
    case 'scripts':
      return { name: 'scripts', scriptId: tail ? decodeURIComponent(tail) : null };
    case 'runs':
      return { name: 'runs', executionId: tail ? decodeURIComponent(tail) : null, search };
    case 'targets':
      return { name: 'targets' };
    case 'sources':
      return { name: 'sources' };
    default:
      return { name: 'notFound', path };
  }
}

export type HashQuery = Record<string, string | number | undefined>;

function toSearchParams(input: HashQuery | URLSearchParams | undefined): URLSearchParams | null {
  if (!input) return null;
  if (input instanceof URLSearchParams) return input;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  return params;
}

/** Build a fragment for an anchor or for `navigate`. */
export function href(path: string, query?: HashQuery | URLSearchParams): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const search = toSearchParams(query)?.toString() ?? '';
  return `#${normalized}${search ? `?${search}` : ''}`;
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const target = to.startsWith('#') ? to : href(to);

  if (options.replace) {
    // replaceState does not emit `hashchange`, so subscribers are notified by hand.
    const { pathname, search } = window.location;
    window.history.replaceState(null, '', `${pathname}${search}${target}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }

  window.location.hash = target;
}

/** Go back when there is somewhere to go, otherwise to a sensible parent. */
export function goBack(fallback: string): void {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback, { replace: true });
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function getHash(): string {
  return window.location.hash || DEFAULT_HASH;
}

function getServerHash(): string {
  return DEFAULT_HASH;
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash, getServerHash);
  return useMemo(() => parseRoute(hash), [hash]);
}
