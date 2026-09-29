/**
 * The shell string assembled in `shared/shell.ts` is only ever executed on a
 * remote host, so no unit assertion about its *shape* can prove it is valid.
 * These tests hand it to a real shell, with the script bytes on stdin, exactly
 * as the transport will.
 *
 * They live in the server package because they need `child_process`; the shared
 * package stays free of node's type surface so its sources cannot quietly pick
 * up a node-only import.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildCommand,
  cleanupStagingCommand,
  PID_MARKER,
  resolveInterpreter,
} from '@script-dashboard/shared';
import { describe, expect, test } from 'vitest';

type Run = { status: number | null; stdout: string; stderr: string };

/** Run the assembled command the way the transport does: payload on stdin. */
function run(command: string, stdin: string, env: NodeJS.ProcessEnv = process.env): Run {
  const result = spawnSync('bash', ['-c', command], { input: stdin, encoding: 'utf8', env });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * A PATH holding everything the wrapper needs except `setsid`, so the fallback
 * branch can be exercised on a host that does have util-linux.
 */
function withoutSetsid(dir: string): NodeJS.ProcessEnv {
  for (const binary of ['cat', 'mkdir', 'sh', 'bash']) {
    for (const candidate of [`/bin/${binary}`, `/usr/bin/${binary}`]) {
      if (existsSync(candidate)) {
        symlinkSync(candidate, join(dir, binary));
        break;
      }
    }
  }
  return { ...process.env, PATH: dir };
}

/** A script that reports where it ran and what it received. */
const PROBE_BODY = [
  '#!/usr/bin/env bash',
  'printf "PWD=%s\\n" "$PWD"',
  'printf "ENV=%s\\n" "${ENV:-unset}"',
  'exit 7',
  '',
].join('\n');

function sandbox(): { root: string; workDir: string; stagingDir: string; scriptPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'sd-remote-'));
  const workDir = join(root, 'work');
  const stagingDir = join(root, 'stage');
  // An existing work directory is a precondition of every run: `cd` failing
  // short-circuits the wrapper, so the script would never start.
  mkdirSync(workDir, { recursive: true });
  return { root, workDir, stagingDir, scriptPath: join(stagingDir, 'probe.sh') };
}

describe('assembled remote command', () => {
  test('is parseable by a real shell', () => {
    // `sh -n` reads the string without running it. A malformed wrapper -- for
    // instance environment assignments placed in front of the `if` probe, which
    // POSIX forbids -- fails here and nowhere else.
    const envs: Record<string, string>[] = [{}, { ENV: 'prod' }, { A: "o'brien", B: 'x y' }];
    for (const env of envs) {
      const command = buildCommand({
        interpreter: resolveInterpreter('.sh'),
        scriptPath: '/tmp/sd-run1/api.sh',
        stagingDir: '/tmp/sd-run1',
        cwd: '/srv/scripts',
        env,
      }).command;
      expect(spawnSync('sh', ['-n', '-c', command]).status).toBe(0);
    }
  });

  test('delivers the script byte for byte and runs it in the working directory', () => {
    const box = sandbox();
    try {
      const built = buildCommand({
        interpreter: resolveInterpreter('.sh'),
        scriptPath: box.scriptPath,
        stagingDir: box.stagingDir,
        cwd: box.workDir,
        env: { ENV: 'prod' },
      });

      const result = run(built.command, PROBE_BODY);

      // The bytes the host executed are the bytes we sent -- no expansion, no
      // truncation, no re-encoding.
      expect(readFileSync(box.scriptPath, 'utf8')).toBe(PROBE_BODY);
      // cwd is the target's working directory, not the staging directory: that
      // is what lets a script read a sibling data file by relative path.
      expect(result.stdout).toContain(`PWD=${box.workDir}`);
      expect(result.stdout).toContain('ENV=prod');
      expect(result.stderr).toContain(PID_MARKER);
      expect(result.status).toBe(7);
    } finally {
      rmSync(box.root, { recursive: true, force: true });
    }
  });

  test('hands a hostile positional argument to the script as one literal argument', () => {
    // The unit test asserts the quoting; this asserts what a real shell does
    // with it: the script sees its argument count unchanged and each value byte
    // for byte, with no substitution and no extra word.
    const box = sandbox();
    try {
      const body = [
        '#!/usr/bin/env bash',
        'printf "ARGC=%s\\n" "$#"',
        'for arg in "$@"; do printf "ARG=[%s]\\n" "$arg"; done',
        '',
      ].join('\n');
      const built = buildCommand({
        interpreter: resolveInterpreter('.sh'),
        scriptPath: box.scriptPath,
        stagingDir: box.stagingDir,
        cwd: box.workDir,
        args: ['100', 'two words', '; touch /tmp/sd-injection-marker', '$(whoami)', "it's"],
      });

      const result = run(built.command, body);

      expect(result.stdout).toContain('ARGC=5');
      expect(result.stdout).toContain('ARG=[100]');
      expect(result.stdout).toContain('ARG=[two words]');
      expect(result.stdout).toContain('ARG=[; touch /tmp/sd-injection-marker]');
      expect(result.stdout).toContain('ARG=[$(whoami)]');
      expect(result.stdout).toContain("ARG=[it's]");
      // Nothing ran: the marker file was never created.
      expect(existsSync('/tmp/sd-injection-marker')).toBe(false);
    } finally {
      rmSync(box.root, { recursive: true, force: true });
    }
  });

  test('keeps a payload large enough to cross the pipe buffer intact', () => {
    const box = sandbox();
    try {
      const padding = `# ${'x'.repeat(2 * 1024 * 1024)}\n`;
      const payload = `${padding}echo BIG_OK\n`;
      const built = buildCommand({
        interpreter: resolveInterpreter('.sh'),
        scriptPath: box.scriptPath,
        stagingDir: box.stagingDir,
        cwd: box.workDir,
        env: {},
      });

      const result = run(built.command, payload);

      expect(readFileSync(box.scriptPath, 'utf8')).toBe(payload);
      expect(result.stdout.trim()).toBe('BIG_OK');
      expect(result.status).toBe(0);
    } finally {
      rmSync(box.root, { recursive: true, force: true });
    }
  });

  test('does not run the script when the host failed to receive it', () => {
    // /dev/null is a character device, so `mkdir -p /dev/null/x` fails. The `&&`
    // chain must short-circuit rather than let the interpreter run against a
    // missing or partial file.
    const built = buildCommand({
      interpreter: resolveInterpreter('.sh'),
      scriptPath: '/dev/null/x/probe.sh',
      stagingDir: '/dev/null/x',
      cwd: '/tmp',
      env: {},
    });

    const result = run(built.command, PROBE_BODY);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain(PID_MARKER);
  });

  test('falls back to a plain shell when the host has no setsid', () => {
    const box = sandbox();
    const bin = mkdtempSync(join(tmpdir(), 'sd-bin-'));
    try {
      const built = buildCommand({
        interpreter: resolveInterpreter('.sh'),
        scriptPath: box.scriptPath,
        stagingDir: box.stagingDir,
        cwd: box.workDir,
        env: { ENV: 'prod' },
      });

      const result = run(built.command, PROBE_BODY, withoutSetsid(bin));

      expect(result.stdout).toContain(`PWD=${box.workDir}`);
      expect(result.stdout).toContain('ENV=prod');
      // The fallback still publishes the pid, so cancellation degrades to
      // killing the process alone instead of failing outright.
      expect(result.stderr).toContain(PID_MARKER);
      expect(result.status).toBe(7);
    } finally {
      rmSync(box.root, { recursive: true, force: true });
      rmSync(bin, { recursive: true, force: true });
    }
  });

  test('cleans the staging directory away with the command the transport sends', () => {
    const box = sandbox();
    try {
      const built = buildCommand({
        interpreter: resolveInterpreter('.sh'),
        scriptPath: box.scriptPath,
        stagingDir: box.stagingDir,
        cwd: box.workDir,
        env: {},
      });
      run(built.command, PROBE_BODY);
      expect(existsSync(box.stagingDir)).toBe(true);

      const cleanup = spawnSync('bash', ['-c', cleanupStagingCommand(box.stagingDir)], {
        encoding: 'utf8',
      });

      expect(cleanup.status).toBe(0);
      expect(existsSync(box.stagingDir)).toBe(false);
    } finally {
      rmSync(box.root, { recursive: true, force: true });
    }
  });
});
