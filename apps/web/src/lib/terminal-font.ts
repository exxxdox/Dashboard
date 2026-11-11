/**
 * Terminal font preference.
 *
 * The font lives on the viewing device, not in the dashboard's shared settings:
 * two browsers opening the same run may have different families installed. This
 * is the same reasoning that keeps the locale in `localStorage`.
 */

export const TERMINAL_FONT_FAMILY_KEY = 'dashboard.terminal.fontFamily';
export const TERMINAL_FONT_SIZE_KEY = 'dashboard.terminal.fontSize';
export const DEFAULT_TERMINAL_FONT_SIZE = 14;
export const MIN_TERMINAL_FONT_SIZE = 8;
export const MAX_TERMINAL_FONT_SIZE = 32;

export type TerminalFont = { family: string; size: number };

export const TERMINAL_FONT_SUGGESTIONS = [
  'JetBrains Mono',
  'Fira Code',
  'Cascadia Code',
  'Source Code Pro',
  'Ubuntu Mono',
  'Consolas',
  'Menlo',
  'monospace',
] as const;

export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TERMINAL_FONT_SIZE;
  return Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, Math.round(value)));
}

/**
 * Build a CSS font-family list from free text.
 *
 * The name is typed by hand, so it may arrive as a stack or carry stray
 * separators; splitting and rejoining keeps it a valid CSS value, and the theme
 * stack stays behind it as the fallback for a font that is not installed.
 */
export function terminalFontStack(family: string, fallback: string): string {
  const parts = family
    .split(',')
    .map((part) => part.replace(/[;{}]/g, '').trim())
    .filter((part) => part !== '');
  return parts.length === 0 ? fallback : `${parts.join(', ')}, ${fallback}`;
}

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage ?? null;
  } catch {
    // A blocked storage accessor throws instead of returning null.
    return null;
  }
}

export function readTerminalFont(storage: Storage | null = browserStorage()): TerminalFont {
  if (!storage) return { family: '', size: DEFAULT_TERMINAL_FONT_SIZE };
  try {
    return {
      family: storage.getItem(TERMINAL_FONT_FAMILY_KEY) ?? '',
      size: clampFontSize(Number.parseInt(storage.getItem(TERMINAL_FONT_SIZE_KEY) ?? '', 10)),
    };
  } catch {
    return { family: '', size: DEFAULT_TERMINAL_FONT_SIZE };
  }
}

export function saveTerminalFont(
  font: TerminalFont,
  storage: Storage | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    if (font.family === '') storage.removeItem(TERMINAL_FONT_FAMILY_KEY);
    else storage.setItem(TERMINAL_FONT_FAMILY_KEY, font.family);
    storage.setItem(TERMINAL_FONT_SIZE_KEY, String(clampFontSize(font.size)));
  } catch {
    // Private mode can refuse writes; the choice still applies to this page.
  }
}
