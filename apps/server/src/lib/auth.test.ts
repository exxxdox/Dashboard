import { describe, expect, test } from 'vitest';

import {
  createAuthenticator,
  createLoginThrottle,
  readCookie,
  serializeSessionCookie,
} from './auth.js';

const USERNAME = 'ops';
const PASSWORD = 'correct-horse-battery-staple';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = 1_767_225_600_000; // 2026-01-01T00:00:00Z, fixed so expiry is testable

function authenticator(username = USERNAME, password = PASSWORD) {
  return createAuthenticator({ username, password });
}

describe('createAuthenticator', () => {
  test('is disabled when the server has no credentials configured', () => {
    const auth = createAuthenticator({});
    expect(auth.enabled).toBe(false);
    // Nothing can sign in either: a disabled authenticator must not become a
    // back door that accepts any pair.
    expect(auth.checkCredentials(USERNAME, PASSWORD)).toBe(false);
  });

  test('is enabled by a username and password together', () => {
    expect(authenticator().enabled).toBe(true);
  });

  test('accepts exactly the configured pair', () => {
    const auth = authenticator();
    expect(auth.checkCredentials(USERNAME, PASSWORD)).toBe(true);
    expect(auth.checkCredentials(USERNAME, 'wrong')).toBe(false);
    expect(auth.checkCredentials('someone-else', PASSWORD)).toBe(false);
    expect(auth.checkCredentials('', '')).toBe(false);
    // No case folding and no trimming: these are secrets, not labels.
    expect(auth.checkCredentials('OPS', PASSWORD)).toBe(false);
    expect(auth.checkCredentials(USERNAME, ` ${PASSWORD} `)).toBe(false);
  });

  test('issues a session its own verifier accepts, and reports when it began', () => {
    const auth = authenticator();
    const session = auth.issue(T0);

    expect(session.maxAgeSec).toBe(7 * 24 * 60 * 60);
    expect(auth.verify(session.value, T0 + HOUR)).toEqual({ issuedAt: T0 });
  });

  test('rejects a session once it has expired', () => {
    const auth = authenticator();
    const session = auth.issue(T0);

    expect(auth.verify(session.value, T0 + 7 * DAY - 1000)).not.toBeNull();
    expect(auth.verify(session.value, T0 + 7 * DAY + 1000)).toBeNull();
  });

  test('rejects a session whose expiry was edited', () => {
    // The holder of this cookie is a browser, so the expiry travels inside the
    // signed payload: moving it forward invalidates the signature.
    const auth = authenticator();
    const parts = auth.issue(T0).value.split('.');
    const tampered = [parts[0], parts[1], String(Number(parts[2]) + 365 * DAY), parts[3]].join('.');

    expect(auth.verify(tampered, T0 + HOUR)).toBeNull();
  });

  test('rejects a session signed under a different password', () => {
    const value = authenticator().issue(T0).value;
    const other = authenticator(USERNAME, 'a-different-password');

    // Deriving the signing key from the password is what makes changing the
    // password sign everyone out.
    expect(other.verify(value, T0 + HOUR)).toBeNull();
  });

  test('rejects junk, an empty value, and a missing cookie', () => {
    const auth = authenticator();
    expect(auth.verify(undefined, T0)).toBeNull();
    expect(auth.verify('', T0)).toBeNull();
    expect(auth.verify('v1.1.2', T0)).toBeNull();
    expect(auth.verify('v1.a.b.c', T0)).toBeNull();
    expect(auth.verify('v2.1.2.abc', T0)).toBeNull();
  });

  test('renews a session only once it is old enough to be worth renewing', () => {
    const auth = authenticator();
    expect(auth.shouldRenew(T0, T0 + 5 * 60 * 1000)).toBe(false);
    expect(auth.shouldRenew(T0, T0 + 2 * HOUR)).toBe(true);
  });
});

describe('cookies', () => {
  test('reads one named cookie out of a header', () => {
    expect(readCookie('a=1; sd_session=xyz.1.2.3; b=2', 'sd_session')).toBe('xyz.1.2.3');
    expect(readCookie('sd_session=only', 'sd_session')).toBe('only');
  });

  test('returns undefined when the cookie is absent', () => {
    expect(readCookie('a=1; b=2', 'sd_session')).toBeUndefined();
    expect(readCookie(undefined, 'sd_session')).toBeUndefined();
    expect(readCookie('', 'sd_session')).toBeUndefined();
  });

  test('does not mistake a longer name for a prefix match', () => {
    expect(readCookie('sd_session_old=stale', 'sd_session')).toBeUndefined();
  });

  test('serializes a session cookie that scripts cannot read', () => {
    const header = serializeSessionCookie('v1.1.2.sig', { maxAgeSec: 604_800, secure: false });

    expect(header).toContain('sd_session=v1.1.2.sig');
    expect(header).toContain('HttpOnly');
    // Strict, not Lax: the app is same-origin only, and Strict is what makes a
    // cross-site POST arrive without the cookie at all.
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=604800');
    // Secure is conditional: the deployment is plain http on a LAN, where a
    // Secure cookie would simply be dropped.
    expect(header).not.toContain('Secure');
  });

  test('adds Secure when the request arrived over https', () => {
    expect(serializeSessionCookie('v', { maxAgeSec: 60, secure: true })).toContain('Secure');
  });
});

describe('createLoginThrottle', () => {
  test('allows a few wrong passwords before locking the caller out', () => {
    const throttle = createLoginThrottle();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(throttle.isLocked('10.0.0.5', T0)).toBe(false);
      throttle.recordFailure('10.0.0.5', T0);
    }
    expect(throttle.isLocked('10.0.0.5', T0)).toBe(true);
  });

  test('keeps one caller out of another caller', () => {
    const throttle = createLoginThrottle();
    for (let attempt = 0; attempt < 6; attempt += 1) throttle.recordFailure('10.0.0.5', T0);
    expect(throttle.isLocked('10.0.0.6', T0)).toBe(false);
  });

  test('forgets failures once the window has passed', () => {
    const throttle = createLoginThrottle();
    for (let attempt = 0; attempt < 6; attempt += 1) throttle.recordFailure('10.0.0.5', T0);
    expect(throttle.isLocked('10.0.0.5', T0 + 16 * 60 * 1000)).toBe(false);
  });

  test('a correct password clears the count', () => {
    const throttle = createLoginThrottle();
    for (let attempt = 0; attempt < 4; attempt += 1) throttle.recordFailure('10.0.0.5', T0);
    throttle.reset('10.0.0.5');
    for (let attempt = 0; attempt < 4; attempt += 1) throttle.recordFailure('10.0.0.5', T0);
    expect(throttle.isLocked('10.0.0.5', T0)).toBe(false);
  });
});
