import type { ReactElement } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { ScriptFileForm } from './ScriptFileEditor';
import { TextInput } from '../components/Form';
import { BashEditor } from '../components/BashEditor';

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, create: vi.fn(), save: vi.fn(), remove: vi.fn(), pending: false, navigate: vi.fn(), guard: vi.fn(), effects: [] as (() => (() => void) | void)[] }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.slots[index], (next: unknown) => { hooks.slots[index] = typeof next === 'function' ? next(hooks.slots[index]) : next; }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useEffect: (effect: () => (() => void) | void) => { hooks.effects.push(effect); },
}));
vi.mock('../api/queries', () => ({
  useCreateScript: () => ({ mutate: hooks.create, isPending: hooks.pending }),
  useSaveScriptContent: () => ({ mutate: hooks.save, isPending: hooks.pending }),
  useDeleteScript: () => ({ mutate: hooks.remove, isPending: hooks.pending }),
}));
vi.mock('../lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: 'en' }) }));
vi.mock('../lib/router', () => ({ navigate: hooks.navigate, guardNavigation: hooks.guard }));
type Element = ReactElement<Record<string, unknown>>;
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const el = node as Element;
  const children = typeof el.props.children === 'function' ? el.props.children({ id: 'field', describedBy: undefined }) : el.props.children;
  return [el, ...elements(children)];
}
const close = vi.fn();
const initial = { content: 'x'.repeat(210_000), contentHash: 'original-hash' };
function render(mode: 'create' | 'edit' | 'delete' = 'edit', nextInitial = initial) {
  hooks.index = 0;
  hooks.effects = [];
  return ScriptFileForm({ sourceId: 'local-source', scriptId: mode === 'create' ? undefined : 'script-id', relPath: mode === 'create' ? '' : 'test.sh', initial: mode === 'create' ? undefined : nextInitial, mode, onClose: close });
}
function change(type: unknown, value: string, mode: 'create' | 'edit' = 'edit') {
  const node = elements(render(mode)).find(el => el.type === type)!;
  if (type === BashEditor) (node.props.onChange as (value: string) => void)(value);
  else (node.props.onChange as (event: unknown) => void)({ target: { value } });
}
function submit(mode: 'create' | 'edit' = 'edit') {
  const form = elements(render(mode)).find(el => el.type === 'form')!;
  (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
}
beforeEach(() => { hooks.slots = []; hooks.pending = false; close.mockReset(); hooks.create.mockReset(); hooks.save.mockReset(); hooks.remove.mockReset(); hooks.navigate.mockReset(); hooks.guard.mockReset(); hooks.guard.mockReturnValue(vi.fn()); vi.stubGlobal('window', { confirm: vi.fn(() => false), location: { href: 'http://localhost/#/scripts/script-id' }, history: { state: null, replaceState: vi.fn() }, addEventListener: vi.fn(), removeEventListener: vi.fn() }); });

test('edits the complete file and submits the hash of the loaded snapshot', () => {
  expect(elements(render()).find(el => el.type === BashEditor)?.props.value).toBe(initial.content);
  change(BashEditor, 'echo changed');
  // A later query result must not silently advance the version being edited.
  render('edit', { content: 'external edit', contentHash: 'new-hash' });
  submit();
  expect(hooks.save.mock.calls[0]?.[0]).toEqual({ id: 'script-id', input: { content: 'echo changed', expectedHash: 'original-hash' } });
  expect(close).not.toHaveBeenCalled();
  hooks.save.mock.calls[0]?.[1].onSuccess();
  expect(close).toHaveBeenCalledOnce();
});

test('creates a script in a subdirectory and selects it only after success', () => {
  change(TextInput, 'tools/new.sh', 'create');
  change(BashEditor, 'echo hello', 'create');
  submit('create');
  expect(hooks.create.mock.calls[0]?.[0]).toEqual({ sourceId: 'local-source', input: { relPath: 'tools/new.sh', content: 'echo hello' } });
  expect(hooks.navigate).not.toHaveBeenCalled();
  hooks.create.mock.calls[0]?.[1].onSuccess({ id: 'created' });
  expect(hooks.navigate).toHaveBeenCalledWith('/scripts/created');
  hooks.pending = true;
  render('create');
  hooks.effects[0]!();
  expect((hooks.guard.mock.calls.at(-1)![0] as () => boolean)()).toBe(true);
});

test('keeps unsaved changes when closing is declined and ignores closing while saving', () => {
  change(BashEditor, 'unsaved');
  (render().props.onClose as () => void)();
  expect(window.confirm).toHaveBeenCalledWith('scripts.file.discard');
  expect(close).not.toHaveBeenCalled();
  expect(elements(render()).find(el => el.type === BashEditor)?.props.value).toBe('unsaved');
  hooks.pending = true;
  (render().props.onClose as () => void)();
  expect(close).not.toHaveBeenCalled();
});

test('deletes with the loaded hash, then leaves the deleted script page', () => {
  const action = elements(render('delete')).find(el => el.props.children === 'scripts.file.deleteConfirm')!;
  (action.props.onClick as () => void)();
  expect(hooks.remove.mock.calls[0]?.[0]).toEqual({ id: 'script-id', sourceId: 'local-source', input: { expectedHash: 'original-hash' } });
  expect(close).not.toHaveBeenCalled();
  hooks.remove.mock.calls[0]?.[1].onSuccess();
  expect(hooks.navigate).toHaveBeenCalledWith('/scripts');
});


test('registers a navigation guard that declines leaving with unsaved work or while saving', () => {
  change(BashEditor, 'unsaved');
  render();
  const cleanup = hooks.effects[0]!();
  const allowNavigation = hooks.guard.mock.calls[0]![0] as () => boolean;
  expect(allowNavigation()).toBe(false);
  expect(window.confirm).toHaveBeenCalledWith('scripts.file.discard');
  expect(close).not.toHaveBeenCalled();
  vi.mocked(window.confirm).mockReturnValue(true);
  expect(allowNavigation()).toBe(true);
  cleanup?.();
  expect(hooks.guard.mock.results[0]!.value).toHaveBeenCalledOnce();
  hooks.pending = true;
  render();
  hooks.effects[0]!();
  expect((hooks.guard.mock.calls.at(-1)![0] as () => boolean)()).toBe(false);
});
