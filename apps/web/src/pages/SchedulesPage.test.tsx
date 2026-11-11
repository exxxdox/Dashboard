import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ScriptSchedule, ScriptSummary } from '@dashboard/shared';
import { beforeEach, expect, test, vi } from 'vitest';
import { SchedulesPage } from './SchedulesPage';

const queryState = vi.hoisted(() => ({ failed: false, direct: false, history: null as { id: string; name: string } | null, setHistory: vi.fn(), save: vi.fn(), pending: false, remove: vi.fn(), navigate: vi.fn() }));
vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>();
  return { ...actual, useState: (initial: unknown) => initial === null ? (queryState.direct ? [queryState.history, queryState.setHistory] : actual.useState(queryState.history)) : queryState.direct ? [initial, vi.fn()] : actual.useState(initial) };
});
vi.mock('../lib/router', () => ({ href: (path: string) => `#${path}`, navigate: queryState.navigate }));
beforeEach(() => { queryState.pending = false; queryState.save.mockReset(); queryState.history = null; queryState.setHistory.mockReset(); queryState.failed = false; queryState.direct = false; queryState.remove.mockReset(); queryState.navigate.mockReset(); });

const script = { id: 'scr_1', displayName: 'Daily backup', relPath: 'backup.sh', params: [] } as unknown as ScriptSummary;
const saved = { id: 'sch_1', name: 'Morning backup', retentionDays: 7, scriptId: 'scr_1', cron: '0 8 * * *', timeZone: 'UTC', enabled: true, targetName: 'edge', nextRunAt: null,
  input: { targetId: 'tgt_1', params: { KEEP: 'saved' }, argv: ['stored'], timeoutSec: 30 },
  lastTriggeredAt: null, lastExecutionId: null, lastError: null, updatedAt: '2026-11-10T00:00:00Z' } satisfies ScriptSchedule;
vi.mock('../api/queries', () => ({
  useSaveScriptSchedule: () => ({ mutate: queryState.save, isPending: queryState.pending }),
  useDeleteScriptSchedule: () => ({ mutate: queryState.remove, isPending: false }),
  useScripts: () => ({ data: [script] }),
  useScriptSchedules: () => ({ data: [saved, { ...saved, id: 'sch_2', name: 'Evening backup', enabled: false }] }),
  useScriptScheduleExecutions: () => ({ data: { items: [], total: 0 } }),
  useScriptSchedule: () => ({ data: saved, isError: queryState.failed, error: new Error('offline'), refetch: vi.fn() }),
}));
vi.mock('../lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: 'en' }), useT: () => (key: string) => key }));
vi.mock('./RunPanel', () => ({ RunPanel: ({ mode, initialInput }: { mode: string; initialInput: unknown }) => <div data-mode={mode}>{JSON.stringify(initialInput)}</div> }));

test('shows inline actions and keeps the editor off the page until opened', () => {
  const html = renderToStaticMarkup(<SchedulesPage scheduleId={null} />);
  expect(html).toContain('schedule.page.title');
  expect(html).not.toContain('<select');
  expect(html).not.toContain('<dialog');
  expect(html.match(/schedule.history.title/g)).toHaveLength(2);
  expect(html).toContain('schedule.pause');
  expect(html).toContain('schedule.resume');
  expect(html.match(/schedule.edit/g)).toHaveLength(2);
  expect(html.match(/schedule.delete/g)).toHaveLength(2);
  expect(html).toContain('#/schedules/sch_1');
  expect(html).toContain('Daily backup');
  expect(html).toContain('Morning backup');
  expect(html).toContain('Evening backup');
  expect(html).toContain('#/schedules/sch_2');
  expect(html).toContain('0 8 * * *');
  // Running and paused read as colour, not words: green dot, red dot.
  expect(html).toContain('bg-ok');
  expect(html).toContain('bg-danger');
  expect(html).toContain('<span class="sr-only">schedule.paused</span>');
});

test('editing an existing plan seeds the shared run editor from its saved invocation', () => {
  const html = renderToStaticMarkup(<SchedulesPage scheduleId="sch_1" />);
  expect(html).toContain('<dialog');
  expect(html).toContain('data-mode="schedule"');
  expect(html).not.toContain('schedule.history.empty');
  expect(html).toContain('stored');
  expect(html).toContain('KEEP');
});


test('keeps the cached editor mounted when background polling fails', () => {
  queryState.failed = true;
  const html = renderToStaticMarkup(<SchedulesPage scheduleId="sch_1" />);
  expect(html).toContain('<dialog');
  expect(html).toContain('data-mode="schedule"');
});

test('does not repeat the file name when it is also the display name', () => {
  script.displayName = 'backup.sh';
  const html = renderToStaticMarkup(<SchedulesPage scheduleId="sch_1" />);
  expect(html).not.toContain('backup.sh · backup.sh');
  script.displayName = 'Daily backup';
});

test('row actions edit or delete the corresponding saved plan', () => {
  queryState.direct = true;
  type Element = ReactElement<{ children?: unknown; onClick?: () => void }>;
  function elements(node: unknown): Element[] {
    if (Array.isArray(node)) return node.flatMap(elements);
    if (!node || typeof node !== 'object' || !('props' in node)) return [];
    const element = node as Element;
    return [element, ...elements(element.props.children)];
  }
  const rows = elements(SchedulesPage({ scheduleId: null }));
  rows.find(el => el.props.children === 'schedule.edit')!.props.onClick!();
  expect(queryState.navigate).toHaveBeenCalledWith('/schedules/sch_1');
  rows.find(el => el.props.children === 'schedule.history.title')!.props.onClick!();
  expect(queryState.setHistory).toHaveBeenCalledWith({ id: 'sch_1', name: 'Morning backup' });
  rows.find(el => el.props.children === 'schedule.pause')!.props.onClick!();
  expect(queryState.save.mock.calls[0]?.[0]).toEqual({ scheduleId: saved.id, input: { scriptId: saved.scriptId, name: saved.name, retentionDays: saved.retentionDays, cron: saved.cron, timeZone: saved.timeZone, enabled: false, input: saved.input } });
  rows.find(el => el.props.children === 'schedule.resume')!.props.onClick!();
  expect(queryState.save.mock.calls[1]?.[0]).toEqual({ scheduleId: 'sch_2', input: { scriptId: saved.scriptId, name: 'Evening backup', retentionDays: saved.retentionDays, cron: saved.cron, timeZone: saved.timeZone, enabled: true, input: saved.input } });
  rows.find(el => el.props.children === 'schedule.delete')!.props.onClick!();
  expect(queryState.remove.mock.calls[0]?.[0]).toBe('sch_1');
});

test('shows execution records in a separate dialog without the editor', () => {
  queryState.history = { id: 'sch_2', name: 'Evening backup' };
  const html = renderToStaticMarkup(<SchedulesPage scheduleId={null} />);
  expect(html).toContain('<dialog');
  expect(html).toContain('schedule.history.empty');
  expect(html).not.toContain('<select');
});
