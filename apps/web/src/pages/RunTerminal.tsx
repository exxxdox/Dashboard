import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ChevronDown, ChevronUp, Search, Type, X } from 'lucide-react';
import { envPrefix, quoteAll } from '@dashboard/shared';
import type {
  ExecutionLogChunk,
  ExecutionStream as StreamKind,
  ExecutionSummary,
  TerminalState,
} from '@dashboard/shared';
import '@xterm/xterm/css/xterm.css';
import { useExecutionStream } from '../api/useExecutionStream';
import { executionSocket } from '../api/ws';
import { Button, IconButton } from '../components/Button';
import { TextInput } from '../components/Form';
import { useI18n } from '../lib/i18n';
import { pushToast } from '../lib/toast';
import { formatExit } from '../lib/format';
import { executionStatusLabel } from '../lib/status';
import { cn } from '../lib/cn';
import {
  clampFontSize,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  readTerminalFont,
  saveTerminalFont,
  TERMINAL_FONT_SUGGESTIONS,
  terminalFontStack,
} from '../lib/terminal-font';

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
 * Match highlights are the page's, so they come from the same tokens as the
 * chrome. The addon requires plain `#rrggbb` (it hands them to a canvas), so a
 * token that is not one falls back rather than being passed through.
 */
function searchDecorations() {
  const hex = (name: string, fallback: string): string => {
    const value = token(name, fallback);
    return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  };
  const accent = hex('--accent', '#2ee6ff');
  const secondary = hex('--accent-2', '#a855f7');
  return {
    matchBackground: hex('--surface-4', '#1f2f44'),
    matchBorder: secondary,
    matchOverviewRuler: secondary,
    activeMatchBackground: accent,
    activeMatchBorder: hex('--accent-ink', '#032027'),
    activeMatchColorOverviewRuler: accent,
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
  const fitRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<{ index: number; count: number } | null>(null);
  const savedFont = readTerminalFont();
  const [fontOpen, setFontOpen] = useState(false);
  const [fontFamily, setFontFamily] = useState(savedFont.family);
  const [fontSize, setFontSize] = useState(savedFont.size);
  const [fontSizeText, setFontSizeText] = useState(String(savedFont.size));

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

  async function clipboard(action: 'copy' | 'paste', terminal: Terminal): Promise<void> {
    try {
      if (action === 'copy') {
        const selection = terminal.getSelection();
        if (selection) await navigator.clipboard.writeText(selection);
      } else if (canInput()) {
        const text = await navigator.clipboard.readText();
        // Clipboard permission may settle after control is released or this run unmounts.
        if (terminalRef.current === terminal && canInput()) terminal.paste(text);
      }
    } catch {
      pushToast(t('runs.terminal.clipboardError'), { tone: 'error' });
    }
  }

  function find(direction: 'next' | 'previous'): void {
    const addon = searchAddonRef.current;
    if (!addon || searchTerm === '') return;
    const options = { decorations: searchDecorations() };
    if (direction === 'next') addon.findNext(searchTerm, options);
    else addon.findPrevious(searchTerm, options);
  }

  function changeSearchTerm(value: string): void {
    setSearchTerm(value);
    const addon = searchAddonRef.current;
    // Clearing the box must also clear the highlight: an empty term leaves the
    // addon's previous decorations behind.
    if (!addon) return;
    if (value === '') {
      addon.clearDecorations();
      setSearchResults(null);
      return;
    }
    addon.findNext(value, { incremental: true, decorations: searchDecorations() });
  }

  function closeSearch(): void {
    setSearchOpen(false);
    searchAddonRef.current?.clearDecorations();
    setSearchResults(null);
    terminalRef.current?.focus();
  }

  /**
   * Apply a font without tearing the terminal down: the options are writable at
   * runtime, but xterm re-measures its cells, so the viewport must be fitted
   * again and the new column count sent to the PTY when this page controls it.
   */
  function applyFont(family: string, size: number): void {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.fontFamily = terminalFontStack(family, resolveMonoStack());
    terminal.options.fontSize = size;
    requestAnimationFrame(() => {
      try { fitRef.current?.fit(); } catch { /* A hidden terminal is fitted on the next resize. */ }
      resize();
    });
  }

  function changeFontFamily(family: string): void {
    setFontFamily(family);
    saveTerminalFont({ family, size: fontSize });
    applyFont(family, fontSize);
  }

  function changeFontSize(value: string): void {
    // Keep the typed text even when it is not a usable size yet: clamping every
    // keystroke would turn "16" into "86" while the user is still typing.
    setFontSizeText(value);
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < MIN_TERMINAL_FONT_SIZE || parsed > MAX_TERMINAL_FONT_SIZE) return;
    setFontSize(parsed);
    saveTerminalFont({ family: fontFamily, size: parsed });
    applyFont(fontFamily, parsed);
  }

  function commitFontSize(): void {
    const size = clampFontSize(Number.parseInt(fontSizeText, 10));
    setFontSizeText(String(size));
    setFontSize(size);
    saveTerminalFont({ family: fontFamily, size });
    applyFont(fontFamily, size);
  }

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    disposedRef.current = false;
    const terminal = new Terminal({
      fontFamily: terminalFontStack(fontFamily, resolveMonoStack()), fontSize,
      lineHeight: 1.45, letterSpacing: 0,
      cursorBlink: interactive, disableStdin: true,
      // xterm 6 exposes `terminal.unicode` and search decorations as proposed
      // API; loading either addon without this flag throws during mount and
      // takes the whole React root down with it.
      allowProposedApi: true,
      // A PTY already emits CRLF; translating again changes full-screen cursor movement.
      convertEol: !interactive, scrollback: 10_000, theme: terminalTheme(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    fitRef.current = fit;
    terminal.open(host);
    fit.fit();
    terminalRef.current = terminal;
    if (execution) {
      // Derive the display from the saved invocation so old runs also show every parameter.
      const command = `${envPrefix(execution.paramValues ?? {})}${execution.commandDisplay}${execution.argv?.length ? ` ${quoteAll(execution.argv)}` : ''}`;
      // Parameter bytes are text here, never terminal control sequences or extra output lines.
      const display = command.replace(/[\x00-\x1f\x7f-\x9f]/g, (character) =>
        `\\x${character.charCodeAt(0).toString(16).padStart(2, '0')}`,
      );
      terminal.write(`${STREAM_PREFIX.system}$ ${display}${RESET}\r\n`);
    }
    // Search covers the local buffer (live output plus the replay window), not
    // output the server already dropped at MAX_LOG_BYTES.
    const search = new SearchAddon();
    terminal.loadAddon(search);
    searchAddonRef.current = search;
    const results = search.onDidChangeResults(({ resultIndex, resultCount }) => {
      setSearchResults({ index: resultIndex, count: resultCount });
    });
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = '11';
    terminal.loadAddon(new WebLinksAddon((_event, uri) => {
      // Output is script-controlled; the browser must not navigate to anything
      // but a normal web page, and the new tab must not keep an opener handle.
      if (/^https?:\/\//i.test(uri)) window.open(uri, '_blank', 'noopener,noreferrer');
    }));
    const keyboard = terminal.onData(sendInput);
    const dimensions = terminal.onResize(resize);
    // The browser's own find bar cannot reach xterm's buffer; take the shortcut
    // before it becomes bytes for the script.
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey
        && (event.code === 'KeyC' || event.code === 'KeyV')) {
        // Consume browser shortcuts so one paste cannot also trigger a native paste event.
        event.preventDefault();
        void clipboard(event.code === 'KeyC' ? 'copy' : 'paste', terminal);
        return false;
      }
      if (event.type === 'keydown' && event.ctrlKey && event.shiftKey && event.code === 'KeyF') {
        setSearchOpen(true);
        return false;
      }
      return true;
    });
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
      keyboard.dispose(); dimensions.dispose(); results.dispose(); unwatch();
      cancelAnimationFrame(frame); observer.disconnect(); terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      searchAddonRef.current = null;
    };
  }, [executionId, interactive]);

  useEffect(() => { updateInput(); }, [live]);
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

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
      // Older runners persisted a parameter-less header; replace only that exact first record.
      if (execution && chunk.seq === 1 && chunk.stream === 'system'
        && chunk.data === `$ ${execution.commandDisplay}\n`) return;
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
  const searchLabel = !searchResults ? ''
    : searchResults.count === 0 ? t('runs.terminal.searchNoResults')
      : searchResults.index >= 0 ? `${searchResults.index + 1}/${searchResults.count}`
        : `${searchResults.count}`;
  return (
    <div className={cn(
      'scanlines border-line bg-base shadow-card group/terminal relative overflow-hidden rounded-xl border',
      // Match only xterm's input focus so toolbar fields never suggest that keys reach the script.
      enabled && 'has-[.xterm-helper-textarea:focus]:border-accent has-[.xterm-helper-textarea:focus]:ring-2 has-[.xterm-helper-textarea:focus]:ring-accent/30',
    )}>
      <div className="border-line flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <span className="mr-auto">
          {enabled ? (
            <span className="text-accent text-meta hidden items-center gap-2 group-has-[.xterm-helper-textarea:focus]/terminal:inline-flex">
              <span className="bg-accent size-2 rounded-full" aria-hidden />
              {t('runs.terminal.focused')}
            </span>
          ) : null}
        </span>
        {interactive ? (
          <>
            <span role="status" className="text-mute text-meta">{!live && execution
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
          </>
        ) : <span className="mr-auto" />}
        {fontOpen ? (
          <div className="flex items-center gap-1.5">
            <TextInput
              value={fontFamily}
              list="terminal-font-families"
              aria-label={t('runs.terminal.font')}
              placeholder={t('runs.terminal.fontPlaceholder')}
              title={t('runs.terminal.fontHint')}
              onChange={(event) => changeFontFamily(event.target.value)}
              className="h-10 w-52 py-0 text-meta"
            />
            <datalist id="terminal-font-families">
              {TERMINAL_FONT_SUGGESTIONS.map((name) => <option key={name} value={name} />)}
            </datalist>
            <TextInput
              type="number"
              inputMode="numeric"
              min={MIN_TERMINAL_FONT_SIZE}
              max={MAX_TERMINAL_FONT_SIZE}
              value={fontSizeText}
              aria-label={t('runs.terminal.fontSize')}
              onChange={(event) => changeFontSize(event.target.value)}
              onBlur={commitFontSize}
              onKeyDown={(event) => {
                if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
              }}
              className="h-10 w-20 py-0 text-meta"
            />
            <IconButton label={t('runs.terminal.fontClose')} onClick={() => setFontOpen(false)}>
              <X className="size-4" aria-hidden />
            </IconButton>
          </div>
        ) : (
          <IconButton label={t('runs.terminal.font')} onClick={() => setFontOpen(true)}>
            <Type className="size-4" aria-hidden />
          </IconButton>
        )}
        {searchOpen ? (
          <div className="flex items-center gap-1.5">
            <TextInput
              ref={searchInputRef}
              value={searchTerm}
              aria-label={t('runs.terminal.search')}
              placeholder={t('runs.terminal.searchPlaceholder')}
              onChange={(event) => changeSearchTerm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  closeSearch();
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  find(event.shiftKey ? 'previous' : 'next');
                }
              }}
              className="h-10 w-56 py-0 text-meta"
            />
            <span aria-live="polite" className="text-mute text-meta min-w-14 text-center tabular-nums">{searchLabel}</span>
            <IconButton label={t('runs.terminal.searchPrevious')} onClick={() => find('previous')}>
              <ChevronUp className="size-4" aria-hidden />
            </IconButton>
            <IconButton label={t('runs.terminal.searchNext')} onClick={() => find('next')}>
              <ChevronDown className="size-4" aria-hidden />
            </IconButton>
            <IconButton label={t('runs.terminal.searchClose')} onClick={closeSearch}>
              <X className="size-4" aria-hidden />
            </IconButton>
          </div>
        ) : (
          <IconButton label={t('runs.terminal.search')} onClick={() => setSearchOpen(true)}>
            <Search className="size-4" aria-hidden />
          </IconButton>
        )}
        {!live && execution?.status === 'interrupted' ? (
          <p className="text-mute text-meta w-full">{t('runs.terminal.interruptedHint')}</p>
        ) : null}
        {inputError ? <p role="alert" className="text-danger text-meta w-full">{t('runs.terminal.inputError')}</p> : null}
      </div>
      <div ref={hostRef} aria-label={interactive ? t('runs.terminal.label') : undefined}
        className="h-[clamp(420px,72vh,1024px)] w-full px-4 py-3" />
    </div>
  );
}
