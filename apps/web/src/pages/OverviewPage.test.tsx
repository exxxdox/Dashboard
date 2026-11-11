import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { OverviewPage } from './OverviewPage';

const features = vi.hoisted(() => ({ dnsEnabled: true }));
vi.mock('../api/queries', () => ({
  useAppSettings: () => ({ data: features }),
  useOverview: () => ({
    isSuccess: true,
    data: {
      counts: { targets: 1, sources: 1, scripts: 10, running: 0, failed24h: 0 },
      dns: { state: 'unknown', recordName: null, recordValue: null, ipv6: null, at: null },
      recent: Array.from({ length: 10 }, (_, index) => ({
        id: `execution-${index}`, status: 'succeeded', scriptRelPath: `script-${index}.sh`,
        targetName: 'host', durationMs: 1000, queuedAt: new Date().toISOString(),
      })),
    },
  }),
}));
vi.mock('../lib/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
  useT: () => (key: string) => key,
}));

test('overview keeps only the latest three runs and links to the full history', () => {
  const html = renderToStaticMarkup(<OverviewPage />);
  expect(html.match(/href="#\/runs\/execution-/g)).toHaveLength(3);
  expect(html).toContain('script-0.sh');
  expect(html).toContain('script-2.sh');
  expect(html).not.toContain('script-3.sh');
  expect(html).toContain('href="#/runs"');
});


test('overview hides the DNS status entry when disabled', () => {
  features.dnsEnabled = true;
  expect(renderToStaticMarkup(<OverviewPage />)).toContain('href="#/dns"');
  features.dnsEnabled = false;
  expect(renderToStaticMarkup(<OverviewPage />)).not.toContain('href="#/dns"');
});
