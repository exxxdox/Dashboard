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

/** A resolved interpreter invocation, e.g. ['bash'] or ['pwsh','-NoProfile']. */
export type InterpreterSpec = {
  /** argv[0] and any fixed flags. The script path is appended after these. */
  argv: string[];
  /** Shown in the UI so the user knows what will actually run. */
  label: string;
};

/**
 * Pick the interpreter for a script based on its extension.
 *
 * The SSH target is Linux, so PowerShell scripts need PowerShell Core (`pwsh`),
 * not Windows PowerShell. Users can override per script when their host has a
 * differently named binary.
 */
export function resolveInterpreter(extension: string, override?: readonly string[] | null): InterpreterSpec {
  if (override && override.length > 0) {
    return { argv: [...override], label: override.join(' ') };
  }
  switch (extension.toLowerCase()) {
    case '.sh':
      return { argv: ['bash'], label: 'bash' };
    case '.ps1':
      return { argv: ['pwsh', '-NoProfile', '-NonInteractive', '-File'], label: 'pwsh' };
    default:
      throw new Error(`Unsupported script extension: ${JSON.stringify(extension)}`);
  }
}

export type BuildCommandInput = {
  interpreter: InterpreterSpec;
  /**
   * Absolute path on the host the interpreter is given. The script's bytes are
   * written here from stdin, so the host does not have the file beforehand.
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
  /** The real invocation, shown in the UI. */
  interpreterLabel: string;
  scriptPath: string;
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

  // Echo the pid on stderr, then exec so the shell is replaced in place and the
  // pid we published stays valid for the lifetime of the script.
  const inner = `printf '%s%s\\n' ${quote(PID_MARKER)} "$$" >&2; ${invoke}`;
  const quotedInner = quote(inner);

  // Assignments may only prefix a *simple* command, so they cannot go in front
  // of the `if` probe: `ENV=prod if ...; then` is a syntax error in every POSIX
  // shell, and the script would never start. Each branch therefore carries the
  // prefix on its own command word; the variables reach `sh`, and through it the
  // exec'd interpreter.
  const assignments = envPrefix(env);
  const command =
    // The script arrives on stdin and has to be on disk before it can be run.
    // `cat` deliberately sits *outside* the setsid branch: delivery must not
    // depend on how the target's util-linux handles stdio. The `&&` chain is
    // load-bearing -- a failed or partial write short-circuits the whole
    // command, so a truncated script is never executed and `cat`'s status
    // becomes the run's.
    //
    // umask in a subshell because script content routinely carries secrets, and
    // a `chmod` after the write would leave a world-readable window.
    `(umask 077 && mkdir -p ${quote(stagingDir)}) && ` +
    `(umask 077 && cat > ${quote(scriptPath)}) && ` +
    `if command -v setsid >/dev/null 2>&1; ` +
    `then ${assignments}setsid -w sh -c ${quotedInner}; ` +
    `else ${assignments}sh -c ${quotedInner}; fi`;

  return { command, display, interpreterLabel: interpreter.label, scriptPath };
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
