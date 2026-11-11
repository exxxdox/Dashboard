import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { Nav } from './Nav';
const state = vi.hoisted(() => ({ data: undefined as undefined | { dnsEnabled: boolean; modelRelayEnabled: boolean } }));
vi.mock('../api/queries', () => ({ useAppSettings: () => state }));
vi.mock('../lib/i18n', () => ({ useT: () => (key: string) => key }));
test.each([
  [undefined, false, false],
  [{ dnsEnabled: false, modelRelayEnabled: true }, false, true],
  [{ dnsEnabled: true, modelRelayEnabled: false }, true, false],
  [{ dnsEnabled: true, modelRelayEnabled: true }, true, true],
] as const)('navigation respects feature settings %j', (data, dns, relay) => {
  state.data = data;
  const html = renderToStaticMarkup(<Nav active="settings" />);
  expect(html.includes('href="#/dns"')).toBe(dns);
  expect(html.includes('href="#/model-relay"')).toBe(relay);
  expect(html).toContain('href="#/settings"');
});
