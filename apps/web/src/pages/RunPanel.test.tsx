import type { ReactElement } from 'react';
import type { ScriptRunPrefill, ScriptSummary } from '@dashboard/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { RunPanel } from './RunPanel';

// Run the real form handlers and effect cleanup without adding a DOM dependency.
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[], index: 0, changed: false,
  effects: [] as { deps: unknown[]; cleanup?: () => void }[],
  pending: [] as (() => void)[],
  prefill: undefined as ScriptRunPrefill | undefined,
  save: vi.fn(), execute: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = hooks.index++;
    if (!(i in hooks.slots)) hooks.slots[i] = typeof initial === 'function' ? initial() : initial;
    return [hooks.slots[i], (next: unknown) => {
      const value = typeof next === 'function' ? next(hooks.slots[i]) : next;
      if (!Object.is(value, hooks.slots[i])) hooks.changed = true;
      hooks.slots[i] = value;
    }];
  },
  useRef: (initial: unknown) => {
    const i = hooks.index++;
    if (!(i in hooks.slots)) hooks.slots[i] = { current: initial };
    return hooks.slots[i];
  },
  useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
    const i = hooks.index++;
    const previous = hooks.effects[i];
    if (previous && deps.every((value, n) => Object.is(value, previous.deps[n])) && deps.length === previous.deps.length) return;
    hooks.pending.push(() => {
      previous?.cleanup?.();
      hooks.effects[i] = { deps, cleanup: effect() || undefined };
    });
  },
}));
vi.mock('../api/queries', () => ({
  useTargets: () => ({ data: [{ id: 'target', name: 'host' }], isSuccess: true }),
  useScriptRunDraft: () => ({ data: hooks.prefill }),
  useSaveScriptRunDraft: () => ({ mutateAsync: hooks.save }),
  useExecuteScript: () => ({ mutate: hooks.execute }),
}));
vi.mock('../lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../lib/router', () => ({ navigate: vi.fn() }));

const script = { id: 'script', params: [{ name: 'NAME', type: 'string', required: false, default: null, description: '' }], timeoutSec: null } as ScriptSummary;
const saved = (): ScriptRunPrefill => ({ source: 'draft', draft: { params: { NAME: 'old' }, custom: [], timeoutSec: '' } });
type Element = ReactElement<{ children?: unknown; label?: string; onClick?: () => void; value?: string; onChange?: (event: { target: { value: string } }) => void }>;
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function render(props: Partial<Parameters<typeof RunPanel>[0]> = {}): Element {
  let tree: Element;
  do {
    hooks.changed = false;
    hooks.index = 0;
    hooks.pending = [];
    tree = RunPanel({ script, ...props });
  } while (hooks.changed);
  for (const effect of hooks.pending) effect();
  return tree;
}
function edit(value: string): void {
  const row = elements(render()).find((element) => element.props.label === 'NAME')!;
  const input = (row.props.children as (props: { id: string }) => Element)({ id: 'name' });
  input.props.onChange!({ target: { value } });
  render();
}
function unmount(): void {
  for (const effect of hooks.effects) effect?.cleanup?.();
}
beforeEach(() => {
  vi.useFakeTimers();
  hooks.slots = []; hooks.effects = []; hooks.pending = [];
  hooks.prefill = saved(); hooks.save.mockReset().mockResolvedValue(saved()); hooks.execute.mockReset();
});
afterEach(() => { unmount(); vi.useRealTimers(); });

test('flushes an edited draft when leaving before the debounce fires', () => {
  render(); edit('new');
  expect(hooks.save).not.toHaveBeenCalled();
  unmount();
  expect(hooks.save).toHaveBeenCalledWith({ id: 'script', draft: expect.objectContaining({ params: { NAME: 'new' } }) });
});

test('saves current values before a quick submit can navigate away', () => {
  render(); edit('new');
  const button = elements(render()).find((element) => element.props.children === 'runs.submit')!;
  button.props.onClick!();
  expect(hooks.save).toHaveBeenCalledWith({ id: 'script', draft: expect.objectContaining({ params: { NAME: 'new' } }) });
  expect(hooks.save.mock.invocationCallOrder[0]).toBeLessThan(hooks.execute.mock.invocationCallOrder[0]!);
});

test('a delayed prefill does not overwrite input already edited', () => {
  hooks.prefill = undefined;
  render(); edit('new');
  hooks.prefill = saved();
  const row = elements(render()).find((element) => element.props.label === 'NAME')!;
  const input = (row.props.children as (props: { id: string }) => Element)({ id: 'name' });
  expect(input.props.value).toBe('new');
});

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

test('retries a failed background save when leaving', async () => {
  hooks.save.mockRejectedValueOnce(new Error('offline'));
  render(); edit('new');
  vi.advanceTimersByTime(700);
  await settle();
  unmount();
  await settle();
  expect(hooks.save).toHaveBeenCalledTimes(2);
});

test('queues the latest draft behind an in-flight save even after unmount', async () => {
  let finish!: () => void;
  hooks.save.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  render(); edit('first');
  vi.advanceTimersByTime(700);
  edit('latest');
  unmount();
  expect(hooks.save).toHaveBeenCalledTimes(1);
  finish();
  await settle();
  expect(hooks.save).toHaveBeenLastCalledWith({ id: 'script', draft: expect.objectContaining({ params: { NAME: 'latest' } }) });
});

test('saves a return to the original value after a pending edit', async () => {
  render(); edit('new');
  vi.advanceTimersByTime(700);
  edit('old');
  unmount();
  await settle();
  expect(hooks.save).toHaveBeenLastCalledWith({ id: 'script', draft: expect.objectContaining({ params: { NAME: 'old' } }) });
});

test('retries on close after a pending-state render and a later failure', async () => {
  let fail!: (error: Error) => void;
  hooks.save.mockReturnValueOnce(new Promise<void>((_resolve, reject) => { fail = reject; }));
  render(); edit('new');
  vi.advanceTimersByTime(700);
  render(); // Mutation pending state can rerender with this draft already queued.
  fail(new Error('offline'));
  await settle();
  unmount();
  await settle();
  expect(hooks.save).toHaveBeenCalledTimes(2);
});


test('manual run settings contain no scheduling controls', () => {
  const tree = render();
  expect(elements(tree).some((element) => typeof element.type === 'function' && element.type.name === 'ScriptSchedulePanel')).toBe(false);
});

test('schedule editing restores its saved invocation without touching the manual draft', async () => {
  const props = { mode: 'schedule' as const, initialInput: { targetId: 'target', params: { NAME: 'scheduled' }, argv: ['saved arg'], timeoutSec: 23 } };
  const tree = render(props);
  const row = elements(tree).find((element) => element.props.label === 'NAME')!;
  const input = (row.props.children as (props: { id: string }) => Element)({ id: 'name' });
  expect(input.props.value).toBe('scheduled');
  input.props.onChange!({ target: { value: 'schedule edit' } });
  render(props);
  await vi.advanceTimersByTimeAsync(1000);
  unmount();
  expect(hooks.save).not.toHaveBeenCalled();
  expect(elements(render(props)).some((element) => element.props.children === 'runs.submit')).toBe(false);
});
