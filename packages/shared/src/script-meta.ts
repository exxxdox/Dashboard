/**
 * Declared metadata for a script, read from a comment header.
 *
 * A shell script has no schema, so the dashboard needs a convention to know what
 * a script expects. Anything declared here becomes a form in the UI and is
 * passed to the script as environment variables -- never as argv, so a value can
 * never be reinterpreted as a flag or a command.
 */

import { isRunEnvName } from './run-env.js';

export type ScriptParamType = 'string' | 'bool' | 'number';

export type ScriptParam = {
  name: string;
  type: ScriptParamType;
  required: boolean;
  default: string | null;
  description: string;
};

export type ScriptMeta = {
  name: string | null;
  description: string | null;
  params: ScriptParam[];
  timeoutSec: number | null;
};

/** How many leading lines we are willing to inspect. */
const HEADER_SCAN_LIMIT = 120;

/** A name that is a valid POSIX environment variable identifier. */
const PARAM_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Bounds on what a *form* may send. A header in a script the operator wrote is
 * already reviewed and is not held to the name length; a request body is not.
 */
export const MAX_PARAM_NAME_LENGTH = 64;
export const MAX_PARAM_COUNT = 50;

/**
 * Per positional argument. Longer than a parameter *value* is allowed to be
 * arbitrary, so this only exists to bound what a single request can carry.
 */
export const MAX_ARGV_LENGTH = 8192;

export type ParamNameProblem = 'invalid' | 'reserved';

/**
 * Why a name cannot be used as a parameter, or null when it can.
 *
 * The form and the server both call this, so a name the UI accepts is a name the
 * run accepts: no round trip needed to discover the rule.
 */
export function paramNameProblem(name: string): ParamNameProblem | null {
  if (name.length > MAX_PARAM_NAME_LENGTH || !PARAM_NAME_PATTERN.test(name)) return 'invalid';
  if (isRunEnvName(name)) return 'reserved';
  return null;
}

/** The message each problem reports, kept here so client and server agree. */
export const PARAM_NAME_MESSAGE: Record<ParamNameProblem, string> = {
  invalid: 'Not a valid parameter name',
  reserved: 'The runner sets this variable',
};

export const EMPTY_SCRIPT_META: ScriptMeta = {
  name: null,
  description: null,
  params: [],
  timeoutSec: null,
};

/**
 * Extract the leading comment block.
 *
 * Only the *header* is considered: a `# @param` further down the file is far
 * more likely to be commented-out code than a declaration. Both `#` line
 * comments and a single leading PowerShell `<# ... #>` block are supported.
 */
function readHeaderLines(content: string): string[] {
  const lines = content.split(/\r?\n/, HEADER_SCAN_LIMIT);
  const header: string[] = [];

  let index = 0;
  if (lines[0]?.startsWith('#!')) index = 1;

  // PowerShell block comment: only honoured if it is the first thing in the file.
  const firstMeaningful = lines[index]?.trim() ?? '';
  if (firstMeaningful.startsWith('<#')) {
    const block: string[] = [];
    for (; index < lines.length; index += 1) {
      const line = lines[index]!;
      block.push(line.replace('<#', '').replace('#>', ''));
      if (line.includes('#>')) break;
    }
    return block;
  }

  for (; index < lines.length; index += 1) {
    const line = lines[index]!;
    const trimmed = line.trim();
    if (trimmed === '') {
      // Blank lines are tolerated inside the header but must not start it.
      if (header.length > 0) header.push('');
      continue;
    }
    if (!trimmed.startsWith('#')) break;
    header.push(trimmed.replace(/^#+\s?/, ''));
  }

  return header;
}

/**
 * Parse one `@param` line.
 *
 * Grammar: `@param NAME [required] [type=bool|number|string] [default=VALUE] [description...]`
 * Unknown bare modifiers are folded into the description, so a typo degrades to
 * prose rather than silently changing validation.
 */
function parseParam(line: string): ScriptParam | null {
  const body = line.replace(/^@param\s+/, '').trim();
  if (body === '') return null;

  const tokens = body.split(/\s+/);
  const name = tokens.shift();
  if (!name || !PARAM_NAME_PATTERN.test(name)) return null;

  let type: ScriptParamType = 'string';
  let required = false;
  let defaultValue: string | null = null;
  const descriptionParts: string[] = [];

  for (const token of tokens) {
    if (token === 'required') {
      required = true;
      continue;
    }
    if (token.startsWith('type=')) {
      const candidate = token.slice('type='.length).toLowerCase();
      if (candidate === 'bool' || candidate === 'boolean') type = 'bool';
      else if (candidate === 'number' || candidate === 'int' || candidate === 'integer') type = 'number';
      else type = 'string';
      continue;
    }
    if (token.startsWith('default=')) {
      defaultValue = token.slice('default='.length);
      continue;
    }
    descriptionParts.push(token);
  }

  return { name, type, required, default: defaultValue, description: descriptionParts.join(' ') };
}

/** Parse the declared metadata out of a script's source text. */
export function parseScriptMeta(content: string): ScriptMeta {
  const header = readHeaderLines(content);
  if (header.length === 0) return { ...EMPTY_SCRIPT_META, params: [] };

  let name: string | null = null;
  let description: string | null = null;
  let timeoutSec: number | null = null;
  const params: ScriptParam[] = [];
  const seenParams = new Set<string>();

  for (const line of header) {
    if (line.startsWith('@name')) {
      name = line.replace(/^@name\s*/, '').trim() || null;
      continue;
    }
    if (line.startsWith('@description')) {
      description = line.replace(/^@description\s*/, '').trim() || null;
      continue;
    }
    if (line.startsWith('@timeout')) {
      const value = Number.parseInt(line.replace(/^@timeout\s*/, '').trim(), 10);
      // Guard against absurd values: a runaway script should not hold a slot for
      // a day because of a typo.
      if (Number.isSafeInteger(value) && value > 0 && value <= 86_400) timeoutSec = value;
      continue;
    }
    if (line.startsWith('@param')) {
      const param = parseParam(line);
      // First declaration wins, so a duplicated @param cannot change the form.
      if (param && !seenParams.has(param.name)) {
        seenParams.add(param.name);
        params.push(param);
      }
    }
  }

  return { name, description, params, timeoutSec };
}

export type ParamValidationResult =
  | { ok: true; env: Record<string, string> }
  | { ok: false; errors: { name: string; message: string }[] };

/**
 * Validate raw form input against the declared parameters and coerce it into
 * the environment variables the script will receive.
 *
 * Booleans are normalised to `1`/`0` and numbers are range-checked, so the
 * script never has to defend against `REPLICAS=abc`. A declared parameter is
 * therefore *typed*; anything else the caller sends is forwarded as written,
 * because the dashboard cannot know every argument a script accepts.
 *
 * What a name may be is the boundary, not whether the script declared it: an
 * identifier, within the length cap, and not one of the runner's own variables.
 */
export function validateParams(
  declared: readonly ScriptParam[],
  input: Readonly<Record<string, string | undefined>>,
): ParamValidationResult {
  const env: Record<string, string> = {};
  const errors: { name: string; message: string }[] = [];
  const names = Object.keys(input);

  // Bound the work a single request can ask for before validating any of it.
  if (names.length > MAX_PARAM_COUNT) {
    return {
      ok: false,
      errors: [
        { name: '', message: `Too many parameters: at most ${MAX_PARAM_COUNT} are accepted` },
      ],
    };
  }

  for (const param of declared) {
    // The runner writes its own variables after these, so a value supplied for
    // one of its names would be discarded. Say so rather than drop it.
    if (isRunEnvName(param.name)) {
      errors.push({ name: param.name, message: PARAM_NAME_MESSAGE.reserved });
      continue;
    }

    const raw = input[param.name];
    const provided = raw !== undefined && raw !== '';

    if (!provided) {
      if (param.default !== null) {
        env[param.name] = param.default;
      } else if (param.required) {
        errors.push({ name: param.name, message: 'This parameter is required' });
      }
      continue;
    }

    if (param.type === 'bool') {
      const normalized = raw!.trim().toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(normalized)) env[param.name] = '1';
      else if (['0', 'false', 'no', 'off'].includes(normalized)) env[param.name] = '0';
      else errors.push({ name: param.name, message: 'Expected a boolean value' });
      continue;
    }

    if (param.type === 'number') {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        errors.push({ name: param.name, message: 'Expected a number' });
        continue;
      }
      env[param.name] = String(parsed);
      continue;
    }

    env[param.name] = raw!;
  }

  // Everything the caller sent that the script did not declare. Forwarded as
  // given -- an empty value is a value -- once the name is one a shell can take.
  const declaredNames = new Set(declared.map((param) => param.name));
  for (const key of names) {
    if (declaredNames.has(key)) continue;

    const problem = paramNameProblem(key);
    if (problem) {
      errors.push({ name: key, message: PARAM_NAME_MESSAGE[problem] });
      continue;
    }
    env[key] = input[key] ?? '';
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, env };
}
