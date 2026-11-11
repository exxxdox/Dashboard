import { describe, expect, test } from 'vitest';
import {
  clampFontSize,
  DEFAULT_TERMINAL_FONT_SIZE,
  readTerminalFont,
  saveTerminalFont,
  terminalFontStack,
  TERMINAL_FONT_FAMILY_KEY,
  TERMINAL_FONT_SIZE_KEY,
} from './terminal-font';

function store(values: Record<string, string>): Storage {
  const data = { ...values };
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => { data[key] = value; },
    removeItem: (key: string) => { delete data[key]; },
  } as Storage;
}

describe('terminalFontStack', () => {
  test('keeps a user family and appends the theme fallback', () => {
    expect(terminalFontStack('JetBrains Mono', 'monospace')).toBe('JetBrains Mono, monospace');
  });

  test('normalises separators and drops empty families', () => {
    expect(terminalFontStack('Fira Code, ;Cascadia Code,', 'monospace'))
      .toBe('Fira Code, Cascadia Code, monospace');
  });

  test('falls back to the theme stack for blank input', () => {
    expect(terminalFontStack('  , ; ', 'system-mono')).toBe('system-mono');
  });
});

describe('clampFontSize', () => {
  test('keeps values inside the readable range', () => {
    expect(clampFontSize(18)).toBe(18);
    expect(clampFontSize(2)).toBe(8);
    expect(clampFontSize(99)).toBe(32);
  });

  test('replaces a non-number with the default', () => {
    expect(clampFontSize(Number.NaN)).toBe(DEFAULT_TERMINAL_FONT_SIZE);
  });
});

describe('readTerminalFont / saveTerminalFont', () => {
  test('reads a saved family and clamped size', () => {
    const storage = store({ [TERMINAL_FONT_FAMILY_KEY]: 'Fira Code', [TERMINAL_FONT_SIZE_KEY]: '99' });
    expect(readTerminalFont(storage)).toEqual({ family: 'Fira Code', size: 32 });
  });

  test('returns defaults when nothing is stored or storage is unavailable', () => {
    expect(readTerminalFont(store({}))).toEqual({ family: '', size: DEFAULT_TERMINAL_FONT_SIZE });
    expect(readTerminalFont(null)).toEqual({ family: '', size: DEFAULT_TERMINAL_FONT_SIZE });
  });

  test('removes the family entry when the user clears it', () => {
    const storage = store({ [TERMINAL_FONT_FAMILY_KEY]: 'Fira Code' });
    saveTerminalFont({ family: '', size: 16 }, storage);
    expect(storage.getItem(TERMINAL_FONT_FAMILY_KEY)).toBeNull();
    expect(storage.getItem(TERMINAL_FONT_SIZE_KEY)).toBe('16');
  });
});
