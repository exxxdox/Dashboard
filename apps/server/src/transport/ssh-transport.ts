/**
 * SSH transport: runs commands on the host that owns the script directory.
 *
 * One connection per execution. Pooling would save a handshake per run, but
 * executions last seconds to minutes and cancellation needs a *live* connection
 * to send the kill on, so the connection is owned by the call and closed when
 * the run ends.
 *
 * ssh2 is CommonJS and assigns its exports as an object literal, which Node's
 * named-export detection cannot see through. Taking the namespace and falling
 * back to `.default` works under both the ESM and the CJS view.
 */

import { StringDecoder } from 'node:string_decoder';

import type { Client as SshClient, ClientChannel, ConnectConfig } from 'ssh2';
import * as ssh2Namespace from 'ssh2';

import { PID_MARKER } from '@dashboard/shared';

import type { ExecOptions, ExecOutcome, Transport, TransportCheck } from './types.js';
import { writeStdin } from './write-stdin.js';
import { createTerminalInput } from './terminal-input.js';

const ssh2 = (ssh2Namespace as unknown as { default?: typeof ssh2Namespace }).default ?? ssh2Namespace;
const { Client } = ssh2;

/** Grace period between SIGTERM and SIGKILL when stopping a process group. */
const KILL_GRACE_MS = 5_000;

/**
 * Buffer a small initial stderr window, then stream shell banners while keeping
 * enough trailing bytes to recognize a later pid marker.
 */
const PID_MARKER_WINDOW_BYTES = 512;

/** How long the post-run cleanup command may take before it is abandoned. */
const CLEANUP_TIMEOUT_MS = 5_000;

export type SshTransportConfig = {
  host: string;
  port: number;
  username: string;
  auth:
    | { method: 'key'; privateKey: string; passphrase?: string }
    | { method: 'password'; password: string };
  connectTimeoutSec: number;
  /** Expected host key, hex encoded. Checked when supplied. */
  hostFingerprint?: string | null;
};

function toConnectConfig(config: SshTransportConfig): ConnectConfig {
  const base: ConnectConfig = {
    host: config.host,
    port: config.port,
    username: config.username,
    readyTimeout: config.connectTimeoutSec * 1000,
  };

  // Without a verifier ssh2 accepts any host key, which would make the
  // credentials we send interceptable by anyone on the network path.
  if (config.hostFingerprint) {
    const expected = config.hostFingerprint;
    base.hostVerifier = (key: Buffer): boolean => key.toString('hex') === expected;
  }

  if (config.auth.method === 'key') {
    return { ...base, privateKey: config.auth.privateKey, passphrase: config.auth.passphrase };
  }
  return { ...base, password: config.auth.password };
}

export function createSshTransport(config: SshTransportConfig): Transport {
  return {
    kind: 'ssh',

    async check(): Promise<TransportCheck> {
      const startedAt = Date.now();
      const client = new Client();

      try {
        await connect(client, toConnectConfig(config));
        const latencyMs = Date.now() - startedAt;

        // One round trip reports the login shell, the effective user, and
        // whether process-group termination will work.
        const probe = await runCommand(
          client,
          'printf "shell=%s\\n" "${BASH_VERSION:-unknown}"; ' +
            'printf "user=%s\\n" "$(id -un 2>/dev/null || echo unknown)"; ' +
            'if command -v setsid >/dev/null 2>&1; then echo "setsid=yes"; else echo "setsid=no"; fi',
          { timeoutMs: 15_000 },
        );

        const values = parseKeyValues(probe);
        const shellVersion = values.get('shell');
        return {
          reachable: true,
          latencyMs,
          detail: 'Connected',
          shell: shellVersion && shellVersion !== 'unknown' ? `bash ${shellVersion}` : 'sh',
          user: values.get('user') ?? null,
          hasSetsid: values.get('setsid') === 'yes',
        };
      } catch (error) {
        return {
          reachable: false,
          latencyMs: null,
          detail: error instanceof Error ? error.message : String(error),
          shell: null,
          user: null,
          hasSetsid: false,
        };
      } finally {
        client.end();
      }
    },

    async exec(options: ExecOptions): Promise<ExecOutcome> {
      if (options.terminal) return execTerminal(config, options);
      const client = new Client();
      let remotePid: number | null = null;

      // Resolved once the command has settled, so a writer still waiting on a
      // `drain` stops instead of delaying the kill below and then hanging.
      let releaseWriter: () => void = () => undefined;
      const commandSettled = new Promise<void>((resolve) => {
        releaseWriter = resolve;
      });

      try {
        await connect(client, toConnectConfig(config), options.signal);
        if (options.signal.aborted) return { exitCode: null, signal: 'TERM', canceled: true, timedOut: false, stdinError: null };
        const channel = await openChannel(client, options.command, options.signal);

        // A payload is released only after the wrapper reports its killable
        // process group. The confirmation newline prevents EOF after cancellation
        // from invoking a custom interpreter against an empty file.
        let writing = Promise.resolve<string | null>(null);
        if (options.stdin === undefined) {
          writing = writeStdin(channel, Buffer.alloc(0), { giveUp: commandSettled });
        }
        const outcome = await pump(channel, options, (pid) => {
          remotePid = pid;
          if (options.stdin !== undefined && !options.signal.aborted) {
            writing = writeStdin(channel, Buffer.concat([Buffer.from('\n'), options.stdin]), { giveUp: commandSettled });
          }
        });
        releaseWriter();

        // The channel is already closing, so stopping the script has to be a
        // separate command -- issued on the same authenticated connection.
        if ((outcome.canceled || outcome.timedOut) && remotePid !== null) {
          await killProcessGroup(client, remotePid).catch(() => undefined);
        }

        // After the kill, so a process group that survived cannot recreate what
        // this removes. Best effort: a failure leaks a directory, and reporting
        // that as a run failure would be worse than the leak.
        if (options.cleanupCommand !== undefined) {
          await runCommand(client, options.cleanupCommand, { timeoutMs: CLEANUP_TIMEOUT_MS }).catch(
            () => undefined,
          );
        }

        const stdinError = await writing;

        return { ...outcome, stdinError };
      } catch (error) {
        if (options.signal.aborted) {
          return { exitCode: null, signal: 'TERM', canceled: true, timedOut: false, stdinError: null };
        }
        throw error;
      } finally {
        releaseWriter();
        client.end();
      }
    },

    async dispose(): Promise<void> {
      // Nothing is retained between calls, so there is nothing to release.
    },
  };
}

/** A PTY cannot carry the upload: canonical mode would rewrite and echo its bytes. */
async function execTerminal(config: SshTransportConfig, options: ExecOptions): Promise<ExecOutcome> {
  const client = new Client();
  const deadline = new AbortController();
  const signal = AbortSignal.any([options.signal, deadline.signal]);
  const timer = options.timeoutMs === null ? null : setTimeout(() => deadline.abort(), options.timeoutMs);
  let remotePid: number | null = null;
  let input: ReturnType<typeof createTerminalInput> | undefined;
  let releaseWriter: () => void = () => undefined;
  const commandSettled = new Promise<void>((resolve) => { releaseWriter = resolve; });
  const interrupted = (): ExecOutcome => ({
    exitCode: null, signal: 'TERM', canceled: options.signal.aborted,
    timedOut: !options.signal.aborted && deadline.signal.aborted, stdinError: null,
  });
  let connected = false;
  let completed = false;
  try {
    await connect(client, toConnectConfig(config), signal);
    connected = true;
    if (signal.aborted) return interrupted();
    const terminal = options.terminal;
    if (!terminal) throw new Error('Missing terminal options');
    const upload = await openChannel(client, terminal.uploadCommand, signal);
    let writing = Promise.resolve<string | null>(null);
    const uploaded = await pump(upload, { ...options, signal, timeoutMs: null }, (pid) => {
      remotePid = pid;
      if (!signal.aborted) {
        writing = writeStdin(upload, Buffer.concat([Buffer.from('\n'), options.stdin ?? Buffer.alloc(0)]), { giveUp: commandSettled });
      }
    });
    releaseWriter();
    const stdinError = remotePid === null ? 'The host did not confirm script delivery' : await writing;
    completed = !signal.aborted && uploaded.exitCode !== null;
    if (signal.aborted) return interrupted();
    if (uploaded.exitCode !== 0 || stdinError !== null) return { ...uploaded, stdinError };
    remotePid = null;
    completed = false;
    const channel = await openChannel(client, options.command, signal, true);
    const outcome = await pump(channel, { ...options, signal, timeoutMs: null }, (pid) => {
      remotePid = pid;
      if (signal.aborted) return;
      channel.write(Buffer.from('\n'));
      input = createTerminalInput(channel);
      terminal.onReady(input);
    }, true);
    completed = !signal.aborted && (outcome.exitCode !== null || outcome.signal !== null);
    return signal.aborted ? interrupted() : { ...outcome, stdinError: null };
  } catch (error) {
    if (signal.aborted) return interrupted();
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    input?.close();
    releaseWriter();
    if (connected && !completed && remotePid !== null) {
      await killProcessGroup(client, remotePid).catch(() => undefined);
    }
    if (connected && options.cleanupCommand !== undefined) {
      await runCommand(client, options.cleanupCommand, { timeoutMs: CLEANUP_TIMEOUT_MS }).catch(() => undefined);
    }
    client.end();
  }
}

type PumpResult = Omit<ExecOutcome, 'stdinError'>;

/**
 * Stream a channel's output until it closes, its aborts, or it times out.
 *
 * The pid marker is stripped here rather than in the runner: it is an artefact
 * of this transport's wrapper, so no other transport should have to know it
 * exists.
 */
function pump(
  channel: ClientChannel,
  options: ExecOptions,
  onPid: (pid: number) => void,
  markerOnStdout = false,
): Promise<PumpResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let canceled = false;
    let timedOut = false;
    // SSH chunks split bytes arbitrarily; each stream must retain its own partial UTF-8 character.
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let stderrBuffer = '';
    let stderrSeen = 0;
    let pidResolved = false;
    let timer: NodeJS.Timeout | null = null;

    const emit: ExecOptions['onChunk'] = (chunk) => {
      try {
        options.onChunk(chunk);
      } catch {
        // A failed output consumer must not interrupt SSH reads or prevent the run from settling.
      }
    };

    const emitStderr = (data: string): void => {
      if (data !== '') emit({ stream: markerOnStdout ? 'stdout' : 'stderr', data });
    };

    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      options.signal.removeEventListener('abort', onAbort);
    };

    const settle = (result: PumpResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      const stdoutTail = stdoutDecoder.end();
      if (stdoutTail !== '') emit({ stream: 'stdout', data: stdoutTail });
      emitStderr(stderrBuffer + stderrDecoder.end());
      stderrBuffer = '';
      resolve(result);
    };

    const onAbort = (): void => {
      canceled = true;
      settle({ exitCode: null, signal: 'TERM', canceled: true, timedOut: false });
    };

    const consumeMarker = (text: string): void => {
      if (pidResolved) {
        emitStderr(text);
        return;
      }

      stderrBuffer += text;
      stderrSeen += text.length;

      const markerIndex = stderrBuffer.indexOf(PID_MARKER);
      if (markerIndex !== -1) {
        const lineEnd = stderrBuffer.indexOf('\n', markerIndex);
        if (lineEnd === -1) {
          // Marker seen but its line is still incomplete. Emit what precedes it
          // and keep only the partial marker buffered.
          if (markerIndex > 0) {
            emitStderr(stderrBuffer.slice(0, markerIndex));
            stderrBuffer = stderrBuffer.slice(markerIndex);
          }
          return;
        }

        const rawPid = stderrBuffer.slice(markerIndex + PID_MARKER.length, lineEnd).replace(/\r$/, '');
        const pid = /^\d+$/.test(rawPid) ? Number(rawPid) : 0;
        if (Number.isSafeInteger(pid) && pid > 0) {
          try { onPid(pid); }
          catch (error) { settled = true; cleanup(); reject(error); return; }
        }

        const before = stderrBuffer.slice(0, markerIndex);
        const after = stderrBuffer.slice(lineEnd + 1);
        pidResolved = true;
        stderrBuffer = '';
        emitStderr(before);
        emitStderr(after);
        return;
      }

      // Shell banners can precede the marker. Stream their bytes while retaining
      // only enough tail to recognize a marker split across SSH chunks.
      if (stderrSeen > PID_MARKER_WINDOW_BYTES) {
        const tail = PID_MARKER.length - 1;
        emitStderr(stderrBuffer.slice(0, -tail));
        stderrBuffer = stderrBuffer.slice(-tail);
      }
    };

    channel.on('data', (buffer: Buffer) => {
      if (settled) return;
      const data = stdoutDecoder.write(buffer);
      if (markerOnStdout) consumeMarker(data);
      else if (data !== '') emit({ stream: 'stdout', data });
    });
    channel.stderr.on('data', (buffer: Buffer) => {
      if (settled) return;
      const data = stderrDecoder.write(buffer);
      if (markerOnStdout) {
        if (data !== '') emit({ stream: 'stdout', data });
      } else consumeMarker(data);
    });

    channel.on('close', (code: number | null, signal?: string | null) => {
      settle({
        exitCode: typeof code === 'number' ? code : null,
        signal: signal ?? null,
        canceled,
        timedOut,
      });
    });

    channel.on('error', (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });

    if (options.signal.aborted) {
      onAbort();
    } else {
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    if (!settled && options.timeoutMs !== null) {
      timer = setTimeout(() => {
        timedOut = true;
        settle({ exitCode: null, signal: 'TERM', canceled: false, timedOut: true });
      }, options.timeoutMs);
    }
  });
}

/** Wrap ssh2's callback-based connect in a promise, guarding double settle. */
function connect(client: SshClient, config: ConnectConfig, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      reject(new Error('SSH connection canceled'));
    };
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort, { once: true });

    client.once('ready', () => {
      signal?.removeEventListener('abort', onAbort);
      if (settled) return;
      settled = true;
      resolve();
    });

    client.once('error', (error: Error) => {
      signal?.removeEventListener('abort', onAbort);
      if (settled) return;
      settled = true;
      reject(error);
    });

    try {
      client.connect(config);
    } catch (error) {
      signal?.removeEventListener('abort', onAbort);
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function openChannel(client: SshClient, command: string, signal: AbortSignal, terminal = false): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(new Error('SSH channel canceled'));
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener('abort', onAbort, { once: true });
    const opened = (error: Error | undefined, channel: ClientChannel): void => {
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else if (signal.aborted) { channel.close?.(); onAbort(); }
      else resolve(channel);
    };
    if (terminal) client.exec(command, { pty: { term: 'xterm-256color', cols: 80, rows: 24 } }, opened);
    else client.exec(command, opened);
  });
}

/**
 * Terminate the remote process group.
 *
 * The negative pid targets the whole group, which is why the wrapper runs the
 * script under `setsid`: without it, a script that spawns `curl` would leave
 * that child running after the shell dies. SIGKILL follows SIGTERM so a script
 * trapping TERM still stops.
 */
async function killProcessGroup(client: SshClient, pid: number): Promise<void> {
  const safePid = Math.trunc(pid);
  if (!Number.isSafeInteger(safePid) || safePid <= 0) return;

  const signal = (name: string): string =>
    `kill -${name} -${safePid} 2>/dev/null || kill -${name} ${safePid} 2>/dev/null || true`;

  await runCommand(client, signal('TERM'), { timeoutMs: 5_000 }).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, KILL_GRACE_MS));
  await runCommand(client, signal('KILL'), { timeoutMs: 5_000 }).catch(() => undefined);
}

/**
 * Run a command, buffering its stdout. Used for probes and kill signals, where
 * the only thing read back is the output -- a kill reports success by closing
 * the channel, and a probe reports by what it printed.
 */
function runCommand(client: SshClient, command: string, options: { timeoutMs: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Remote command timed out')), options.timeoutMs);

    client.exec(command, (error: Error | undefined, channel: ClientChannel) => {
      if (error) {
        clearTimeout(timer);
        reject(error);
        return;
      }

      let stdout = '';
      const decoder = new StringDecoder('utf8');
      channel.on('data', (buffer: Buffer) => {
        stdout += decoder.write(buffer);
      });
      channel.on('close', () => {
        clearTimeout(timer);
        resolve(stdout + decoder.end());
      });
    });
  });
}

/** Parse `key=value` lines emitted by the probe command. */
function parseKeyValues(output: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of output.split('\n')) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return values;
}
