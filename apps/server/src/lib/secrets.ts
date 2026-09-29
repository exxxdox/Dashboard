/**
 * The rules for a value that is stored encrypted and never returned.
 *
 * Three features store credentials -- a target's ssh secret, the DNS provider's
 * tokens, the notification token -- and they all answer the same questions the
 * same way. Written once because a second copy of a rule this sharp would
 * eventually be a second answer:
 *
 *   - what does a blank value from the client mean? ("keep the stored one")
 *   - what does an explicit clear flag mean? ("delete; it beats everything")
 *   - what does a value that will not decrypt mean? (the secret key changed)
 *
 * The API never returns a credential, so a form has nothing to send back for one
 * it is not changing. That is *why* blank has to mean "keep": from the request
 * alone the two are indistinguishable.
 */

import type { SecretBox } from './crypto.js';
import { ConflictError } from './errors.js';

/** A text field: absent keeps the stored value, present replaces it, trimmed. */
export function textField(provided: string | undefined, current: string): string {
  return provided === undefined ? current : provided.trim();
}

/** True for null, an empty string, and whitespace -- all of them "not set". */
export function isBlank(value: string | null): boolean {
  return value === null || value.trim() === '';
}

/**
 * A credential: an explicit clear wins, then a non-blank replacement, and
 * otherwise whatever is stored survives untouched.
 */
export function mergeSecret(
  provided: string | undefined,
  clear: boolean | undefined,
  current: string | null,
): string | null {
  if (clear === true) return null;
  if (provided === undefined) return current;
  const trimmed = provided.trim();
  return trimmed === '' ? current : trimmed;
}

/** Null stays null: a column with nothing in it is not an empty string. */
export function encryptSecret(value: string | null, box: SecretBox): string | null {
  return value === null ? null : box.encrypt(value);
}

/**
 * A stored credential that will not decrypt means `secret.key` was replaced or
 * lost, and the operator has to re-enter the credential to fix it.
 *
 * A 409 rather than a 500 because the request itself is fine -- what conflicts
 * is the stored state -- and naming which credential it was is the only part of
 * this that helps.
 */
export function decryptSecret(value: string, box: SecretBox, what: string): string {
  try {
    return box.decrypt(value);
  } catch {
    throw new ConflictError(
      `${what} cannot be decrypted: the secret key has changed. Re-enter the saved credentials.`,
    );
  }
}

/** `decryptSecret` for a nullable column, which passes null straight through. */
export function decryptOptionalSecret(
  value: string | null,
  box: SecretBox,
  what: string,
): string | null {
  return value === null ? null : decryptSecret(value, box, what);
}
