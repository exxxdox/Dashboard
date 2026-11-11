import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { readScriptSource, saveScriptSource, readCollapsedDirectories, saveCollapsedDirectories } from './script-browser';

let entries: Map<string, string>;
beforeEach(() => {
  entries = new Map();
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
  } });
});
afterEach(() => vi.unstubAllGlobals());

test('remembers the last script source', () => {
  expect(readScriptSource()).toBe('');
  saveScriptSource('source-b');
  expect(readScriptSource()).toBe('source-b');
});

test('keeps collapsed directories separate for each source and remembers expand all', () => {
  saveCollapsedDirectories('a', new Set(['tools', 'tools/admin']));
  saveCollapsedDirectories('b', new Set(['other']));
  expect(readCollapsedDirectories('a')).toEqual(new Set(['tools', 'tools/admin']));
  expect(readCollapsedDirectories('b')).toEqual(new Set(['other']));
  saveCollapsedDirectories('a', new Set());
  expect(readCollapsedDirectories('a')).toEqual(new Set());
});

test.each(['bad json', '{}', '[1]', 'null'] )('ignores malformed saved directories %s', (value) => {
  saveCollapsedDirectories('a', new Set(['tools']));
  const key = [...entries.keys()][0]!;
  entries.set(key, value);
  expect(readCollapsedDirectories('a')).toEqual(new Set());
});

test('storage restrictions do not prevent browsing', () => {
  vi.stubGlobal('window', { get localStorage() { throw new Error('blocked'); } });
  expect(readScriptSource()).toBe('');
  expect(readCollapsedDirectories('a')).toEqual(new Set());
  expect(() => saveScriptSource('a')).not.toThrow();
  expect(() => saveCollapsedDirectories('a', new Set(['tools']))).not.toThrow();
});
