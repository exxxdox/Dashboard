/**
 * The execution transport boundary.
 *
 * Everything above this interface assumes only "run this command string on the
 * machine that owns the scripts, stream its output, be able to stop it". The
 * SSH implementation is the only one shipped today; a host agent that avoids
 * needing sshd, or a local transport for running the container on the target
 * itself, can be added without touching the runner, the queue, or the routes.
 */

export type ExecStream = 'stdout' | 'stderr';

export type ExecChunk = {
  stream: ExecStream;
  data: string;
};

export type ExecOptions = {
  /** Raw POSIX shell string, already assembled and quoted by the runner. */
  command: string;
  /**
   * Written to the command's stdin, then EOF. This is how a script reaches a
   * host that does not already have it on disk, so implementations must deliver
   * it concurrently with reading output: waiting for the write first would
   * deadlock against a channel window the remote end has not started draining.
   */
  stdin?: Buffer;
  /**
   * Run on the same connection once the command has settled, whatever the
   * outcome. Removes the directory a run staged itself into; issuing it as a
   * separate exec would open a second connection for every run.
   */
  cleanupCommand?: string;
  /**
   * Invoked as output arrives. Implementations must not let a throw from this
   * callback abort the read loop, so they wrap it.
   */
  onChunk: (chunk: ExecChunk) => void;
  /** Aborting terminates the remote process group. */
  signal: AbortSignal;
  /** Wall-clock limit for the whole command; null means no limit. */
  timeoutMs: number | null;
};

export type ExecOutcome = {
  /** Exit status reported by the remote process; null when it was signalled. */
  exitCode: number | null;
  /** Terminating signal name, e.g. "TERM"; null on a normal exit. */
  signal: string | null;
  canceled: boolean;
  timedOut: boolean;
  /**
   * Non-null when the stdin payload could not be delivered in full. Without it
   * a connection dropped mid-push is indistinguishable from a script that
   * exited non-zero without saying why.
   */
  stdinError: string | null;
};

export type TransportCheck = {
  reachable: boolean;
  latencyMs: number | null;
  /** Human-readable detail for the UI, e.g. the connect error. */
  detail: string;
  /** Remote login shell banner, e.g. "bash 5.2.15". */
  shell: string | null;
  /** Remote user the commands will run as. */
  user: string | null;
  /**
   * Whether `setsid` exists. Without it a canceled execution can only be killed
   * by pid, so grandchildren may survive.
   */
  hasSetsid: boolean;
};

export type Transport = {
  readonly kind: string;
  /** Probe connectivity and report what the remote environment offers. */
  check(): Promise<TransportCheck>;
  /** Run one command to completion. Never rejects for a non-zero exit code. */
  exec(options: ExecOptions): Promise<ExecOutcome>;
  /** Release pooled resources. Safe to call more than once. */
  dispose(): Promise<void>;
};
