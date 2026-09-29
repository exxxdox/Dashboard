/**
 * The sign-in throttle's order of decisions.
 *
 * This is the one place the dashboard overrules its own instinct, and the rule
 * is invisible on the happy path: a correct password has to get in even while
 * the source address is locked, because behind a reverse proxy every client
 * shares one source address.
 */

import { randomBytes } from 'node:crypto';
import { describe, expect, test } from 'vitest';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { AppContext } from '../context.js';
import { openDatabase } from '../db/client.js';
import { createAuthenticator, createLoginThrottle } from '../lib/auth.js';
import { createSecretBox } from '../lib/crypto.js';
import { createLogger } from '../lib/logger.js';

const CREDENTIALS = { username: 'ops', password: 'secret' };

async function build(): Promise<{
  inject: Awaited<ReturnType<typeof buildApp>>['inject'];
  close: () => Promise<void>;
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

  const app = await buildApp(ctx);
  return {
    inject: app.inject.bind(app),
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
  test('answers 429 on the fifth wrong attempt from one address', async () => {
    const h = await build();
    try {
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const response = await signIn(h.inject, { username: 'ops', password: 'wrong' });
        expect(response.statusCode, `attempt ${attempt}`).toBe(401);
      }

      const fifth = await signIn(h.inject, { username: 'ops', password: 'wrong' });
      expect(fifth.statusCode).toBe(429);
      expect(fifth.headers['retry-after']).toBe('900');
    } finally {
      await h.close();
    }
  });

  test('lets the right password through from an address that is already locked', async () => {
    // The rule. Without it, anyone who can reach the sign-in form locks out
    // everyone else -- including whoever holds the password -- for fifteen
    // minutes per five guesses, keyed by an address they all share.
    const h = await build();
    try {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await signIn(h.inject, { username: 'ops', password: 'wrong' });
      }

      const response = await signIn(h.inject, CREDENTIALS);

      expect(response.statusCode).toBe(200);
      expect(response.headers['set-cookie']).toBeDefined();
      expect(response.json<{ signedIn: boolean }>().signedIn).toBe(true);
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
