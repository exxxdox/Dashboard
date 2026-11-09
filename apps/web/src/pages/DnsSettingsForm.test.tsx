import { renderToStaticMarkup } from 'react-dom/server';
import type { DnsSettingsView } from '@dashboard/shared';
import { expect, test, vi } from 'vitest';
import { DnsSettingsForm } from './DnsSettingsForm';
import { Select } from '../components/Form';

const hooks = vi.hoisted(() => ({ direct: false, state: null as unknown, mutate: vi.fn(), interfaces: ['enp1s0', 'eth0'], interfaceError: false }));
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
vi.mock('../api/queries', () => ({ useSaveDnsSettings: () => ({ isPending: false, mutate: hooks.mutate }), useDnsInterfaces: () => ({ data: hooks.interfaces, isPending: false, isError: hooks.interfaceError, error: new Error('unavailable'), refetch: vi.fn() }) }));
vi.mock('../lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }), useT: () => (key: string) => key }));

const settings: DnsSettingsView = {
  provider: 'cloudflare', ipv6Source: 'local', localIpv6Interface: 'enp1s0', scheduleEnabled: false, intervalMinutes: 10,
  cloudflareZoneId: 'zone', cloudflareRecordName: 'home.example.com', hasCloudflareToken: true,
  updatedAt: '2026-11-04T00:00:00Z',
};

// Opening settings must preserve the source shared by manual and scheduled updates.
test('restores the saved local IPv6 source', () => {
  const html = renderToStaticMarkup(<DnsSettingsForm settings={settings} />);
  expect(html).toContain('<option value="local" selected="">');
  expect(html).toContain('dns.form.ipv6SourceHint');
  expect(html).toContain('dns.form.localIpv6Interface');
  expect(html).toContain('<option value="enp1s0" selected="">');
  expect(html).toContain('<option value="eth0">eth0</option>');
  expect(html).toContain('dns.form.localIpv6InterfaceAuto');
});

test('defaults new DNS settings to ipify', () => {
  const html = renderToStaticMarkup(<DnsSettingsForm settings={null} />);
  expect(html).toContain('<option value="ipify" selected="">');
  expect(html).not.toContain('dns.form.localIpv6Interface');
});

// Follow the select change through React state to the submitted API payload.
test.each(['enp1s0', ''])('saves the selected interface (%s) for manual and scheduled updates', (interfaceName) => {
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
    expect(input.type).toBe(Select);
    input.props.onChange({ target: { value: interfaceName } });
    const ready = DnsSettingsForm({ settings: null });
    ready.props.onSubmit({ preventDefault: vi.fn() });
    expect(hooks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ ipv6Source: 'local', localIpv6Interface: interfaceName }), expect.any(Object),
    );
  } finally {
    hooks.direct = false;
    hooks.state = null;
  }
});

test('preserves a saved interface missing from the current host', () => {
  const html = renderToStaticMarkup(<DnsSettingsForm settings={{ ...settings, localIpv6Interface: 'old0' }} />);
  expect(html).toContain('<option value="old0" selected="">old0</option>');
});

test('shows an interface loading error with retry', () => {
  hooks.interfaceError = true;
  try {
    const html = renderToStaticMarkup(<DnsSettingsForm settings={settings} />);
    expect(html).toContain('unavailable');
  } finally {
    hooks.interfaceError = false;
  }
});

// A single provider needs no selector and must not expose removed credentials.
test('only renders Cloudflare credentials without a provider selector', () => {
  const html = renderToStaticMarkup(<DnsSettingsForm settings={settings} />);
  expect(html).not.toContain('dns.form.provider');
  expect(html).not.toContain('alibaba');
  expect(html).toContain('dns.form.cloudflareToken');
});
