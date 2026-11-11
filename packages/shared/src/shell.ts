/**
 * POSIX shell command construction for remote execution.
 *
 * Everything the user can influence (script path, arguments, environment
 * values) passes through `quote()` before it reaches a command string. The
 * remote target is a Linux host reached over SSH, so we target POSIX sh
 * semantics and never rely on the remote having bash for the wrapper itself.
 */

/** Characters that are safe to pass through unquoted in POSIX sh. */
const SAFE_UNQUOTED = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** Environment variable names we are willing to emit an assignment for. */
const VALID_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Marker line the remote wrapper prints on stderr so we can find the PGID. */
export const PID_MARKER = '__SD_PID__=';

/**
 * Wrap a value in single quotes for POSIX sh. Single quotes suppress every
 * expansion, so the only character needing care is the single quote itself,
 * which is closed, escaped, and reopened: ' becomes '\''
 */
export function quote(value: string): string {
  if (value === '') return "''";
  if (SAFE_UNQUOTED.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Quote a list of arguments, space separated. */
export function quoteAll(values: readonly string[]): string {
  return values.map(quote).join(' ');
}

/**
 * Build the `KEY=value` prefix for a command.
 *
 * Rejects names that are not valid shell identifiers: an attacker-controlled
 * key such as `A; rm -rf /` would otherwise escape the assignment and run as
 * its own command.
 */
export function envPrefix(env: Record<string, string>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!VALID_ENV_NAME.test(key)) {
      throw new Error(`Invalid environment variable name: ${JSON.stringify(key)}`);
    }
    parts.push(`${key}=${quote(value)}`);
  }
  return parts.length > 0 ? `${parts.join(' ')} ` : '';
}

/** A resolved Bash invocation, including an optional explicit executable override. */
export type InterpreterSpec = {
  /** argv[0] and any fixed flags. The script path is appended after these. */
  argv: string[];
  /** Shown in the UI so the user knows what will actually run. */
  label: string;
};

/** Resolve supported scripts before considering a stored executable override. */
export function resolveInterpreter(extension: string, override?: readonly string[] | null, _interactive = false): InterpreterSpec {
  // Legacy overrides must not make a retired script format runnable again.
  if (extension.toLowerCase() !== '.sh') {
    throw new Error(`Unsupported script extension: ${JSON.stringify(extension)}`);
  }
  if (override && override.length > 0) {
    return { argv: [...override], label: override.join(' ') };
  }
  return { argv: ['bash'], label: 'bash' };
}

export type BuildCommandInput = {
  interpreter: InterpreterSpec;
  /**
   * Absolute path on the host the interpreter is given. The script's bytes are
   * written here from stdin after a confirmation newline, so the host does not
   * have the file beforehand.
   */
  scriptPath: string;
  /**
   * Absolute directory on the host the script is staged into. Created before
   * the write and removed after the run; the target never keeps a copy.
   */
  stagingDir: string;
  /** Positional arguments. Values are passed as environment, not argv, by default. */
  args?: readonly string[];
  /** Working directory on the target host. */
  cwd: string;
  env?: Record<string, string>;
};

export type BuiltCommand = {
  /** Raw POSIX shell string handed to the transport. */
  command: string;
  /** Human-readable equivalent for display and audit; no wrapper plumbing. */
  display: string;
};

/**
 * Assemble the command that runs a script on the target host.
 *
 * The wrapper exists for one reason: cancellation. SSH gives us a channel, not
 * a process handle, so we need the remote process group id before we can kill
 * the script *and every child it spawns*. `setsid` puts the script in its own
 * session, making its pid equal to the group id; the marker line publishes that
 * pid on stderr before `exec` replaces the shell. Killing `-PGID` then reaches
 * the whole tree.
 *
 * `setsid` ships with util-linux, which is present on essentially every Linux
 * distribution but not guaranteed. It is probed at run time rather than assumed,
 * because an unconditional `setsid ...` would turn a missing binary into a
 * command-not-found failure for every script on that host. The fallback still
 * publishes the pid, so cancellation degrades to killing the process alone
 * instead of its whole group.
 *
 * The script's bytes reach the host on stdin and are written into `stagingDir`
 * before anything runs. The dashboard is the single source of truth for script
 * content; the target keeps no copy, so there is nothing to drift out of sync
 * with what the UI showed.
 */
export function buildCommand(input: BuildCommandInput): BuiltCommand {
  const { interpreter, scriptPath, args = [], stagingDir, cwd, env = {} } = input;

  const argv = [...interpreter.argv, scriptPath, ...args];
  // stdin is the delivery channel, so the script is given /dev/null rather than
  // a stream that is already at EOF by the time it runs. Making that explicit
  // also removes any dependency on how `setsid` passes stdio through.
  const invoke = `cd ${quote(cwd)} && exec ${quoteAll(argv)} < /dev/null`;

  const display = `${envPrefixDisplay(env)}${invoke}`;

  // Publish the group before reading stdin: the transport withholds all script
  // bytes until this handshake, so cancellation can never race an unknown pid.
  const inner =
    `printf '%s%s\\n' ${quote(PID_MARKER)} "$$" >&2; ` +
    // EOF before confirmation must never invoke even a custom interpreter.
    `(IFS= read -r _sd_delivery) && ` +
    `(umask 077 && mkdir -p ${quote(stagingDir)}) && ` +
    `(umask 077 && cat > ${quote(scriptPath)}) && ${invoke}`;
  const quotedInner = quote(inner);

  // The delivery process and script share one group, so cancellation also stops
  // an upload waiting on stdin. Keep the guarded write before the interpreter.
  const assignments = envPrefix(env);
  const command =
    `if command -v setsid >/dev/null 2>&1; ` +
    `then ${assignments}setsid -w sh -c ${quotedInner}; ` +
    `else ${assignments}sh -c ${quotedInner}; fi`;

  return { command, display };
}

/** Stage outside the PTY so script bytes never become terminal input or echo. */
export function buildInteractiveCommand(input: BuildCommandInput): BuiltCommand & { uploadCommand: string } {
  const { interpreter, scriptPath, args = [], stagingDir, cwd, env = {} } = input;
  const invoke = `cd ${quote(cwd)} && exec ${quoteAll([...interpreter.argv, scriptPath, ...args])}`;
  const upload =
    `printf '%s%s\\n' ${quote(PID_MARKER)} "$$" >&2; ` +
    `(IFS= read -r _sd_delivery) && ` +
    `(umask 077 && mkdir -p ${quote(stagingDir)}) && ` +
    `(umask 077 && cat > ${quote(scriptPath)})`;
  const uploadCommand = `if command -v setsid >/dev/null 2>&1; ` +
    `then setsid -w sh -c ${quote(upload)}; else sh -c ${quote(upload)}; fi`;
  // exec preserves sshd's controlling terminal and process group for terminal signals.
  const run = `stty -echo && printf '%s%s\\n' ${quote(PID_MARKER)} "$$" >&2; ` +
    // EOF before confirmation must not invoke even a custom interpreter.
    `(IFS= read -r _sd_start) && stty echo && ${invoke}`;
  return {
    uploadCommand,
    command: `${envPrefix(env)}exec sh -c ${quote(run)}`,
    display: `${envPrefixDisplay(env)}${invoke}`,
  };
}

/**
 * Remove a staging directory once a run is over.
 *
 * `--` terminates option parsing: the path is composed by the server, but one
 * beginning with `-` would otherwise be read as flags to `rm`.
 */
export function cleanupStagingCommand(stagingDir: string): string {
  return `rm -rf -- ${quote(stagingDir)}`;
}

/** Renders the env prefix for display only; values may contain anything. */
function envPrefixDisplay(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${quote(value)} `)
    .join('');
}
