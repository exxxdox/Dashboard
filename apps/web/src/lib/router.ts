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
  | { name: 'schedules'; scheduleId: string | null }
  | { name: 'runs'; executionId: string | null; search: URLSearchParams }
  | { name: 'targets' }
  | { name: 'sources' }
  // Carries the query string so the history's page number survives a reload and
  // can be linked to, the way the runs list already does it.
  | { name: 'dns'; search: URLSearchParams }
  // Preferences for the whole dashboard rather than for one feature.
  | { name: 'settings' }
  | { name: 'modelRelay' }
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
    case 'schedules':
      return { name: 'schedules', scheduleId: tail ? decodeURIComponent(tail) : null };
    case 'runs':
      return { name: 'runs', executionId: tail ? decodeURIComponent(tail) : null, search };
    case 'targets':
      return { name: 'targets' };
    case 'sources':
      return { name: 'sources' };
    case 'dns':
      return { name: 'dns', search };
    // Relay subpages share one mounted workspace so pending edits survive navigation.
    case 'model-relay':
      return { name: 'modelRelay' };
    case 'settings':
      return { name: 'settings' };
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

let navigationGuard: (() => boolean) | null = null;
let activeHash: string | undefined;

/** The open editor owns the decision; the router owns when a new route becomes visible. */
export function guardNavigation(allowNavigation: () => boolean): () => void {
  navigationGuard = allowNavigation;
  return () => { if (navigationGuard === allowNavigation) navigationGuard = null; };
}

function subscribe(onChange: () => void): () => void {
  const onHashChange = () => {
    const nextHash = window.location.hash || DEFAULT_HASH;
    const previousHash = getHash();
    if (nextHash === previousHash) return;
    if (navigationGuard && !navigationGuard()) {
      const { pathname, search } = window.location;
      window.history.replaceState(window.history.state, '', `${pathname}${search}${previousHash}`);
      return;
    }
    activeHash = nextHash;
    onChange();
  };
  window.addEventListener('hashchange', onHashChange);
  return () => window.removeEventListener('hashchange', onHashChange);
}

function getHash(): string {
  // React may read the snapshot before hashchange; raw location would bypass the unsaved-work guard.
  return activeHash ??= window.location.hash || DEFAULT_HASH;
}

function getServerHash(): string {
  return DEFAULT_HASH;
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash, getServerHash);
  return useMemo(() => parseRoute(hash), [hash]);
}
