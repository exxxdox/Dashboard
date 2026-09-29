/**
 * Symmetric encryption for stored SSH credentials.
 *
 * A private key or password has to be recoverable to open a connection, so it
 * cannot be hashed. AES-256-GCM gives confidentiality plus tamper detection:
 * a modified ciphertext fails to decrypt rather than producing garbage that we
 * would then hand to ssh2.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
/** Format version, so a future scheme can be introduced without ambiguity. */
const PAYLOAD_VERSION = 'v1';

export type SecretBox = {
  /** Returns `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
  encrypt: (plaintext: string) => string;
  /** Throws when the payload is malformed, the version is unknown, or the tag fails. */
  decrypt: (payload: string) => string;
};

export function createSecretBox(key: Buffer): SecretBox {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Secret key must be ${KEY_BYTES} bytes, received ${key.length}`);
  }

  return {
    encrypt(plaintext: string): string {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [
        PAYLOAD_VERSION,
        iv.toString('base64url'),
        tag.toString('base64url'),
        ciphertext.toString('base64url'),
      ].join('.');
    },

    decrypt(payload: string): string {
      const parts = payload.split('.');
      const version = parts[0];
      const ivPart = parts[1];
      const tagPart = parts[2];
      const ciphertextPart = parts[3];

      if (
        parts.length !== 4 ||
        version !== PAYLOAD_VERSION ||
        ivPart === undefined ||
        tagPart === undefined ||
        ciphertextPart === undefined
      ) {
        throw new Error('Unrecognised secret payload format');
      }

      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
      // final() throws when the tag does not verify, which is the check we want.
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextPart, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}

export type SecretKeyResolution = {
  key: Buffer;
  /** Where the key came from, logged once at boot so operators can tell. */
  source: 'env' | 'file' | 'generated';
  path: string | null;
};

/**
 * Resolve the encryption key.
 *
 * `SECRET_KEY` wins when set. Otherwise a key file is created next to the
 * database: requiring an operator to invent a base64 key before first start is
 * friction that leads to weak keys, and the file sits in the same volume as the
 * data it protects, so it does not widen the trust boundary.
 */
export function resolveSecretKey(dataDir: string, fromEnv?: string): SecretKeyResolution {
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    const key = Buffer.from(fromEnv.trim(), 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `SECRET_KEY must decode to ${KEY_BYTES} bytes of base64; got ${key.length}. ` +
          'Generate one with: openssl rand -base64 32',
      );
    }
    return { key, source: 'env', path: null };
  }

  const keyPath = join(dataDir, 'secret.key');
  if (existsSync(keyPath)) {
    const key = Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `Existing key file ${keyPath} is not a valid ${KEY_BYTES}-byte base64 key. ` +
          'Restore it from backup, or delete it to start fresh (stored credentials will be lost).',
      );
    }
    return { key, source: 'file', path: keyPath };
  }

  const key = randomBytes(KEY_BYTES);
  mkdirSync(dirname(keyPath), { recursive: true });
  // 0600 before the bytes are written, so there is no window with looser access.
  writeFileSync(keyPath, key.toString('base64'), { mode: 0o600 });
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    // Best effort: some mounted filesystems silently ignore chmod.
  }
  return { key, source: 'generated', path: keyPath };
}
