/**
 * The sign-in throttle's order of decisions.
 *
 * A locked address must not get a password oracle, even with a correct guess.
 */

import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { AppContext } from '../context.js';
import { openDatabase } from '../db/client.js';
import { createAuthenticator, createLoginThrottle } from '../lib/auth.js';
import { createSecretBox } from '../lib/crypto.js';
import { createLogger } from '../lib/logger.js';

const CREDENTIALS = { username: 'ops', password: 'secret' };

afterEach(() => vi.restoreAllMocks());

async function build(): Promise<{
  inject: Awaited<ReturnType<typeof buildApp>>['inject'];
  close: () => Promise<void>;
  checkCredentials: ReturnType<typeof vi.spyOn>;
}> {
  const db = openDatabase(':memory:');
  const ctx = {
    config: loadConfig({ SCRIPT_ROOT_CONTAINER: '/workspace', SERVE_WEB: 'false' }),
    db,
    box: createSecretBox(randomBytes(32)),
    logger: createLogger({ level: 'silent', pretty: false }),
    auth: createAuthenticator(CREDENTIALS),
    loginThrottle: createLoginThrottle(),
    isShuttingDown: () => false,
  } as unknown as AppContext;

  const checkCredentials = vi.spyOn(ctx.auth, 'checkCredentials');
  const app = await buildApp(ctx);
  return {
    inject: app.inject.bind(app),
    checkCredentials,
    close: async () => {
      await app.close();
      db.close();
    },
  };
}

function signIn(
  inject: Awaited<ReturnType<typeof buildApp>>['inject'],
  body: unknown,
  remoteAddress = '10.0.0.9',
) {
  return inject({
    method: 'POST',
    url: '/api/auth/login',
    remoteAddress,
    payload: body as Record<string, unknown>,
  });
}

describe('the sign-in throttle', () => {
  test('allows five guesses and rejects the next attempt before checking credentials', async () => {
    const h = await build();
    try {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const response = await signIn(h.inject, { username: 'ops', password: 'wrong' });
        expect(response.statusCode, `attempt ${attempt}`).toBe(401);
      }

      const blocked = await signIn(h.inject, { username: 'ops', password: 'wrong' });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.headers['retry-after']).toBe('30');
      expect(h.checkCredentials).toHaveBeenCalledTimes(5);
    } finally {
      await h.close();
    }
  });

  test('does not disclose a correct guess while locked, and blocked requests do not extend the window', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const h = await build();
    try {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await signIn(h.inject, { username: 'ops', password: 'wrong' });
      }

      const response = await signIn(h.inject, CREDENTIALS);

      expect(response.statusCode).toBe(429);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(h.checkCredentials).toHaveBeenCalledTimes(5);

      now += 29_000;
      expect((await signIn(h.inject, CREDENTIALS)).statusCode).toBe(429);
      now += 1_000;
      expect((await signIn(h.inject, CREDENTIALS)).statusCode).toBe(200);
      expect(h.checkCredentials).toHaveBeenCalledTimes(6);
    } finally {
      await h.close();
    }
  });

  test('leaves other addresses untouched', async () => {
    const h = await build();
    try {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await signIn(h.inject, { username: 'ops', password: 'wrong' }, '10.0.0.9');
      }

      const response = await signIn(h.inject, { username: 'ops', password: 'wrong' }, '10.0.0.10');

      // Wrong, but not yet throttled: this caller is being told their password
      // is wrong, not to go away.
      expect(response.statusCode).toBe(401);
      expect(response.headers['retry-after']).toBeUndefined();
    } finally {
      await h.close();
    }
  });

  test('clears the count after a successful sign-in', async () => {
    const h = await build();
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await signIn(h.inject, { username: 'ops', password: 'wrong' });
      }
      await signIn(h.inject, CREDENTIALS);

      // Three more failures would be six in the window if the counter had
      // survived, and the last of them would answer 429.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await signIn(h.inject, { username: 'ops', password: 'wrong' });
        expect(response.statusCode, `attempt ${attempt}`).toBe(401);
      }
    } finally {
      await h.close();
    }
  });
});
