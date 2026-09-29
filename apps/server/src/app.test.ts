/**
 * The assembly itself: the headers every response carries.
 *
 * The policy is easy to lose -- it is one hook, and nothing else in the suite
 * would fail if it disappeared -- so it gets a test rather than a comment.
 */

import { randomBytes } from 'node:crypto';
import { describe, expect, test } from 'vitest';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import type { AppContext } from './context.js';
import { openDatabase } from './db/client.js';
import { createAuthenticator, createLoginThrottle } from './lib/auth.js';
import { createSecretBox } from './lib/crypto.js';
import { createLogger } from './lib/logger.js';

/** Only what `buildApp` reaches for; the rest of the object graph is not built. */
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
    auth: createAuthenticator({ username: 'ops', password: 'secret' }),
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

describe('security headers', () => {
  test('are sent with an ordinary answer', async () => {
    const h = await build();
    try {
      const response = await h.inject({ method: 'GET', url: '/api/health' });

      const csp = response.headers['content-security-policy'];
      expect(csp).toContain("default-src 'self'");
      // The one directive that stops a clickjacked "check and update" button.
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("form-action 'none'");
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      await h.close();
    }
  });

  test('are sent with an error as well, which leaves by another path', async () => {
    const h = await build();
    try {
      // No session: the guard answers 401 through the error handler.
      const response = await h.inject({ method: 'GET', url: '/api/targets' });

      expect(response.statusCode).toBe(401);
      expect(response.headers['content-security-policy']).toContain("default-src 'self'");
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      await h.close();
    }
  });
});
