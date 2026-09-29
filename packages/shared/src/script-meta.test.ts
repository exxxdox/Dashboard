import { describe, expect, test } from 'vitest';

import { parseScriptMeta, validateParams } from './script-meta.js';

const SHELL_SCRIPT = `#!/usr/bin/env bash
# @name Deploy API
# @description Rolling deploy with a health gate
# @timeout 600
# @param ENV required Target environment
# @param REPLICAS type=number default=3 How many replicas
# @param DRY_RUN type=bool default=false Skip mutations

set -euo pipefail
echo "deploying"
`;

describe('parseScriptMeta', () => {
  test('reads the declared name, description, and timeout', () => {
    const meta = parseScriptMeta(SHELL_SCRIPT);
    expect(meta.name).toBe('Deploy API');
    expect(meta.description).toBe('Rolling deploy with a health gate');
    expect(meta.timeoutSec).toBe(600);
  });

  test('reads parameters with their modifiers', () => {
    expect(parseScriptMeta(SHELL_SCRIPT).params).toEqual([
      { name: 'ENV', type: 'string', required: true, default: null, description: 'Target environment' },
      { name: 'REPLICAS', type: 'number', required: false, default: '3', description: 'How many replicas' },
      { name: 'DRY_RUN', type: 'bool', required: false, default: 'false', description: 'Skip mutations' },
    ]);
  });

  test('starts with empty metadata when there is no header', () => {
    const meta = parseScriptMeta('echo hello\n');
    expect(meta.name).toBeNull();
    expect(meta.params).toEqual([]);
  });

  test('ignores declarations that appear after the first line of code', () => {
    // A `# @param` further down is far more likely to be commented-out code
    // than a declaration, so only the leading block is read.
    const meta = parseScriptMeta(`#!/bin/sh
# @param TOP
echo hi
# @param BOTTOM required
`);
    expect(meta.params.map((param) => param.name)).toEqual(['TOP']);
  });

  test('reads a leading PowerShell block comment', () => {
    const meta = parseScriptMeta(`<#
.SYNOPSIS
@name Restart Service
@param SERVICE required Which service
#>
Write-Host "hello"
`);
    expect(meta.name).toBe('Restart Service');
    expect(meta.params).toEqual([
      { name: 'SERVICE', type: 'string', required: true, default: null, description: 'Which service' },
    ]);
  });

  test('rejects parameter names that are not environment identifiers', () => {
    // These become environment variable names, so a bad one cannot be honoured.
    const meta = parseScriptMeta('# @param 1BAD nope\n# @param OK yes\n');
    expect(meta.params.map((param) => param.name)).toEqual(['OK']);
  });

  test('keeps the first declaration of a duplicated parameter', () => {
    const meta = parseScriptMeta('# @param A first\n# @param A second\n');
    expect(meta.params).toHaveLength(1);
    expect(meta.params[0]?.description).toBe('first');
  });

  test('ignores an absurd timeout rather than trusting it', () => {
    expect(parseScriptMeta('# @timeout 999999999\n').timeoutSec).toBeNull();
    expect(parseScriptMeta('# @timeout -5\n').timeoutSec).toBeNull();
  });
});

describe('validateParams', () => {
  const declared = parseScriptMeta(SHELL_SCRIPT).params;

  test('applies defaults for parameters that were not supplied', () => {
    expect(validateParams(declared, { ENV: 'prod' })).toEqual({
      ok: true,
      env: { ENV: 'prod', REPLICAS: '3', DRY_RUN: 'false' },
    });
  });

  test('reports a missing required parameter', () => {
    const result = validateParams(declared, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([{ name: 'ENV', message: 'This parameter is required' }]);
  });

  test('normalises boolean spellings', () => {
    const yes = validateParams(declared, { ENV: 'prod', DRY_RUN: 'TRUE' });
    const no = validateParams(declared, { ENV: 'prod', DRY_RUN: 'off' });
    expect(yes.ok && yes.env.DRY_RUN).toBe('1');
    expect(no.ok && no.env.DRY_RUN).toBe('0');
  });

  test('rejects a value that is not a boolean or a number', () => {
    expect(validateParams(declared, { ENV: 'prod', DRY_RUN: 'maybe' }).ok).toBe(false);
    expect(validateParams(declared, { ENV: 'prod', REPLICAS: 'lots' }).ok).toBe(false);
  });

  test('treats an empty string as not supplied', () => {
    expect(validateParams(declared, { ENV: '' }).ok).toBe(false);
  });
});

/**
 * A run may carry parameters the script never declared: the dashboard cannot
 * know every argument a script accepts, and editing the script to add a header
 * is not always possible. The boundary is the environment variable namespace
 * rather than the parameter list.
 */
describe('validateParams with custom parameters', () => {
  const declared = parseScriptMeta(SHELL_SCRIPT).params;

  test('forwards a name the script never declared', () => {
    const result = validateParams(declared, { ENV: 'prod', API_BASE: 'https://example.test' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env).toEqual({
      ENV: 'prod',
      REPLICAS: '3',
      DRY_RUN: 'false',
      API_BASE: 'https://example.test',
    });
  });

  test('keeps a declared default when a custom parameter is added', () => {
    const result = validateParams(declared, { ENV: 'prod', API_BASE: 'x' });
    expect(result.ok && result.env.REPLICAS).toBe('3');
  });

  test('keeps an empty custom value, which is a value', () => {
    const result = validateParams(declared, { ENV: 'prod', EXPLICIT_EMPTY: '' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.EXPLICIT_EMPTY).toBe('');
    expect(Object.keys(result.env)).toContain('EXPLICIT_EMPTY');
  });

  test('refuses a name that is not a shell variable', () => {
    // The name reaches `VAR=value cmd`, so anything that is not an identifier
    // could end the assignment and start a command.
    const result = validateParams(declared, { ENV: 'prod', 'A; rm -rf /': 'x' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual({
      name: 'A; rm -rf /',
      message: 'Not a valid parameter name',
    });
  });

  test('refuses a name the runner owns, whichever side declared it', () => {
    // The runner injects these after the parameters, so a value supplied here
    // would be silently discarded. Refusing it says so instead.
    const custom = validateParams(declared, { ENV: 'prod', SD_SCRIPT_PATH: '/tmp/other.sh' });
    expect(custom.ok).toBe(false);
    if (!custom.ok) {
      expect(custom.errors).toContainEqual({
        name: 'SD_SCRIPT_PATH',
        message: 'The runner sets this variable',
      });
    }

    const fromScript = parseScriptMeta('#!/bin/sh\n# @param SD_TARGET_NAME a host\n').params;
    expect(validateParams(fromScript, { SD_TARGET_NAME: 'host1' }).ok).toBe(false);
  });

  test('caps the count and the name length, so a form cannot send an unbounded set', () => {
    const many: Record<string, string> = { ENV: 'prod' };
    for (let index = 0; index < 60; index += 1) many[`EXTRA_${index}`] = 'x';
    const capped = validateParams(declared, many);
    expect(capped.ok).toBe(false);
    if (!capped.ok) {
      expect(capped.errors).toContainEqual({
        name: '',
        message: 'Too many parameters: at most 50 are accepted',
      });
    }

    expect(validateParams(declared, { ENV: 'prod', ['X'.repeat(65)]: 'x' }).ok).toBe(false);
  });
});
