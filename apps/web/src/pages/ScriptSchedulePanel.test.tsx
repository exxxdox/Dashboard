import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExecuteScriptInput, ScriptSchedule } from '@dashboard/shared';
import { beforeEach, expect, test, vi } from 'vitest';
import { ScriptSchedulePanel } from './ScriptSchedulePanel';

const hooks = vi.hoisted(() => ({
  direct: false, slots: [] as unknown[], index: 0, changed: false,
  data: null as ScriptSchedule | null | undefined, pending: false, error: false,
  save: vi.fn(), remove: vi.fn(), refetch: vi.fn(), mutationError: false,
}));
vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>();
  return { ...actual, useState: (initial: unknown) => {
    if (!hooks.direct) return actual.useState(initial);
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.slots[index], (next: unknown) => {
      const value = typeof next === 'function' ? next(hooks.slots[index]) : next;
      hooks.changed ||= !Object.is(value, hooks.slots[index]);
      hooks.slots[index] = value;
    }];
  } };
});
vi.mock('../api/queries', () => ({
  useScriptSchedule: () => ({ data: hooks.data, isPending: hooks.pending, isError: hooks.error, error: new Error('offline'), refetch: hooks.refetch }),
  useSaveScriptSchedule: () => ({ mutate: hooks.save, isPending: false, isError: hooks.mutationError, error: new Error('Invalid Cron') }),
  useDeleteScriptSchedule: () => ({ mutate: hooks.remove, isPending: false }),
}));
vi.mock('../lib/i18n', () => ({ useI18n: () => ({ locale: 'en', t: (key: string) => key }), useT: () => (key: string) => key }));

const input: ExecuteScriptInput = { targetId: 'new-target', params: { NAME: 'new' }, argv: ['new argument'], timeoutSec: 15 };
const saved: ScriptSchedule = {
  id: 'sch_1', name: 'Morning', retentionDays: 7, scriptId: 'script', cron: '0 8 * * *', timeZone: 'Asia/Shanghai', enabled: true,
  input: { targetId: 'saved-target', params: { NAME: 'saved' }, argv: ['saved argument'], timeoutSec: 30 },
  targetName: 'Saved host', nextRunAt: '2026-11-11T00:00:00Z', lastTriggeredAt: '2026-11-10T00:00:00Z',
  lastExecutionId: 'run_1', lastError: null, updatedAt: '2026-11-10T00:00:00Z',
};
type Element = ReactElement<{ children?: unknown; label?: string; value?: string; onClick?: () => void; onChange?: (value: unknown) => void; disabled?: boolean; getInput?: () => ExecuteScriptInput | null }>;
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function render(getInput: () => ExecuteScriptInput | null = () => input): Element {
  hooks.direct = true;
  let tree: Element;
  do {
    hooks.changed = false; hooks.index = 0;
    tree = ScriptSchedulePanel({ scriptId: 'script', schedule: hooks.data ?? null, defaultName: 'New plan', getInput });
  } while (hooks.changed);
  return tree;
}
function click(label: string, getInput?: () => ExecuteScriptInput | null): void {
  elements(render(getInput)).find((el) => el.props.children === label)!.props.onClick!();
}
beforeEach(() => {
  hooks.direct = false; hooks.slots = []; hooks.data = null; hooks.pending = false; hooks.error = false; hooks.mutationError = false;
  hooks.save.mockReset(); hooks.remove.mockReset();
});

test('shows the saved target and snapshot separately from the current run form', () => {
  hooks.data = saved;
  const html = renderToStaticMarkup(<ScriptSchedulePanel scriptId="script" schedule={hooks.data ?? null} defaultName="New plan" getInput={() => input} />);
  expect(html).toContain('Saved host');
  expect(html).toContain('saved argument');
  expect(html).toContain('NAME');
  expect(html).toContain('saved');
  expect(html).toContain('0 8 * * *');
  expect(html).toContain('Asia/Shanghai');
  expect(html).toContain('#/runs/run_1');
  expect(html).toContain('schedule.snapshotHint');
});

test('saving a schedule explicitly snapshots the current run settings', () => {
  hooks.data = saved;
  click('schedule.save');
  expect(hooks.save.mock.calls[0]?.[0]).toEqual({ scheduleId: 'sch_1', input: { scriptId: 'script', name: 'Morning', retentionDays: 7, cron: saved.cron, timeZone: saved.timeZone, enabled: true, input } });
});

test('refuses saving when the run form is invalid', () => {
  click('schedule.save', () => null);
  expect(hooks.save).not.toHaveBeenCalled();
});

test('disabling keeps the saved run settings instead of the current form', () => {
  hooks.data = saved;
  const toggle = elements(render()).find((el) => el.props.label === 'schedule.enabled')!;
  toggle.props.onChange!(false);
  expect(hooks.save.mock.calls[0]?.[0]).toEqual({ scheduleId: 'sch_1', input: { scriptId: 'script', name: 'Morning', retentionDays: 7, cron: saved.cron, timeZone: saved.timeZone, enabled: false, input: saved.input } });
});

test('deletes the saved schedule', () => {
  hooks.data = saved;
  click('schedule.delete');
  expect(hooks.remove.mock.calls[0]?.[0]).toBe('sch_1');
});

test('localizes persisted submission errors without rendering raw error details', () => {
  hooks.data = { ...saved, lastError: 'submit_failed' };
  const html = renderToStaticMarkup(<ScriptSchedulePanel scriptId="script" schedule={hooks.data ?? null} defaultName="New plan" getInput={() => input} />);
  expect(html).toContain('schedule.error.submit_failed');
});


test('shows save validation failures inside the schedule dialog', () => {
  hooks.mutationError = true;
  const html = renderToStaticMarkup(<ScriptSchedulePanel scriptId="script" schedule={hooks.data ?? null} defaultName="New plan" getInput={() => input} />);
  expect(html).toContain('Invalid Cron');
});


test('creates a distinct plan with its own name and retention', () => {
  click('schedule.save');
  expect(hooks.save.mock.calls[0]?.[0]).toMatchObject({
    scheduleId: undefined, input: { scriptId: 'script', name: 'New plan', retentionDays: 30, input },
  });
});
