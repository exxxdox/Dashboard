import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { DnsPage } from './DnsPage';

const hooks = vi.hoisted(() => ({ appSettings: vi.fn(() => ({ data: { updatedAt: null } })) }));
vi.mock('../api/queries', () => ({
  useAppSettings: hooks.appSettings,
  useDnsState: () => ({ data: { settings: null, ipv6: null, ipv6CheckedAt: null,
    record: null, recordCheckedAt: null, schedule: null, history: { records: [] } } }),
  useDetectDnsIpv6: () => ({}), useQueryDnsRecord: () => ({}),
  useRunDnsUpdate: () => ({}),
}));
vi.mock('../components/Modal', () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div data-testid="dialog">{children}</div> }));
vi.mock('./DnsHistoryPreview', () => ({ DnsHistoryPreview: () => <div data-testid="history-preview" /> }));
vi.mock('../lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: 'en' }) }));
vi.mock('./DnsSettingsForm', () => ({ DnsSettingsForm: () => <form data-testid="dns-settings" /> }));
vi.mock('./DnsHistoryTable', () => ({ DnsHistoryTable: () => <div data-testid="full-history" /> }));
vi.mock('./NotificationSettingsForm', () => ({ NotificationSettingsForm: () => <form data-testid="notifications" /> }));

// The DNS page has one UI, including when opened through an old layout link.
test.each(['', 'layout=domainUpdate'])('DNS exposes all controls without a layout switch (%s)', (query) => {
  hooks.appSettings.mockClear();
  const html = renderToStaticMarkup(<DnsPage search={new URLSearchParams(query)} />);
  expect(html).toContain('data-testid="dns-settings"');
  expect(html).not.toContain('data-testid="notifications"');
  expect(hooks.appSettings).not.toHaveBeenCalled();
  expect(html).not.toContain('settings.notifications.title');
  expect(html).toContain('data-testid="full-history"');
  expect(html).toContain('data-testid="history-preview"');
  expect(html).toContain('dns.action.settings');
  expect(html).not.toContain('<aside');
  expect(html).toContain('sm:grid-cols-2 xl:grid-cols-3');

  expect(html).not.toContain('aria-pressed');
  expect(html).not.toContain('domainUpdate');
});
