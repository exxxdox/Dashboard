import { describe, expect, test } from 'vitest';

import {
  buildCommand,
  cleanupStagingCommand,
  envPrefix,
  PID_MARKER,
  quote,
  resolveInterpreter,
} from './shell.js';

describe('quote', () => {
  test('quotes an empty string so it stays one argument', () => {
    expect(quote('')).toBe("''");
  });

  test('leaves values that need no quoting untouched', () => {
    expect(quote('deploy.sh')).toBe('deploy.sh');
    expect(quote('/srv/scripts/api.sh')).toBe('/srv/scripts/api.sh');
    expect(quote('a=b,c')).toBe('a=b,c');
  });

  test('quotes shell metacharacters', () => {
    expect(quote('a b')).toBe("'a b'");
    expect(quote('a; rm -rf /')).toBe("'a; rm -rf /'");
    expect(quote('$(whoami)')).toBe("'$(whoami)'");
    expect(quote('`id`')).toBe("'`id`'");
    expect(quote('a|b')).toBe("'a|b'");
  });

  test('escapes an embedded single quote by closing, escaping, and reopening', () => {
    // The classic break-out: without the '\'' dance this would end the quoted
    // string early and the remainder would run as a command.
    expect(quote("it's")).toBe("'it'\\''s'");
  });
});

describe('envPrefix', () => {
  test('emits assignments for valid names', () => {
    expect(envPrefix({ ENV: 'prod', REPLICAS: '3' })).toBe('ENV=prod REPLICAS=3 ');
  });

  test('quotes values that contain spaces', () => {
    expect(envPrefix({ MESSAGE: 'hello world' })).toBe("MESSAGE='hello world' ");
  });

  test('returns an empty prefix when there is nothing to set', () => {
    expect(envPrefix({})).toBe('');
  });

  test('rejects names that are not shell identifiers', () => {
    // Such a name would otherwise escape the assignment and run as a command.
    expect(() => envPrefix({ 'A; rm -rf /': 'x' })).toThrow(/Invalid environment variable name/);
    expect(() => envPrefix({ '1BAD': 'x' })).toThrow(/Invalid environment variable name/);
  });
});

describe('resolveInterpreter', () => {
  test('uses bash for shell scripts', () => {
    expect(resolveInterpreter('.sh').argv).toEqual(['bash']);
  });

  test('uses PowerShell Core for ps1, since the target is Linux', () => {
    expect(resolveInterpreter('.ps1').argv).toEqual([
      'pwsh',
      '-NoProfile',
      '-NonInteractive',
      '-File',
    ]);
  });

  test('honours an explicit override', () => {
    expect(resolveInterpreter('.sh', ['/bin/dash']).argv).toEqual(['/bin/dash']);
  });

  test('rejects extensions it cannot run', () => {
    expect(() => resolveInterpreter('.py')).toThrow(/Unsupported script extension/);
  });
});

describe('buildCommand', () => {
  const base = {
    interpreter: resolveInterpreter('.sh'),
    scriptPath: '/tmp/sd-run1/api.sh',
    stagingDir: '/tmp/sd-run1',
    cwd: '/srv/scripts',
    env: { ENV: 'prod' },
  };

  test('writes the script from stdin into the staging directory first', () => {
    const command = buildCommand(base).command;
    expect(command).toContain('(umask 077 && mkdir -p /tmp/sd-run1)');
    expect(command).toContain('(umask 077 && cat > /tmp/sd-run1/api.sh)');
  });

  test('never runs a script the host failed to receive in full', () => {
    // `cat` short-circuits the whole `&&` chain, so a failed or partial write
    // means the interpreter is never reached.
    const command = buildCommand(base).command;
    expect(command).toMatch(/cat > [^)]*\) && if command -v setsid/);
  });

  test('runs in the configured working directory, not the staging directory', () => {
    // The whole point of `workDir`: a script that reads a sibling data file by
    // relative path must still find it.
    const built = buildCommand(base);
    expect(built.command).toContain('cd /srv/scripts && exec bash /tmp/sd-run1/api.sh');
  });

  test('detaches stdin so the script cannot consume the delivery channel', () => {
    const built = buildCommand(base);
    expect(built.command).toContain('exec bash /tmp/sd-run1/api.sh < /dev/null');
  });

  test('passes positional arguments after the script path, in order', () => {
    // A script that reads `$1 $2` gets them from here rather than from the
    // environment. Order is the caller's order and is not re-sorted.
    const built = buildCommand({ ...base, args: ['100', '200', 'ipv4'] });
    expect(built.command).toContain('exec bash /tmp/sd-run1/api.sh 100 200 ipv4 < /dev/null');
    expect(built.display).toContain('exec bash /tmp/sd-run1/api.sh 100 200 ipv4');
  });

  test('quotes each argument, so a value cannot become a second argument or a command', () => {
    const built = buildCommand({ ...base, args: ['two words', '; rm -rf /', '$(whoami)', ''] });
    // Read on `display`, which is the invocation before the wrapper quotes it.
    expect(built.display).toContain(
      `exec bash /tmp/sd-run1/api.sh 'two words' '; rm -rf /' '$(whoami)' '' < /dev/null`,
    );
    // Nothing is left bare: an unquoted substitution would be evaluated by the
    // remote shell before the script ever saw it.
    expect(built.command).not.toContain('api.sh $(whoami)');
    expect(built.command).not.toContain('api.sh ; rm');
  });

  test('leaves the command unchanged when there are no arguments', () => {
    const withEmpty = buildCommand({ ...base, args: [] });
    const without = buildCommand(base);
    expect(withEmpty.command).toBe(without.command);
  });

  test('quotes a staging path that would otherwise split or inject', () => {
    const built = buildCommand({ ...base, stagingDir: "/tmp/it's here", scriptPath: "/tmp/it's here/a b.sh" });
    const command = built.command;
    expect(command).toContain(`mkdir -p '/tmp/it'\\''s here'`);
    expect(command).toContain(`cat > '/tmp/it'\\''s here/a b.sh'`);
    // No bare quote can end the quoted string early and start a command.
    expect(command).not.toContain("; rm -rf");
  });

  test('probes for setsid instead of assuming it', () => {
    // An unconditional `setsid` would turn a host without util-linux into a
    // command-not-found failure for every script.
    const built = buildCommand({ ...base, env: {} });
    expect(built.command).toContain('if command -v setsid >/dev/null 2>&1');
    expect(built.command).toContain('then setsid -w sh -c');
    expect(built.command).toContain('else sh -c');
  });

  test('publishes the pid on stderr before exec so the process group can be killed', () => {
    const built = buildCommand(base);
    expect(built.command).toContain(PID_MARKER);
    expect(built.command).toContain('$$');
  });

  test('carries the environment into the command that runs the script', () => {
    const command = buildCommand(base).command;

    // Assignments may only prefix a *simple* command. Emitting them in front of
    // the `if` probe produces `ENV=prod if ...; then`, which every POSIX shell
    // rejects with "syntax error near unexpected token `then'". They belong on
    // each branch's command word instead.
    expect(command).toContain('then ENV=prod setsid -w sh -c');
    expect(command).toContain('else ENV=prod sh -c');
    expect(command.startsWith('ENV=prod ')).toBe(false);
  });

  test('quotes an injected cwd rather than letting it break out', () => {
    const built = buildCommand({ ...base, cwd: '/tmp/x; rm -rf /' });

    // The cwd is quoted once for the inner `sh -c` and then the whole inner
    // command is quoted again for the outer one, so each of its single quotes
    // appears escaped as '\'' in the final string. Unescaping it once must yield
    // the safely quoted form -- and must never yield a bare `;` at top level.
    const unescapedOnce = built.command.replaceAll(`'\\''`, "'");
    expect(unescapedOnce).toContain("cd '/tmp/x; rm -rf /'");
    expect(built.command).not.toContain('; cd /tmp/x');
  });

  test('keeps the display string free of wrapper plumbing', () => {
    const built = buildCommand(base);
    expect(built.display).toBe('ENV=prod cd /srv/scripts && exec bash /tmp/sd-run1/api.sh < /dev/null');
    expect(built.display).not.toContain(PID_MARKER);
    expect(built.display).not.toContain('setsid');
    // The staging path is transient and the display is shown to users, so the
    // display keeps naming the script rather than its delivery path.
    expect(built.display).not.toContain('cat >');
  });
});

describe('cleanupStagingCommand', () => {
  test('removes the staging directory and terminates option parsing', () => {
    // `--` matters: without it a staging path beginning with `-` would be read
    // as flags to rm.
    expect(cleanupStagingCommand('/tmp/sd-run1')).toBe('rm -rf -- /tmp/sd-run1');
  });

  test('quotes a path that would otherwise be split into several arguments', () => {
    expect(cleanupStagingCommand('/tmp/-rf x')).toBe("rm -rf -- '/tmp/-rf x'");
  });
});
