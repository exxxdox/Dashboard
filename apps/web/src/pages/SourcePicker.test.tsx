import type { ReactElement } from 'react';
import type { SourceSummary } from '@dashboard/shared';
import { beforeEach, expect, test, vi } from 'vitest';
import { SourcePicker } from './SourcePicker';

// Exercise the real handlers without a browser renderer dependency, as the
// other interaction tests here do.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0 }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) {
      hooks.slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    }
    return [
      hooks.slots[index],
      (next: unknown) => {
        hooks.slots[index] =
          typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.slots[index]) : next;
      },
    ];
  },
  useEffect: () => {},
  useRef: (initial: unknown) => ({ current: initial }),
  useId: () => 'picker',
}));

type Element = ReactElement<Record<string, unknown>>;
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}

function source(id: string, name: string, scriptCount: number): SourceSummary {
  return {
    id, name, scriptCount, kind: 'github', repoUrl: null, branch: null, subPath: null,
    mountPath: id, syncStatus: 'never', syncError: null, lastSyncAt: null,
    createdAt: '', updatedAt: '',
  };
}
const sources = [source('a', 'Alpha', 2), source('b', 'Beta', 5)];

function render(onChange: (id: string) => void): Element {
  hooks.index = 0;
  return SourcePicker({ sources, value: 'b', onChange, label: 'source' });
}
function trigger(tree: Element): Element {
  return elements(tree).find((element) => element.props.role === 'combobox')!;
}
function options(tree: Element): Element[] {
  return elements(tree).filter((element) => element.props.role === 'option');
}

beforeEach(() => {
  hooks.slots = [];
  hooks.index = 0;
});

test('hovering an option highlights it without changing the source', () => {
  const onChange = vi.fn();
  (trigger(render(onChange)).props.onClick as () => void)();

  const list = options(render(onChange));
  expect((trigger(render(onChange)).props['aria-activedescendant'] as string).endsWith('-1')).toBe(true);
  (list[0]!.props.onMouseEnter as () => void)();
  expect((trigger(render(onChange)).props['aria-activedescendant'] as string).endsWith('-0')).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
});

test('clicking an option is what changes the source', () => {
  const onChange = vi.fn();
  (trigger(render(onChange)).props.onClick as () => void)();
  (options(render(onChange))[0]!.props.onClick as () => void)();
  expect(onChange).toHaveBeenCalledWith('a');
});

test('keyboard picks the highlighted option', () => {
  const onChange = vi.fn();
  const press = (key: string) =>
    (trigger(render(onChange)).props.onKeyDown as (event: {
      key: string;
      preventDefault: () => void;
    }) => void)({ key, preventDefault: vi.fn() });

  // The list opens on the current value, and the arrows move from there.
  press('ArrowUp');
  press('ArrowUp');
  press('Enter');
  expect(onChange).toHaveBeenCalledWith('a');
});
