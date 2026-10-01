import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type {
  ExecutionLogChunk,
  ExecutionStream as StreamKind,
  ExecutionSummary,
} from '@dashboard/shared';
import '@xterm/xterm/css/xterm.css';
import { useExecutionStream } from '../api/useExecutionStream';

/**
 * xterm's own palette.
 *
 * The ANSI sixteen are literals -- they are the terminal's vocabulary, not the
 * page's, and a script's red should stay red whichever accent the dashboard is
 * wearing. The five that belong to the *chrome* are read from the tokens at
 * mount, because xterm cannot resolve a custom property and a literal copy of
 * the accent is a second answer waiting to go stale.
 */
const ANSI_PALETTE = {
  black: '#12171f',
  red: '#f0736c',
  green: '#4fbf8b',
  yellow: '#e8c256',
  blue: '#86a6cf',
  magenta: '#b58ad6',
  cyan: '#5fb3c4',
  white: '#e6edf4',
  brightBlack: '#7b8a97',
  brightRed: '#f79b95',
  brightGreen: '#7ed3a3',
  brightYellow: '#f2d47f',
  brightBlue: '#a9c3e3',
  brightMagenta: '#cfa8e8',
  brightCyan: '#84d0e0',
  brightWhite: '#f2f6f9',
} as const;

/**
 * Called where the terminal is created, not at import time: the chrome half
 * reads the tokens, and at import time the stylesheet may not be in the
 * document yet, which would leave every one of them on its fallback.
 */
function terminalTheme(): Record<string, string> {
  return { ...chromeTheme(), ...ANSI_PALETTE };
}

/** One token, resolved, with a literal to fall back on outside a browser. */
function token(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === '' ? fallback : value;
}

/** Resolve the monospace stack from the token layer, at mount, not import time. */
function resolveMonoStack(): string {
  return token('--stack-mono', 'monospace');
}

/**
 * The parts of the terminal that are the page rather than the output: its
 * surface, its ink, its cursor and what a selection looks like.
 */
function chromeTheme() {
  const surface = token('--surface', '#0a1119');
  const accent = token('--accent', '#2ee6ff');
  // The accent at 30%, written as `#rrggbbaa`. Not `color-mix()`: xterm hands
  // this string to a canvas `fillStyle` in its canvas renderer, which takes a
  // plain colour and nothing else.
  const selection = /^#[0-9a-f]{6}$/i.test(accent) ? `${accent}4d` : '#2ee6ff4d';

  return {
    background: surface,
    foreground: token('--text', '#e6f1ff'),
    cursor: accent,
    cursorAccent: surface,
    selectionBackground: selection,
  };
}

/**
 * Mark our own interpretation of a stream with 256-colour codes rather than the
 * basic 30–37 range, so a chunk the script coloured itself stays distinguishable
 * from a chunk we coloured.
 */
const STREAM_PREFIX: Record<StreamKind, string> = {
  stdout: '',
  stderr: '\x1b[38;5;210m',
  system: '\x1b[38;5;109m',
};

const RESET = '\x1b[0m';

/** Keep the colour for the whole chunk, then hand the terminal back its default. */
function paint(chunk: ExecutionLogChunk): string {
  const prefix = STREAM_PREFIX[chunk.stream];
  return prefix === '' ? chunk.data : `${prefix}${chunk.data}${RESET}`;
}

export function RunTerminal({
  executionId,
  live,
  onStatus,
}: {
  executionId: string;
  live: boolean;
  onStatus?: (execution: ExecutionSummary) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const disposedRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    disposedRef.current = false;
    const terminal = new Terminal({
      fontFamily: resolveMonoStack(),
      fontSize: 14,
      lineHeight: 1.45,
      letterSpacing: 0,
      cursorBlink: false,
      // Output is read, never typed into: a script has no stdin to give.
      disableStdin: true,
      convertEol: true,
      scrollback: 10_000,
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fit.fit();
    terminalRef.current = terminal;

    // Refitting on every resize event would thrash; one frame is enough.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        try {
          fit.fit();
        } catch {
          // A fit against a zero-sized container throws; the next resize fixes it.
        }
      });
    });
    observer.observe(host);

    return () => {
      disposedRef.current = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, []);

  useExecutionStream({
    executionId,
    live,
    onStatus,
    onChunk: (chunk) => {
      // The stream can deliver a final chunk after the terminal is gone.
      if (disposedRef.current) return;
      terminalRef.current?.write(paint(chunk));
    },
  });

  return (
    <div className="scanlines border-line bg-base shadow-card relative overflow-hidden rounded-xl border">
      <div ref={hostRef} className="h-[clamp(320px,58vh,780px)] w-full px-4 py-3" />
    </div>
  );
}
