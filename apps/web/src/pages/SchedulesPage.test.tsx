import { renderToStaticMarkup } from 'react-dom/server';
import type { ScriptSchedule, ScriptSummary } from '@dashboard/shared';
import { beforeEach, expect, test, vi } from 'vitest';
import { SchedulesPage } from './SchedulesPage';

const queryState = vi.hoisted(() => ({ failed: false }));
beforeEach(() => { queryState.failed = false; });

const script = { id: 'scr_1', displayName: 'Daily backup', relPath: 'backup.sh', params: [] } as unknown as ScriptSummary;
const saved = { scriptId: 'scr_1', cron: '0 8 * * *', timeZone: 'UTC', enabled: true, targetName: 'edge', nextRunAt: null,
  input: { targetId: 'tgt_1', params: { KEEP: 'saved' }, argv: ['stored'], timeoutSec: 30 },
  lastTriggeredAt: null, lastExecutionId: null, lastError: null, updatedAt: '2026-11-10T00:00:00Z' } satisfies ScriptSchedule;
vi.mock('../api/queries', () => ({
  useScripts: () => ({ data: [script] }),
  useScriptSchedules: () => ({ data: [saved] }),
  useScriptSchedule: () => ({ data: saved, isError: queryState.failed, error: new Error('offline'), refetch: vi.fn() }),
}));
vi.mock('../lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: 'en' }), useT: () => (key: string) => key }));
vi.mock('./RunPanel', () => ({ RunPanel: ({ mode, initialInput }: { mode: string; initialInput: unknown }) => <div data-mode={mode}>{JSON.stringify(initialInput)}</div> }));

test('offers a script picker and a list of existing schedules outside the scripts page', () => {
  const html = renderToStaticMarkup(<SchedulesPage scriptId={null} />);
  expect(html).toContain('schedule.page.title');
  expect(html).toContain('schedule.script');
  expect(html).toContain('#/schedules/scr_1');
  expect(html).toContain('Daily backup');
  expect(html).toContain('0 8 * * *');
});

test('editing an existing plan seeds the shared run editor from its saved invocation', () => {
  const html = renderToStaticMarkup(<SchedulesPage scriptId="scr_1" />);
  expect(html).toContain('data-mode="schedule"');
  expect(html).toContain('stored');
  expect(html).toContain('KEEP');
});


test('keeps the cached editor mounted when background polling fails', () => {
  queryState.failed = true;
  const html = renderToStaticMarkup(<SchedulesPage scriptId="scr_1" />);
  expect(html).toContain('data-mode="schedule"');
});
