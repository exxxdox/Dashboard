import type { FormEvent, ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AppSettingsView } from '@dashboard/shared';
import { beforeEach, expect, test, vi } from 'vitest';
import { NotificationSettingsForm } from './NotificationSettingsForm';

const hooks = vi.hoisted(() => ({
  direct: false, state: null as unknown, save: vi.fn(), test: vi.fn(),
}));
vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>();
  return { ...actual, useState: (initial: unknown) => {
    if (!hooks.direct) return actual.useState(initial);
    if (hooks.state === null) hooks.state = typeof initial === 'function' ? initial() : initial;
    return [hooks.state, (next: unknown) => { hooks.state = typeof next === 'function' ? next(hooks.state) : next; }];
  } };
});
vi.mock('../api/queries', () => ({
  useSaveAppSettings: () => ({ mutate: hooks.save, isPending: false }),
  useTestNotification: () => ({ mutate: hooks.test, isPending: false, isSuccess: false, isError: false }),
}));
vi.mock('../lib/i18n', () => ({ useI18n: () => ({ locale: 'en', t: (key: string) => key }), useT: () => (key: string) => key }));

const settings: AppSettingsView = {
  gotifyAddress: 'notify.test', hasGotifyToken: true, notificationsReady: true,
  notifyScriptResults: true, notifyDnsChanges: false, updatedAt: '2026-11-10T00:00:00Z',
};
type Element = ReactElement<{ children?: unknown; label?: string; checked?: boolean; onChange?: (value: boolean) => void; onClear?: () => void; onClick?: () => void; onSubmit?: (event: FormEvent) => void }>;
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function render(): Element {
  hooks.direct = true;
  return NotificationSettingsForm({ settings });
}
beforeEach(() => { hooks.direct = false; hooks.state = null; hooks.save.mockReset(); hooks.test.mockReset(); });

test('restores both event notification switches from the stored settings', () => {
  const tree = elements(render());
  expect(tree.find(el => el.props.label === 'settings.notifications.scriptResults')?.props.checked).toBe(true);
  expect(tree.find(el => el.props.label === 'settings.notifications.dnsChanges')?.props.checked).toBe(false);
  const html = renderToStaticMarkup(<NotificationSettingsForm settings={settings} />);
  expect(html).toContain('settings.notifications.eventsHint');
});

test('saves notification preferences with credentials without returning the stored token', () => {
  const tree = elements(render());
  tree.find(el => el.props.label === 'settings.notifications.scriptResults')!.props.onChange!(false);
  render().props.onSubmit!({ preventDefault: vi.fn() } as unknown as FormEvent);
  expect(hooks.save.mock.calls[0]?.[0]).toEqual({ gotifyAddress: 'notify.test', notifyScriptResults: false, notifyDnsChanges: false });
});

test('clearing a token preserves the chosen notification preferences', () => {
  const tree = elements(render());
  tree.find(el => el.props.label === 'settings.notifications.scriptResults')!.props.onChange!(false);
  elements(render()).find(el => el.props.label === 'settings.notifications.tokenLabel')!.props.onClear!();
  expect(hooks.save.mock.calls[0]?.[0]).toEqual({ gotifyAddress: 'notify.test', notifyScriptResults: false, notifyDnsChanges: false, clearGotifyToken: true });
});

test('explicit test messages use only the current credentials', () => {
  elements(render()).find(el => el.props.children === 'settings.notifications.test')!.props.onClick!();
  expect(hooks.test).toHaveBeenCalledWith({ gotifyAddress: 'notify.test', gotifyToken: '' });
});
