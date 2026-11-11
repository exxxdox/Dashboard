import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ScriptsPage } from './ScriptsPage';
import { saveCollapsedDirectories, saveScriptSource } from '../lib/script-browser';

const state = vi.hoisted(() => ({ linkedSourceId: '' }));
vi.mock('../api/queries', () => ({
  useSources: () => ({ data: [
    { id: 'a', name: 'Source A', kind: 'github', scriptCount: 1, syncStatus: 'never' },
    { id: 'b', name: 'Source B', kind: 'github', scriptCount: 1, syncStatus: 'never' },
  ] }),
  useScript: () => ({ data: state.linkedSourceId ? { sourceId: state.linkedSourceId } : undefined }),
  useSourceTree: (id: string) => ({ data: { name: id, path: '', type: 'dir', children: [
    { name: 'tools', path: 'tools', type: 'dir', children: [
      { name: `${id}-task.sh`, path: 'tools/task.sh', type: 'file' },
    ] },
  ] } }),
  useSyncSource: () => ({ mutate: vi.fn() }),
}));
vi.mock('../lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }), useT: () => (key: string) => key }));
vi.mock('./ScriptDetail', () => ({ ScriptIdentityBar: () => null, ScriptDetail: () => null }));
vi.mock('./ScriptFileEditor', () => ({ CreateScriptButton: () => null }));

beforeEach(() => {
  state.linkedSourceId = '';
  const entries = new Map<string, string>();
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
  } });
});
afterEach(() => vi.unstubAllGlobals());

function render(): string {
  return renderToStaticMarkup(<ScriptsPage scriptId={state.linkedSourceId ? 'script' : null} />);
}

test('reopens the remembered source after leaving the scripts page', () => {
  saveScriptSource('b');
  expect(render()).toContain('<option value="b" selected="">');
  expect(render()).toContain('b-task.sh');
});

test('a direct script link takes priority over the remembered source', () => {
  saveScriptSource('b');
  state.linkedSourceId = 'a';
  expect(render()).toContain('<option value="a" selected="">');
});

test('a deleted source falls back to the first available source', () => {
  saveScriptSource('deleted');
  expect(render()).toContain('<option value="a" selected="">');
});

test('restores the selected source directory expansion state', () => {
  saveScriptSource('b');
  saveCollapsedDirectories('b', new Set(['tools']));
  expect(render()).toContain('aria-expanded="false"');
  expect(render()).not.toContain('b-task.sh');
  state.linkedSourceId = 'a';
  expect(render()).toContain('a-task.sh');
});

test('fills the preview pane with the no-selection prompt', () => {
  expect(render()).toContain('h-full justify-center overflow-auto');
});
