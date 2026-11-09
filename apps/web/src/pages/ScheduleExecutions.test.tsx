import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, test, vi } from 'vitest';
import { ScheduleExecutions } from './ScheduleExecutions';

const calls = vi.hoisted(() => ({ query: vi.fn(), direct: false, offset: 0, failed: false }));
vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>();
  return { ...actual, useState: (initial: unknown) => calls.direct
    ? [calls.offset, (next: number) => { calls.offset = next; }]
    : actual.useState(initial) };
});
beforeEach(() => { calls.direct = false; calls.offset = 0; calls.failed = false; calls.query.mockClear(); });
vi.mock('../api/queries', () => ({ useScriptScheduleExecutions: (id: string, offset: number) => {
  calls.query(id, offset);
  return { isError: calls.failed, error: new Error('offline'), refetch: vi.fn(), data: { items: [{ id: 'run_1', queuedAt: '2026-11-10T00:00:00Z', status: 'succeeded', durationMs: 2000, targetName: 'edge' }], total: 21 } };
} }));
vi.mock('../lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: 'en' }), useT: () => (key: string) => key }));

test('shows only the selected plan history with status, timing and a log link', () => {
  const html = renderToStaticMarkup(<ScheduleExecutions scheduleId="sch_1" />);
  expect(calls.query).toHaveBeenCalledWith('sch_1', 0);
  expect(html).toContain('#/runs/run_1');
  expect(html).toContain('runs.status.succeeded');
  expect(html).toContain('edge');
  expect(html).toContain('runs.next');
  expect(html).toContain('runs.previous');
});


test('paginates the selected plan without mixing histories', () => {
  calls.direct = true;
  const tree = ScheduleExecutions({ scheduleId: 'sch_2' });
  const children = (node: unknown): { props: { children?: unknown; onClick?: () => void } }[] => {
    if (Array.isArray(node)) return node.flatMap(children);
    if (!node || typeof node !== 'object' || !('props' in node)) return [];
    const element = node as { props: { children?: unknown; onClick?: () => void } };
    return [element, ...children(element.props.children)];
  };
  children(tree).find((element) => element.props.children === 'runs.next')!.props.onClick!();
  ScheduleExecutions({ scheduleId: 'sch_2' });
  expect(calls.query).toHaveBeenLastCalledWith('sch_2', 20);
});

test('keeps cached execution rows visible while a background refresh fails', () => {
  calls.failed = true;
  const html = renderToStaticMarkup(<ScheduleExecutions scheduleId="sch_1" />);
  expect(html).toContain('offline');
  expect(html).toContain('#/runs/run_1');
});
