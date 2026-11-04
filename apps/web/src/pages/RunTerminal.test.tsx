import type { ExecutionLogChunk } from '@dashboard/shared';
import type { ExecutionStreamOptions } from '../api/useExecutionStream';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { RunTerminal } from './RunTerminal';

// Exercise terminal effect and output callbacks without a DOM/canvas runtime.
const harness = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  effects: [] as (() => (() => void) | void)[],
  stream: undefined as ExecutionStreamOptions | undefined,
  resize: undefined as (() => void) | undefined,
  frame: undefined as (() => void) | undefined,
  terminal: { open: vi.fn(), loadAddon: vi.fn(), write: vi.fn(), dispose: vi.fn() },
  fit: vi.fn(), observe: vi.fn(), disconnect: vi.fn(), cancelFrame: vi.fn(),
  construct: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useRef: (initial: unknown) => {
    const ref = { current: initial };
    harness.refs.push(ref);
    return ref;
  },
  useEffect: (effect: () => (() => void) | void) => { harness.effects.push(effect); },
}));
vi.mock('@xterm/xterm', () => ({ Terminal: vi.fn(function (options: unknown) {
  harness.construct(options);
  return harness.terminal;
}) }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: vi.fn(function () { return { fit: harness.fit }; }) }));
vi.mock('../api/useExecutionStream', () => ({ useExecutionStream: (options: ExecutionStreamOptions) => {
  harness.stream = options;
} }));

beforeEach(() => {
  vi.clearAllMocks();
  harness.refs = []; harness.effects = []; harness.stream = undefined;
  harness.resize = undefined; harness.frame = undefined;
  harness.fit.mockReset();
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
function mount(live = true, onStatus = vi.fn()): () => void {
  RunTerminal({ executionId: 'run', live, onStatus });
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
