import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, test, vi } from 'vitest';
import { FeatureSettingsForm } from './FeatureSettingsForm';

const hooks = vi.hoisted(() => ({ save: vi.fn(), pending: false }));
vi.mock('../api/queries', () => ({ useSaveAppSettings: () => ({ mutate: hooks.save, isPending: hooks.pending }) }));
vi.mock('../lib/i18n', () => ({ useT: () => (key: string) => key }));
type Element = ReactElement<{ children?: unknown; label?: string; onChange?: (checked: boolean) => void }>;
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
beforeEach(() => { hooks.save.mockReset(); hooks.pending = false; });
test('renders stored feature switches and disables them while saving', () => {
  hooks.pending = true;
  const html = renderToStaticMarkup(<FeatureSettingsForm settings={{ dnsEnabled: false, modelRelayEnabled: true }} />);
  expect(html).toContain('aria-label="nav.dns" disabled=""');
  expect(html).toContain('aria-checked="false"');
  expect(html).toContain('aria-label="nav.modelRelay" disabled=""');
});
test.each([
  ['nav.dns', { dnsEnabled: true }],
  ['nav.modelRelay', { modelRelayEnabled: true }],
])('saves only the changed feature for %s', (label, input) => {
  const tree = FeatureSettingsForm({ settings: { dnsEnabled: false, modelRelayEnabled: false } });
  elements(tree).find(element => element.props.label === label)!.props.onChange!(true);
  expect(hooks.save).toHaveBeenCalledWith(input);
});
