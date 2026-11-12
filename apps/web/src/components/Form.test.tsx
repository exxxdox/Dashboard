import type { ReactElement } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { Select } from './Form';

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
  useId: () => 'select',
}));

type Element = ReactElement<Record<string, unknown>>;
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}

function render(onValueChange: (value: string) => void): Element {
  hooks.index = 0;
  return Select({
    value: 'b',
    onValueChange,
    children: [
      <option key="a" value="a">Alpha</option>,
      <option key="b" value="b">Beta</option>,
    ],
  });
}
function trigger(tree: Element): Element {
  return elements(tree).find((element) => element.props.role === 'combobox')!;
}
function options(tree: Element): Element[] {
  return elements(tree).filter((element) => element.props.role === 'option');
}
const highlighted = (tree: Element): number =>
  Number(String(trigger(tree).props['aria-activedescendant']).split('-').pop());

beforeEach(() => {
  hooks.slots = [];
  hooks.index = 0;
});

test('hovering an option highlights it without changing the value', () => {
  const onValueChange = vi.fn();
  (trigger(render(onValueChange)).props.onClick as () => void)();

  const list = options(render(onValueChange));
  expect(highlighted(render(onValueChange))).toBe(1);
  (list[0]!.props.onMouseEnter as () => void)();
  expect(highlighted(render(onValueChange))).toBe(0);
  expect(onValueChange).not.toHaveBeenCalled();
});

test('clicking an option is what changes the value', () => {
  const onValueChange = vi.fn();
  (trigger(render(onValueChange)).props.onClick as () => void)();
  (options(render(onValueChange))[0]!.props.onClick as () => void)();
  expect(onValueChange).toHaveBeenCalledWith('a');
});

test('keyboard picks the highlighted option', () => {
  const onValueChange = vi.fn();
  const press = (key: string) =>
    (trigger(render(onValueChange)).props.onKeyDown as (event: {
      key: string;
      preventDefault: () => void;
    }) => void)({ key, preventDefault: vi.fn() });

  // The list opens on the current value, and the arrows move from there.
  press('ArrowUp');
  press('ArrowUp');
  press('Enter');
  expect(onValueChange).toHaveBeenCalledWith('a');
});
