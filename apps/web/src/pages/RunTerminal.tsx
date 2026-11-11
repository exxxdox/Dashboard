import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type {
  ExecutionLogChunk,
  ExecutionStream as StreamKind,
  ExecutionSummary,
  TerminalState,
} from '@dashboard/shared';
import '@xterm/xterm/css/xterm.css';
import { useExecutionStream } from '../api/useExecutionStream';
import { executionSocket } from '../api/ws';
import { Button } from '../components/Button';
import { useI18n } from '../lib/i18n';
import { formatExit } from '../lib/format';
import { executionStatusLabel } from '../lib/status';

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
  interactive = false,
  execution,
  onStatus,
}: {
  executionId: string;
  live: boolean;
  interactive?: boolean;
  execution?: ExecutionSummary;
  onStatus?: (execution: ExecutionSummary) => void;
}) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const disposedRef = useRef(false);
  const modeRef = useRef({ interactive, live });
  modeRef.current = { interactive, live };
  const ownerRef = useRef<TerminalState>('waiting');
  const syncingRef = useRef(true);
  const syncGeneration = useRef(0);
  const connectedRef = useRef(executionSocket.getState() === 'open');
  const wantsControlRef = useRef(true);
  const [owner, setOwner] = useState<TerminalState>('waiting');
  const [syncing, setSyncing] = useState(true);
  const [connected, setConnected] = useState(connectedRef.current);
  const [inputError, setInputError] = useState(false);

  function canInput(): boolean {
    return modeRef.current.interactive && modeRef.current.live && connectedRef.current
      && !syncingRef.current && ownerRef.current === 'controlling';
  }

  function updateInput(): void {
    const terminal = terminalRef.current;
    if (terminal) terminal.options.disableStdin = !canInput();
  }

  function resize(): void {
    const terminal = terminalRef.current;
    if (!terminal || !canInput()) return;
    executionSocket.sendTerminal({ type: 'terminal_resize', executionId,
      cols: Math.max(2, Math.min(500, terminal.cols)), rows: Math.max(2, Math.min(500, terminal.rows)) });
  }

  function claim(): void {
    wantsControlRef.current = true;
    if (modeRef.current.interactive && modeRef.current.live && connectedRef.current && !syncingRef.current) {
      executionSocket.sendTerminal({ type: 'terminal_claim', executionId });
    }
  }

  function sendInput(data: string): void {
    if (!canInput()) return;
    if (new TextEncoder().encode(data).byteLength > 16384
      || !executionSocket.sendTerminal({ type: 'terminal_input', executionId, data })) {
      setInputError(true);
    } else setInputError(false);
  }

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    disposedRef.current = false;
    const terminal = new Terminal({
      fontFamily: resolveMonoStack(), fontSize: 14, lineHeight: 1.45, letterSpacing: 0,
      cursorBlink: interactive, disableStdin: true,
      // A PTY already emits CRLF; translating again changes full-screen cursor movement.
      convertEol: !interactive, scrollback: 10_000, theme: terminalTheme(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fit.fit();
    terminalRef.current = terminal;
    const keyboard = terminal.onData(sendInput);
    const dimensions = terminal.onResize(resize);
    const unwatch = executionSocket.onStateChange((state) => {
      connectedRef.current = state === 'open';
      setConnected(connectedRef.current);
      if (state !== 'open') {
        ownerRef.current = 'waiting'; setOwner('waiting');
        syncingRef.current = true; setSyncing(true);
        syncGeneration.current += 1;
      }
      updateInput();
    });
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        try { fit.fit(); } catch { /* A hidden terminal is fitted on the next resize. */ }
      });
    });
    observer.observe(host);
    return () => {
      disposedRef.current = true;
      if (interactive) executionSocket.sendTerminal({ type: 'terminal_release', executionId });
      keyboard.dispose(); dimensions.dispose(); unwatch();
      cancelAnimationFrame(frame); observer.disconnect(); terminal.dispose();
      terminalRef.current = null;
    };
  }, [executionId, interactive]);

  useEffect(() => { updateInput(); }, [live]);

  useExecutionStream({
    executionId, live, onStatus,
    onTerminal: (message) => {
      ownerRef.current = message.state; setOwner(message.state);
      if (message.state === 'busy') wantsControlRef.current = false;
      if (message.error && message.error !== 'not_ready') setInputError(true);
      updateInput();
      if (message.state === 'controlling') resize();
      if (message.state === 'available' && wantsControlRef.current) claim();
    },
    onSyncChange: (next) => {
      const generation = ++syncGeneration.current;
      if (next) {
        syncingRef.current = true; setSyncing(true); updateInput();
      } else {
        // write() is asynchronous: wait until all replay bytes have been parsed so
        // an old terminal query cannot send an automatic response into the script.
        terminalRef.current?.write('', () => {
          if (disposedRef.current || generation !== syncGeneration.current) return;
          syncingRef.current = false; setSyncing(false); updateInput();
          if (wantsControlRef.current && ownerRef.current !== 'controlling' && ownerRef.current !== 'busy') claim();
          else resize();
        });
      }
    },
    onChunk: (chunk) => {
      if (disposedRef.current) return;
      // Dashboard notices must not overwrite a full-screen application's cursor state.
      if (interactive && chunk.stream === 'system') return;
      terminalRef.current?.write(paint(chunk));
    },
  });

  const enabled = interactive && live && connected && !syncing && owner === 'controlling';
  const status = !live ? 'closed' : !connected ? 'offline' : syncing ? 'restoring' : owner;
  const statusKey = {
    waiting: 'runs.terminal.waiting', available: 'runs.terminal.available',
    controlling: 'runs.terminal.controlling', busy: 'runs.terminal.busy', closed: 'runs.terminal.closed',
    offline: 'runs.terminal.offline', restoring: 'runs.terminal.restoring',
  } as const;
  return (
    <div className="scanlines border-line bg-base shadow-card relative overflow-hidden rounded-xl border">
      {interactive ? (
        <div className="border-line flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <span role="status" className="text-mute text-meta mr-auto">{!live && execution
            ? t('runs.terminal.finished', { status: executionStatusLabel(t, execution.status), exit: formatExit(execution.exitCode, execution.signal) })
            : t(statusKey[status])}</span>
          {owner === 'controlling' ? (
            <Button size="sm" disabled={!connected || !live} onClick={() => {
              wantsControlRef.current = false;
              ownerRef.current = 'available'; setOwner('available'); updateInput();
              executionSocket.sendTerminal({ type: 'terminal_release', executionId });
            }}>{t('runs.terminal.release')}</Button>
          ) : (
            <Button size="sm" disabled={!connected || !live || syncing} onClick={claim}>{t('runs.terminal.claim')}</Button>
          )}
          <Button size="sm" disabled={!enabled} onClick={() => sendInput('\x03')}>{t('runs.terminal.interrupt')}</Button>
          <Button size="sm" disabled={!enabled} onClick={() => sendInput('\x04')}>{t('runs.terminal.eof')}</Button>
          {!live && execution?.status === 'interrupted' ? (
            <p className="text-mute text-meta w-full">{t('runs.terminal.interruptedHint')}</p>
          ) : null}
          {inputError ? <p role="alert" className="text-danger text-meta w-full">{t('runs.terminal.inputError')}</p> : null}
        </div>
      ) : null}
      <div ref={hostRef} aria-label={interactive ? t('runs.terminal.label') : undefined}
        className="h-[clamp(320px,58vh,780px)] w-full px-4 py-3" />
    </div>
  );
}
