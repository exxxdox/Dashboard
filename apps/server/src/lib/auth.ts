/**
 * Sign-in for a dashboard that has no user database.
 *
 * One username and one password come from the environment, so there is nothing
 * to register and nothing to store: no user table, no password hashes at rest,
 * no reset flow. What the server keeps instead is a signing key derived from the
 * password, which is what makes a session verifiable without a session store --
 * and what makes changing the password sign everyone out.
 *
 * Deliberately not HTTP Basic: that sends the password on every request and
 * offers no way to sign out.
 */

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** How long a session lasts, refreshed on use. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How stale a session may get before its cookie is re-issued. Renewing on every
 * request would work too, but that is a Set-Cookie on every poll, and this
 * dashboard polls.
 */
const RENEW_AFTER_MS = 60 * 60 * 1000;

/** Fixed salt: the derived key has to come out the same on every boot. */
const KEY_SALT = 'script-dashboard-session-v1';
const TOKEN_VERSION = 'v1';

export const SESSION_COOKIE = 'sd_session';

export type Authenticator = {
  /** False when no credentials are configured, in which case nothing is checked. */
  enabled: boolean;
  checkCredentials: (username: string, password: string) => boolean;
  issue: (now: number) => { value: string; maxAgeSec: number };
  /** The session's issue time, or null when the value is not a valid session. */
  verify: (value: string | undefined, now: number) => { issuedAt: number } | null;
  shouldRenew: (issuedAt: number, now: number) => boolean;
};

/** Compares two secrets without leaking their length or content through timing. */
function secretEquals(left: string, right: string): boolean {
  // Hashing first gives both sides the same length, so `timingSafeEqual` cannot
  // throw on a length mismatch and the comparison takes the same time whatever
  // the attacker sends.
  const a = createHmac('sha256', 'compare').update(left).digest();
  const b = createHmac('sha256', 'compare').update(right).digest();
  return timingSafeEqual(a, b);
}

export function createAuthenticator(input: {
  username?: string | undefined;
  password?: string | undefined;
}): Authenticator {
  const username = input.username ?? '';
  const password = input.password ?? '';
  const enabled = username !== '' && password !== '';

  // scrypt rather than a bare hash: the password is all that stands between
  // someone who knows the cookie format and a forged session, so deriving the
  // key has to be expensive to guess. Once, at boot.
  const key = enabled ? scryptSync(password, KEY_SALT, 32) : randomBytes(32);

  const sign = (payload: string): string =>
    createHmac('sha256', key).update(payload).digest('base64url');

  return {
    enabled,

    checkCredentials(candidateUsername, candidatePassword) {
      if (!enabled) return false;
      // Both halves are always compared, so a wrong username and a wrong
      // password take the same time.
      return (
        secretEquals(candidateUsername, username) && secretEquals(candidatePassword, password)
      );
    },

    issue(now) {
      const expiresAt = now + SESSION_TTL_MS;
      const payload = `${TOKEN_VERSION}.${now}.${expiresAt}`;
      return { value: `${payload}.${sign(payload)}`, maxAgeSec: SESSION_TTL_MS / 1000 };
    },

    verify(value, now) {
      if (!enabled || !value) return null;

      const parts = value.split('.');
      if (parts.length !== 4) return null;

      const [version, issuedRaw, expiresRaw, signature] = parts as [string, string, string, string];
      if (version !== TOKEN_VERSION) return null;

      const issuedAt = Number(issuedRaw);
      const expiresAt = Number(expiresRaw);
      if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) return null;

      // Signature first: an edited expiry has to be rejected as a forgery, not
      // as an expiry, or the answer tells the attacker which half to fix.
      if (!secretEquals(signature, sign(`${version}.${issuedRaw}.${expiresRaw}`))) return null;
      if (now >= expiresAt) return null;

      return { issuedAt };
    },

    shouldRenew(issuedAt, now) {
      return now - issuedAt >= RENEW_AFTER_MS;
    },
  };
}

/** Reads one cookie out of a `Cookie:` header, without pulling in a parser. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

export function serializeSessionCookie(
  value: string,
  options: { maxAgeSec: number; secure: boolean },
): string {
  const attributes = [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    // Strict rather than Lax: this UI is same-origin only, and Strict is what
    // stops a cross-site request from carrying the session at all.
    'SameSite=Strict',
    `Max-Age=${options.maxAgeSec}`,
  ];
  // Only over https: on a plain-http deployment the browser drops a Secure
  // cookie and signing in would silently never work.
  if (options.secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

/** Wrong passwords allowed from one address inside the window. */
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

export type LoginThrottle = {
  isLocked: (ip: string, now: number) => boolean;
  recordFailure: (ip: string, now: number) => void;
  reset: (ip: string) => void;
};

/**
 * An in-process guard against guessing, kept beside the queue rather than in the
 * database: it protects a LAN service, and losing it to a restart is not a
 * meaningful loss. Callers behind a proxy share one address and so count as one.
 */
export function createLoginThrottle(): LoginThrottle {
  const failures = new Map<string, number[]>();

  const recent = (ip: string, now: number): number[] =>
    (failures.get(ip) ?? []).filter((at) => now - at < FAILURE_WINDOW_MS);

  return {
    isLocked(ip, now) {
      return recent(ip, now).length >= MAX_FAILURES;
    },
    recordFailure(ip, now) {
      const kept = recent(ip, now);
      kept.push(now);
      failures.set(ip, kept);
    },
    reset(ip) {
      failures.delete(ip);
    },
  };
}
