import type { TerminalControl } from './types.js';

type TerminalSink = {
  readonly writableLength: number;
  readonly writable: boolean;
  readonly destroyed: boolean;
  write(data: Buffer): boolean;
  setWindow(rows: number, cols: number, height: number, width: number): void;
  on(event: 'drain' | 'close', listener: () => void): unknown;
  off(event: 'drain' | 'close', listener: () => void): unknown;
};

/** Bound both our queue and ssh2's writable buffer; rejected input is never replayed. */
export function createTerminalInput(channel: TerminalSink): TerminalControl & { close(): void } {
  const pending: Buffer[] = [];
  let bytes = 0;
  let blocked = false;
  let closed = false;
  const close = (): void => {
    closed = true;
    pending.length = 0;
    bytes = 0;
    channel.off('drain', drain);
    channel.off('close', close);
  };
  const drain = (): void => {
    blocked = false;
    while (!closed && !blocked && pending.length > 0) {
      const data = pending.shift();
      if (!data) break;
      bytes -= data.length;
      try { blocked = !channel.write(data); } catch { close(); }
    }
  };
  channel.on('drain', drain);
  channel.on('close', close);
  return {
    write(data) {
      const buffer = Buffer.from(data, 'utf8');
      if (closed || channel.destroyed || !channel.writable ||
        buffer.length + bytes + channel.writableLength > 64 * 1024) return false;
      pending.push(buffer);
      bytes += buffer.length;
      if (!blocked) drain();
      return !closed;
    },
    resize(cols, rows) {
      if (closed || channel.destroyed || !Number.isInteger(cols) || !Number.isInteger(rows) ||
        cols < 2 || rows < 2 || cols > 500 || rows > 500) return;
      try { channel.setWindow(rows, cols, 0, 0); } catch { close(); }
    },
    close,
  };
}
