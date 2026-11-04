import { renderToStaticMarkup } from 'react-dom/server';
import type { DnsSettingsView } from '@dashboard/shared';
import { expect, test, vi } from 'vitest';
import { DnsSettingsForm } from './DnsSettingsForm';

const hooks = vi.hoisted(() => ({ direct: false, state: null as unknown, mutate: vi.fn() }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    // Exercise form event handlers without adding a DOM runtime dependency.
    useState: (initial: unknown) => {
      if (!hooks.direct) return actual.useState(initial);
      if (hooks.state === null) hooks.state = typeof initial === 'function' ? initial() : initial;
      return [hooks.state, (next: unknown) => {
        hooks.state = typeof next === 'function' ? next(hooks.state) : next;
      }];
    },
  };
});
vi.mock('../api/queries', () => ({ useSaveDnsSettings: () => ({ isPending: false, mutate: hooks.mutate }) }));
vi.mock('../lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }), useT: () => (key: string) => key }));

const settings: DnsSettingsView = {
  provider: 'cloudflare', ipv6Source: 'local', localIpv6Interface: 'enp1s0', scheduleEnabled: false, intervalMinutes: 10,
  cloudflareZoneId: 'zone', cloudflareRecordName: 'home.example.com', hasCloudflareToken: true,
  alibabaAccessKeyId: '', alibabaRecordId: '', alibabaRecordType: 'AAAA',
  hasAlibabaAccessKeySecret: false, updatedAt: '2026-11-04T00:00:00Z',
};

// Opening settings must preserve the source shared by manual and scheduled updates.
test('restores the saved local IPv6 source', () => {
  const html = renderToStaticMarkup(<DnsSettingsForm settings={settings} />);
  expect(html).toContain('<option value="local" selected="">');
  expect(html).toContain('dns.form.ipv6SourceHint');
  expect(html).toContain('dns.form.localIpv6Interface');
  expect(html).toContain('value="enp1s0"');
});

test('defaults new DNS settings to ipify', () => {
  const html = renderToStaticMarkup(<DnsSettingsForm settings={null} />);
  expect(html).toContain('<option value="ipify" selected="">');
  expect(html).not.toContain('dns.form.localIpv6Interface');
});

// Follow the select change through React state to the submitted API payload.
test('saves the selected local source for manual and scheduled updates', () => {
  hooks.direct = true;
  hooks.state = null;
  hooks.mutate.mockClear();
  try {
    const form = DnsSettingsForm({ settings: null });
    const sourceField = form.props.children.find(
      (child: { props?: { label?: string } }) => child?.props?.label === 'dns.form.ipv6Source',
    );
    const select = sourceField.props.children({ id: 'source', describedBy: undefined });
    select.props.onChange({ target: { value: 'local' } });
    const changed = DnsSettingsForm({ settings: null });
    const interfaceField = changed.props.children.find(
      (child: { props?: { label?: string } }) => child?.props?.label === 'dns.form.localIpv6Interface',
    );
    const input = interfaceField.props.children({ id: 'interface', describedBy: undefined });
    input.props.onChange({ target: { value: 'enp1s0' } });
    const ready = DnsSettingsForm({ settings: null });
    ready.props.onSubmit({ preventDefault: vi.fn() });
    expect(hooks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ ipv6Source: 'local', localIpv6Interface: 'enp1s0' }), expect.any(Object),
    );
  } finally {
    hooks.direct = false;
    hooks.state = null;
  }
});
