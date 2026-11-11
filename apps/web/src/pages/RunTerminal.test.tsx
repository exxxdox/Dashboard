import { renderToStaticMarkup } from 'react-dom/server';
import type { ExecutionLogChunk, ExecutionSummary } from '@dashboard/shared';
import type { ExecutionStreamOptions } from '../api/useExecutionStream';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { RunTerminal } from './RunTerminal';
import { pushToast } from '../lib/toast';

// Exercise terminal effect and output callbacks without a DOM/canvas runtime.
const harness = vi.hoisted(() => ({
  stateValues: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as (() => (() => void) | void)[],
  stream: undefined as ExecutionStreamOptions | undefined,
  resize: undefined as (() => void) | undefined,
  frame: undefined as (() => void) | undefined,
  data: undefined as ((data: string) => void) | undefined,
  terminal: {
    options: { disableStdin: true }, cols: 80, rows: 24, unicode: { activeVersion: '' },
    onData: vi.fn(), onResize: vi.fn(), open: vi.fn(), loadAddon: vi.fn(), write: vi.fn(),
    dispose: vi.fn(), attachCustomKeyEventHandler: vi.fn(), getSelection: vi.fn(), paste: vi.fn(),
  },
  search: {
    findNext: vi.fn(), findPrevious: vi.fn(), clearDecorations: vi.fn(),
    onDidChangeResults: vi.fn(() => ({ dispose: vi.fn() })),
  },
  links: {},
  unicode: {},
  link: undefined as ((event: MouseEvent, uri: string) => void) | undefined,
  fit: vi.fn(), observe: vi.fn(), disconnect: vi.fn(), cancelFrame: vi.fn(),
  construct: vi.fn(), send: vi.fn(), state: 'open', onState: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => [harness.stateValues.length ? harness.stateValues.shift() : initial, vi.fn()],
  useRef: (initial: unknown) => {
    const ref = { current: initial };
    harness.refs.push(ref);
    return ref;
  },
  useEffect: (effect: () => (() => void) | void) => { harness.effects.push(effect); },
}));
vi.mock('../lib/i18n', () => ({ useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => key + (params ? JSON.stringify(params) : '') }) }));
vi.mock('../lib/toast', () => ({ pushToast: vi.fn() }));
vi.mock('../api/ws', () => ({ executionSocket: { getState: () => harness.state, onStateChange: harness.onState, sendTerminal: harness.send } }));
vi.mock('@xterm/xterm', () => ({ Terminal: vi.fn(function (options: unknown) {
  harness.construct(options);
  return harness.terminal;
}) }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: vi.fn(function () { return { fit: harness.fit }; }) }));
vi.mock('@xterm/addon-search', () => ({ SearchAddon: vi.fn(function () { return harness.search; }) }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: vi.fn(function (handler: (event: MouseEvent, uri: string) => void) {
  harness.link = handler;
  return harness.links;
}) }));
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: vi.fn(function () { return harness.unicode; }) }));
vi.mock('../api/useExecutionStream', () => ({ useExecutionStream: (options: ExecutionStreamOptions) => {
  harness.stream = options;
} }));

beforeEach(() => {
  vi.clearAllMocks();
  harness.stateValues = [];
  harness.refs = []; harness.effects = []; harness.stream = undefined;
  harness.resize = undefined; harness.frame = undefined; harness.link = undefined;
  harness.fit.mockReset();
  harness.send.mockReturnValue(true);
  harness.onState.mockReturnValue(() => {});
  harness.terminal.write.mockImplementation((_data: string, done?: () => void) => done?.());
  harness.terminal.onData.mockImplementation((listener: (data: string) => void) => { harness.data = listener; return { dispose: vi.fn() }; });
  harness.terminal.onResize.mockReturnValue({ dispose: vi.fn() });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { harness.resize = callback; }
    observe = harness.observe;
    disconnect = harness.disconnect;
  });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { harness.frame = callback; return 7; });
  vi.stubGlobal('cancelAnimationFrame', harness.cancelFrame);
});
afterEach(() => vi.unstubAllGlobals());
function chunk(stream: ExecutionLogChunk['stream'], data: string): ExecutionLogChunk {
  return { executionId: 'run', seq: 1, stream, data, ts: '2026-01-01T00:00:00Z' };
}
function mount(live = true, onStatus = vi.fn(), interactive = false): () => void {
  RunTerminal({ executionId: 'run', live, onStatus, interactive });
  // React assigns the host ref before running the mount effect.
  harness.refs[0]!.current = {};
  return harness.effects[0]!() || (() => {});
}

test('opens a read-only terminal and passes live/history selection and status callback to the stream', () => {
  const onStatus = vi.fn();
  const cleanup = mount(false, onStatus);
  expect(harness.construct).toHaveBeenCalledWith(expect.objectContaining({ disableStdin: true, convertEol: true }));
  expect(harness.terminal.open).toHaveBeenCalledWith(harness.refs[0]!.current);
  expect(harness.observe).toHaveBeenCalledWith(harness.refs[0]!.current);
  expect(harness.stream).toMatchObject({ executionId: 'run', live: false, onStatus });
  cleanup();
});

test('preserves stdout bytes and distinguishes stderr and system output', () => {
  const cleanup = mount();
  harness.stream!.onChunk!(chunk('stdout', '\x1b[31mhello\n'));
  harness.stream!.onChunk!(chunk('stderr', 'failed\n'));
  harness.stream!.onChunk!(chunk('system', 'interrupted\n'));
  expect(harness.terminal.write.mock.calls).toEqual([
    ['\x1b[31mhello\n'], ['\x1b[38;5;210mfailed\n\x1b[0m'], ['\x1b[38;5;109minterrupted\n\x1b[0m'],
  ]);
  cleanup();
});

test('disposes the terminal and observer and ignores late stream output after unmount', () => {
  const cleanup = mount();
  harness.resize!();
  cleanup();
  harness.stream!.onChunk!(chunk('stdout', 'late'));
  expect(harness.terminal.write).not.toHaveBeenCalled();
  expect(harness.terminal.dispose).toHaveBeenCalledOnce();
  expect(harness.disconnect).toHaveBeenCalledOnce();
  expect(harness.cancelFrame).toHaveBeenLastCalledWith(7);
});

test('coalesces resize work and recovers when a hidden container cannot fit', () => {
  const cleanup = mount();
  expect(harness.fit).toHaveBeenCalledOnce();
  harness.resize!(); harness.resize!();
  expect(harness.fit).toHaveBeenCalledOnce();
  harness.fit.mockImplementationOnce(() => { throw new Error('zero-sized container'); });
  expect(() => harness.frame!()).not.toThrow();
  harness.resize!(); harness.frame!();
  expect(harness.fit).toHaveBeenCalledTimes(3);
  cleanup();
});

test('does not create a terminal when its host is missing', () => {
  RunTerminal({ executionId: 'run', live: true });
  expect(harness.effects[0]!()).toBeUndefined();
  harness.stream!.onChunk!(chunk('stdout', 'before mount'));
  expect(harness.construct).not.toHaveBeenCalled();
  expect(harness.terminal.write).not.toHaveBeenCalled();
});


test('only forwards keys after replay drains and control is granted; disconnect blocks immediately', () => {
  const cleanup = mount(true, vi.fn(), true);
  harness.stream!.onSyncChange!(true);
  harness.stream!.onTerminal!({ type: 'terminal_state', executionId: 'run', state: 'controlling' });
  harness.data!('secret');
  expect(harness.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'terminal_input' }));
  let drained: (() => void) | undefined;
  harness.terminal.write.mockImplementationOnce((_data: string, callback?: () => void) => { drained = callback; });
  harness.stream!.onSyncChange!(false);
  harness.data!('before drain');
  expect(harness.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'terminal_input' }));
  drained!();
  harness.data!('yes\r');
  expect(harness.send).toHaveBeenCalledWith({ type: 'terminal_input', executionId: 'run', data: 'yes\r' });
  const stateChanged = harness.onState.mock.calls[0]![0] as (state: string) => void;
  stateChanged('reconnecting');
  harness.send.mockClear(); harness.data!('never');
  expect(harness.send).not.toHaveBeenCalled();
  cleanup();
});

test('a busy viewer waits for an explicit request when the controller releases', () => {
  const cleanup = mount(true, vi.fn(), true);
  harness.stream!.onSyncChange!(false);
  harness.stream!.onTerminal!({ type: 'terminal_state', executionId: 'run', state: 'busy' });
  harness.send.mockClear();
  harness.stream!.onTerminal!({ type: 'terminal_state', executionId: 'run', state: 'available' });
  expect(harness.send).not.toHaveBeenCalledWith({ type: 'terminal_claim', executionId: 'run' });
  cleanup();
});


test.each(['succeeded', 'failed', 'timed_out', 'interrupted', 'canceled'] as const)('closed terminal explains %s and the exit result', (status) => {
  const execution = { status, exitCode: status === 'succeeded' ? 0 : 7, signal: null, errorMessage: null } as ExecutionSummary;
  const html = renderToStaticMarkup(RunTerminal({ executionId: 'run', live: false, interactive: true, execution }));
  expect(html).toContain('runs.terminal.finished');
  expect(html).toContain(status === 'timed_out' ? 'runs.status.timedOut' : `runs.status.${status}`);
  expect(html).toContain(status === 'succeeded' ? '0' : '7');
  if (status === 'interrupted') expect(html).toContain('runs.terminal.interruptedHint');
});

test('loads output search, link detection and Unicode 11 width handling', () => {
  const cleanup = mount();
  expect(harness.construct).toHaveBeenCalledWith(expect.objectContaining({ allowProposedApi: true }));
  const loaded = harness.terminal.loadAddon.mock.calls.map((call) => call[0]);
  expect(loaded).toContain(harness.search);
  expect(loaded).toContain(harness.links);
  expect(loaded).toContain(harness.unicode);
  expect(harness.terminal.unicode.activeVersion).toBe('11');
  expect(harness.search.onDidChangeResults).toHaveBeenCalledOnce();
  cleanup();
});

test('only opens http(s) links from terminal output', () => {
  const open = vi.fn();
  vi.stubGlobal('window', { open });
  const cleanup = mount();
  harness.link!({} as MouseEvent, 'javascript:alert(1)');
  harness.link!({} as MouseEvent, 'file:///etc/passwd');
  expect(open).not.toHaveBeenCalled();
  harness.link!({} as MouseEvent, 'https://example.com/docs');
  expect(open).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener,noreferrer');
  cleanup();
});

test('Ctrl+Shift+F opens search instead of reaching the script', () => {
  const cleanup = mount(true, vi.fn(), true);
  const handler = harness.terminal.attachCustomKeyEventHandler.mock.calls[0]![0] as (event: KeyboardEvent) => boolean;
  expect(handler({ type: 'keydown', ctrlKey: true, shiftKey: true, code: 'KeyF' } as KeyboardEvent)).toBe(false);
  expect(handler({ type: 'keydown', ctrlKey: true, shiftKey: false, code: 'KeyF' } as KeyboardEvent)).toBe(true);
  expect(handler({ type: 'keyup', ctrlKey: true, shiftKey: true, code: 'KeyF' } as KeyboardEvent)).toBe(true);
  cleanup();
});

test('offers search on a finished run that never accepted input', () => {
  const execution = { status: 'succeeded', exitCode: 0, signal: null, errorMessage: null } as ExecutionSummary;
  const html = renderToStaticMarkup(RunTerminal({ executionId: 'run', live: false, execution }));
  expect(html).toContain('runs.terminal.search');
  expect(html).toContain('runs.terminal.font');
});

test.each([false, true])('writes the complete command before replay, interactive=%s', (interactive) => {
  const execution = { status: 'succeeded', exitCode: 0, signal: null, errorMessage: null,
    commandDisplay: 'bash demo.sh', paramValues: { MODE: 'all ports' }, argv: ['50000', 'two words', '', "it's", '\x1b[2J', 'a\nb'] } as unknown as ExecutionSummary;
  const tree = RunTerminal({ executionId: 'run', live: false, execution, interactive });
  expect(renderToStaticMarkup(tree)).not.toContain('bash demo.sh');
  harness.refs[0]!.current = {};
  const cleanup = harness.effects[0]!();
  const header = harness.terminal.write.mock.calls[0]![0] as string;
  expect(header).toContain("MODE='all ports' bash demo.sh 50000 'two words' '' 'it");
  expect(header).toContain('\\x1b[2J');
  expect(header).toContain('a\\x0ab');
  expect(header).toContain('\r\n');
  expect(header).not.toContain('\x1b[2J');
  harness.terminal.write.mockClear();
  harness.stream!.onChunk!(chunk('system', '$ bash demo.sh\n'));
  expect(harness.terminal.write).not.toHaveBeenCalled();
  harness.stream!.onChunk!({ ...chunk('stdout', 'script output\n'), seq: 2 });
  expect(harness.terminal.write).toHaveBeenCalledWith('script output\n');
  cleanup?.();
});

test('keeps output and notices while showing the command once across resyncs', () => {
  const execution = { commandDisplay: 'bash demo.sh', paramValues: {}, argv: [] } as unknown as ExecutionSummary;
  RunTerminal({ executionId: 'run', live: false, execution });
  harness.refs[0]!.current = {};
  const cleanup = harness.effects[0]!();
  expect(harness.terminal.write).toHaveBeenCalledWith('\x1b[38;5;109m$ bash demo.sh\x1b[0m\r\n');
  harness.stream!.onSyncChange!(true);
  harness.stream!.onSyncChange!(false);
  harness.stream!.onSyncChange!(true);
  harness.stream!.onSyncChange!(false);
  expect(harness.terminal.write.mock.calls.filter(([data]) => String(data).includes('$ bash'))).toHaveLength(1);
  harness.terminal.write.mockClear();
  harness.stream!.onChunk!(chunk('stdout', '$ bash demo.sh\n'));
  harness.stream!.onChunk!({ ...chunk('system', '$ bash demo.sh\n'), seq: 2 });
  harness.stream!.onChunk!(chunk('system', 'interrupted\n'));
  expect(harness.terminal.write.mock.calls).toEqual([
    ['$ bash demo.sh\n'], ['\x1b[38;5;109m$ bash demo.sh\n\x1b[0m'], ['\x1b[38;5;109minterrupted\n\x1b[0m'],
  ]);
  cleanup?.();
});

test('applies the font family and size saved in this browser', () => {
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => key === 'dashboard.terminal.fontFamily' ? 'Fira Code'
        : key === 'dashboard.terminal.fontSize' ? '18' : null,
    },
  });
  const cleanup = mount();
  expect(harness.construct).toHaveBeenCalledWith(expect.objectContaining({
    fontFamily: 'Fira Code, monospace', fontSize: 18,
  }));
  cleanup();
});

test('falls back to the theme monospace stack when no font is saved', () => {
  const cleanup = mount();
  expect(harness.construct).toHaveBeenCalledWith(expect.objectContaining({
    fontFamily: 'monospace', fontSize: 14,
  }));
  cleanup();
});

function clipboardKey(code: string): KeyboardEvent {
  return { type: 'keydown', ctrlKey: true, shiftKey: true, code, preventDefault: vi.fn() } as unknown as KeyboardEvent;
}

test('copies the terminal selection with Ctrl+Shift+C and preserves Ctrl+C', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  harness.terminal.getSelection.mockReturnValue('selected output');
  const cleanup = mount(false);
  const handler = harness.terminal.attachCustomKeyEventHandler.mock.calls[0]![0] as (event: KeyboardEvent) => boolean;
  const event = clipboardKey('KeyC');
  expect(handler(event)).toBe(false);
  await Promise.resolve();
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(writeText).toHaveBeenCalledWith('selected output');
  expect(handler({ ...event, shiftKey: false } as KeyboardEvent)).toBe(true);
  cleanup();
});

test('pastes through xterm only while controlling and rechecks after clipboard read', async () => {
  const readText = vi.fn().mockResolvedValue('hello\nworld');
  vi.stubGlobal('navigator', { clipboard: { readText } });
  const cleanup = mount(true, vi.fn(), true);
  const handler = harness.terminal.attachCustomKeyEventHandler.mock.calls[0]![0] as (event: KeyboardEvent) => boolean;
  expect(handler(clipboardKey('KeyV'))).toBe(false);
  expect(readText).not.toHaveBeenCalled();
  harness.stream!.onSyncChange!(false);
  harness.stream!.onTerminal!({ type: 'terminal_state', executionId: 'run', state: 'controlling' });
  handler(clipboardKey('KeyV'));
  await Promise.resolve();
  expect(harness.terminal.paste).toHaveBeenCalledWith('hello\nworld');
  harness.terminal.paste.mockClear();
  handler(clipboardKey('KeyV'));
  harness.stream!.onTerminal!({ type: 'terminal_state', executionId: 'run', state: 'busy' });
  await Promise.resolve();
  expect(harness.terminal.paste).not.toHaveBeenCalled();
  cleanup();
});

test('reports denied clipboard access without an unhandled rejection', async () => {
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
  harness.terminal.getSelection.mockReturnValue('output');
  const cleanup = mount(false);
  const handler = harness.terminal.attachCustomKeyEventHandler.mock.calls[0]![0] as (event: KeyboardEvent) => boolean;
  handler(clipboardKey('KeyC'));
  await Promise.resolve();
  expect(pushToast).toHaveBeenCalledWith('runs.terminal.clipboardError', { tone: 'error' });
  cleanup();
});

test('discards a pending paste when the terminal is unmounted', async () => {
  vi.stubGlobal('navigator', { clipboard: { readText: vi.fn().mockResolvedValue('late paste') } });
  const cleanup = mount(true, vi.fn(), true);
  harness.stream!.onSyncChange!(false);
  harness.stream!.onTerminal!({ type: 'terminal_state', executionId: 'run', state: 'controlling' });
  const handler = harness.terminal.attachCustomKeyEventHandler.mock.calls[0]![0] as (event: KeyboardEvent) => boolean;
  handler(clipboardKey('KeyV'));
  cleanup();
  await Promise.resolve();
  expect(harness.terminal.paste).not.toHaveBeenCalled();
});


test.each([
  ['controlling', false, true, true, true, true],
  ['busy', false, true, true, true, false],
  ['controlling', true, true, true, true, false],
  ['controlling', false, false, true, true, false],
  ['controlling', false, true, false, true, false],
  ['controlling', false, true, true, false, false],
] as const)('focus feedback follows input readiness %s/%s/%s/%s/%s', (owner, syncing, connected, live, interactive, ready) => {
  harness.stateValues = [owner, syncing, connected];
  const html = renderToStaticMarkup(RunTerminal({ executionId: 'run', live, interactive }));
  expect(html.includes('runs.terminal.focused')).toBe(ready);
  expect(html.includes('has-[.xterm-helper-textarea:focus]:border-accent')).toBe(ready);
});
