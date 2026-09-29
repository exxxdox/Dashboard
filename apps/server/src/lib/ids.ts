import { randomBytes } from 'node:crypto';

/**
 * Prefixed, URL-safe identifiers.
 *
 * The prefix makes it obvious in a log or a database row what a bare id refers
 * to, and base64url keeps ids safe to place directly in a path segment.
 */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}

export const newTargetId = (): string => newId('tgt');
export const newSourceId = (): string => newId('src');
export const newScriptId = (): string => newId('scr');
export const newExecutionId = (): string => newId('run');
