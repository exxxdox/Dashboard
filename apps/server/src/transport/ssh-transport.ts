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

import type { Client as SshClient, ClientChannel, ConnectConfig } from 'ssh2';
import * as ssh2Namespace from 'ssh2';

import { PID_MARKER } from '@dashboard/shared';

import type { ExecOptions, ExecOutcome, Transport, TransportCheck } from './types.js';
import { writeStdin } from './write-stdin.js';

const ssh2 = (ssh2Namespace as unknown as { default?: typeof ssh2Namespace }).default ?? ssh2Namespace;
const { Client } = ssh2;

/** Grace period between SIGTERM and SIGKILL when stopping a process group. */
const KILL_GRACE_MS = 5_000;

/**
 * How long the pid marker may take to appear before we stop holding stderr back.
 * The wrapper prints it as its first statement, so anything beyond this means it
 * will never arrive.
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

        const values = parseKeyValues(probe.stdout);
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
      const startedAt = Date.now();
      const client = new Client();
      let remotePid: number | null = null;

      // Resolved once the command has settled, so a writer still waiting on a
      // `drain` stops instead of delaying the kill below and then hanging.
      let releaseWriter: () => void = () => undefined;
      const commandSettled = new Promise<void>((resolve) => {
        releaseWriter = resolve;
      });

      try {
        await connect(client, toConnectConfig(config));
        const channel = await openChannel(client, options.command);

        // Started but not awaited: the remote end cannot drain the channel
        // until we are reading it, so awaiting the write first would deadlock
        // on anything larger than the channel's window.
        const writing = writeStdin(channel, options.stdin ?? Buffer.alloc(0), {
          giveUp: commandSettled,
        });

        const outcome = await pump(channel, options, (pid) => {
          remotePid = pid;
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

        return { ...outcome, durationMs: Date.now() - startedAt, remotePid, stdinError };
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

type PumpResult = Omit<ExecOutcome, 'durationMs' | 'remotePid' | 'stdinError'>;

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
): Promise<PumpResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let canceled = false;
    let timedOut = false;
    let stderrBuffer = '';
    let stderrSeen = 0;
    let pidResolved = false;
    let timer: NodeJS.Timeout | null = null;

    const emitStderr = (data: string): void => {
      if (data !== '') options.onChunk({ stream: 'stderr', data });
    };

    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      options.signal.removeEventListener('abort', onAbort);
    };

    const settle = (result: PumpResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const onAbort = (): void => {
      canceled = true;
      settle({ exitCode: null, signal: 'TERM', canceled: true, timedOut: false });
    };

    channel.on('data', (buffer: Buffer) => {
      options.onChunk({ stream: 'stdout', data: buffer.toString('utf8') });
    });

    channel.stderr.on('data', (buffer: Buffer) => {
      const text = buffer.toString('utf8');

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

        const pid = Number.parseInt(stderrBuffer.slice(markerIndex + PID_MARKER.length, lineEnd), 10);
        if (Number.isSafeInteger(pid) && pid > 0) onPid(pid);

        const before = stderrBuffer.slice(0, markerIndex);
        const after = stderrBuffer.slice(lineEnd + 1);
        pidResolved = true;
        stderrBuffer = '';
        emitStderr(before);
        emitStderr(after);
        return;
      }

      // No marker yet. Past the window in which it could appear it never will,
      // so stop buffering and let stderr stream from here on.
      if (stderrSeen > PID_MARKER_WINDOW_BYTES) {
        pidResolved = true;
        const pending = stderrBuffer;
        stderrBuffer = '';
        emitStderr(pending);
      }
    });

    channel.on('close', (code: number | null, signal?: string | null) => {
      if (!pidResolved && stderrBuffer !== '') emitStderr(stderrBuffer);
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

    if (options.timeoutMs !== null) {
      timer = setTimeout(() => {
        timedOut = true;
        settle({ exitCode: null, signal: 'TERM', canceled: false, timedOut: true });
      }, options.timeoutMs);
    }
  });
}

/** Wrap ssh2's callback-based connect in a promise, guarding double settle. */
function connect(client: SshClient, config: ConnectConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    client.once('ready', () => {
      settled = true;
      resolve();
    });

    client.once('error', (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });

    try {
      client.connect(config);
    } catch (error) {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function openChannel(client: SshClient, command: string): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    client.exec(command, (error: Error | undefined, channel: ClientChannel) => {
      if (error) reject(error);
      else resolve(channel);
    });
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

/** Run a command, buffering its output. Used for probes and kill signals. */
function runCommand(
  client: SshClient,
  command: string,
  options: { timeoutMs: number },
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Remote command timed out')), options.timeoutMs);

    client.exec(command, (error: Error | undefined, channel: ClientChannel) => {
      if (error) {
        clearTimeout(timer);
        reject(error);
        return;
      }

      let stdout = '';
      let stderr = '';
      channel.on('data', (buffer: Buffer) => {
        stdout += buffer.toString('utf8');
      });
      channel.stderr.on('data', (buffer: Buffer) => {
        stderr += buffer.toString('utf8');
      });
      channel.on('close', (code: number | null) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code: typeof code === 'number' ? code : null });
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
