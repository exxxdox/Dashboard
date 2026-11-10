import { afterEach, expect, test, vi } from 'vitest';

const store = vi.hoisted(() => ({ snapshot: null as (() => string) | null }));
vi.mock('react', () => ({
  useMemo: (create: () => unknown) => create(),
  useSyncExternalStore: (subscribe: (changed: () => void) => () => void, snapshot: () => string) => {
    store.snapshot = snapshot;
    subscribe(() => {});
    return snapshot();
  },
}));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

test('navigation guard runs before route snapshots change and restores declined browser back', async () => {
  const listeners = new Map<string, () => void>();
  const location = { hash: '#/scripts/editing', pathname: '/', search: '' };
  const replaceState = vi.fn();
  vi.stubGlobal('window', { location, history: { state: null, replaceState }, addEventListener: (event: string, callback: () => void) => listeners.set(event, callback), removeEventListener: vi.fn() });
  const { useRoute, guardNavigation } = await import('./router');
  expect(useRoute()).toEqual({ name: 'scripts', scriptId: 'editing' });
  const allow = vi.fn(() => false);
  const cleanup = guardNavigation(allow);
  location.hash = '#/scripts';
  // React can re-check getSnapshot before the browser dispatches hashchange.
  expect(store.snapshot!()).toBe('#/scripts/editing');
  listeners.get('hashchange')!();
  expect(allow).toHaveBeenCalledOnce();
  expect(store.snapshot!()).toBe('#/scripts/editing');
  expect(replaceState).toHaveBeenCalledWith(null, '', '/#/scripts/editing');
  allow.mockReturnValue(true);
  listeners.get('hashchange')!();
  expect(store.snapshot!()).toBe('#/scripts');
  cleanup();
  location.hash = '#/settings';
  listeners.get('hashchange')!();
  expect(store.snapshot!()).toBe('#/settings');
  expect(allow).toHaveBeenCalledTimes(2);
});
