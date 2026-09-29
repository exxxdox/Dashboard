import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type {
  ExecutionLogChunk,
  ExecutionStream as StreamKind,
  ExecutionSummary,
} from '@script-dashboard/shared';
import '@xterm/xterm/css/xterm.css';
import { useExecutionStream } from '../api/useExecutionStream';

/**
 * xterm's own palette, kept in step with the CSS tokens so the terminal reads as
 * part of the page rather than an embedded widget. xterm cannot read custom
 * properties, so these literals have to be edited alongside `index.css`.
 */
const TERMINAL_THEME = {
  background: '#0b0e13',
  foreground: '#e6edf4',
  cursor: '#f0a92c',
  cursorAccent: '#0b0e13',
  selectionBackground: 'rgba(240, 169, 44, 0.28)',
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

/** Resolve the monospace stack from the token layer, at mount, not import time. */
function resolveMonoStack(): string {
  if (typeof document === 'undefined') return 'monospace';
  const value = getComputedStyle(document.documentElement).getPropertyValue('--stack-mono').trim();
  return value === '' ? 'monospace' : value;
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
      theme: TERMINAL_THEME,
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
