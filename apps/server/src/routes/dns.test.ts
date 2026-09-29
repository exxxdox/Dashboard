/**
 * The DNS routes, over a real Fastify instance with `app.inject()`.
 *
 * The first app-level HTTP test in this repository, and deliberately narrow: the
 * point is the wiring no service test can see -- the guard covering the new
 * paths, the zod boundary on request bodies, and the shape of a failed update.
 * What the DNS console *does* is tested against the service.
 */

import { randomBytes } from 'node:crypto';
import type { DnsRecord } from '@dashboard/shared';
import { describe, expect, test } from 'vitest';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { AppContext } from '../context.js';
import { openDatabase, type Db } from '../db/client.js';
import { createAuthenticator, SESSION_COOKIE, type Authenticator } from '../lib/auth.js';
import { createSecretBox, type SecretBox } from '../lib/crypto.js';
import { createLogger } from '../lib/logger.js';
import { createDnsScheduler } from '../services/dns/scheduler.js';
import { createDnsService, type DnsService } from '../services/dns/service.js';
import { readSettingsRow, saveSettings } from '../services/dns/settings.js';
import { DnsFailureError, type DnsProvider } from '../services/dns/types.js';

const logger = createLogger({ level: 'silent', pretty: false });

const EXISTING: DnsRecord = {
  provider: 'cloudflare',
  recordName: 'home.example.com',
  recordType: 'AAAA',
  value: '2606:4700::1',
  recordId: 'rec-1',
  proxied: null,
  ttl: null,
};

const CLOUDFLARE = {
  provider: 'cloudflare' as const,
  cloudflareToken: 'token',
  cloudflareZoneId: 'zone-1',
  cloudflareRecordName: 'home.example.com',
};

/** Every DNS path the guard has to cover. */
const PROTECTED = [
  { method: 'GET' as const, url: '/api/dns' },
  { method: 'PATCH' as const, url: '/api/dns/settings', payload: {} },
  { method: 'POST' as const, url: '/api/dns/ipv6' },
  { method: 'POST' as const, url: '/api/dns/record' },
  { method: 'POST' as const, url: '/api/dns/update' },
  { method: 'POST' as const, url: '/api/dns/notification-test', payload: {} },
  { method: 'GET' as const, url: '/api/dns/checks' },
  { method: 'DELETE' as const, url: '/api/dns/checks' },
];

type Harness = {
  db: Db;
  box: SecretBox;
  app: Awaited<ReturnType<typeof buildApp>>;
  cookie: () => string;
  close: () => Promise<void>;
};

async function harness(overrides: { provider?: Partial<DnsProvider> } = {}): Promise<Harness> {
  const config = loadConfig({ SCRIPT_ROOT_CONTAINER: '/workspace', SERVE_WEB: 'false' });
  const db = openDatabase(':memory:');
  const box = createSecretBox(randomBytes(32));
  const auth: Authenticator = createAuthenticator({ username: 'ops', password: 'secret' });

  const provider = {
    name: 'cloudflare' as const,
    getRecord: async (): Promise<DnsRecord | null> => EXISTING,
    setIpv6: async (): Promise<'unchanged'> => 'unchanged',
    ...overrides.provider,
  };

  // The scheduler and the service reference each other here exactly as they do
  // at the composition root.
  let dns!: DnsService;
  const dnsScheduler = createDnsScheduler({
    service: { update: (source, signal) => dns.update(source, signal) },
    logger,
  });
  dns = createDnsService({
    db,
    box,
    logger,
    createProvider: () => provider as DnsProvider,
    detectIpv6: async (): Promise<string> => '2606:4700::1',
    sendNotification: async (): Promise<boolean> => false,
    getSchedule: () => dnsScheduler.snapshot(),
  });

  // Only the pieces these routes reach for are real. The execution graph is not
  // built at all: registering its routes touches `ctx` lazily, inside handlers.
  const ctx = {
    config,
    db,
    box,
    logger,
    auth,
    loginThrottle: { isLocked: () => false, recordFailure: () => {}, reset: () => {} },
    dns,
    dnsScheduler,
    isShuttingDown: () => false,
  } as unknown as AppContext;

  const app = await buildApp(ctx);

  return {
    db,
    box,
    app,
    cookie: () => `${SESSION_COOKIE}=${auth.issue(Date.now()).value}`,
    close: async () => {
      await app.close();
      db.close();
    },
  };
}

describe('the auth guard', () => {
  test('covers every DNS path', async () => {
    const h = await harness();
    try {
      for (const route of PROTECTED) {
        const response = await h.app.inject({
          method: route.method,
          url: route.url,
          ...(route.payload === undefined ? {} : { payload: route.payload }),
        });
        expect(response.statusCode, `${route.method} ${route.url}`).toBe(401);
      }
    } finally {
      await h.close();
    }
  });
});

describe('GET /api/dns', () => {
  test('answers with defaults when nothing has been saved', async () => {
    const h = await harness();
    try {
      const response = await h.app.inject({
        method: 'GET',
        url: '/api/dns',
        headers: { cookie: h.cookie() },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ settings: unknown; history: { total: number } }>();
      // Null rather than a defaulted object: the page has to tell "never
      // configured" from "configured and empty".
      expect(body.settings).toBeNull();
      expect(body.history.total).toBe(0);
    } finally {
      await h.close();
    }
  });
});

describe('PATCH /api/dns/settings', () => {
  test('rejects a body outside the schema', async () => {
    const h = await harness();
    try {
      const response = await h.app.inject({
        method: 'PATCH',
        url: '/api/dns/settings',
        headers: { cookie: h.cookie() },
        payload: { intervalMinutes: 0 },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('validation_failed');
    } finally {
      await h.close();
    }
  });

  test('refuses to clear the active provider credential, and stores nothing', async () => {
    const h = await harness();
    try {
      saveSettings(h.db, h.box, CLOUDFLARE);
      const before = readSettingsRow(h.db);

      const response = await h.app.inject({
        method: 'PATCH',
        url: '/api/dns/settings',
        headers: { cookie: h.cookie() },
        payload: { clearCloudflareToken: true },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json<{ error: { message: string } }>().error.message).toContain(
        'Cloudflare API token',
      );
      expect(readSettingsRow(h.db)).toEqual(before);
    } finally {
      await h.close();
    }
  });
});

describe('POST /api/dns/update', () => {
  test('answers 200 with the reason when the run failed', async () => {
    const h = await harness({
      provider: {
        getRecord: async () => {
          throw new DnsFailureError('Cloudflare rejected the record query', 'dns_query_failed');
        },
      },
    });
    try {
      saveSettings(h.db, h.box, CLOUDFLARE);

      const response = await h.app.inject({
        method: 'POST',
        url: '/api/dns/update',
        headers: { cookie: h.cookie() },
      });

      // A failed check is a result, not a transport error.
      expect(response.statusCode).toBe(200);
      expect(response.json<{ action: string; failureReason: string }>()).toMatchObject({
        action: 'failed',
        failureReason: 'dns_query_failed',
      });
    } finally {
      await h.close();
    }
  });
});

describe('GET /api/dns/checks', () => {
  test('refuses a limit outside the range rather than clamping it', async () => {
    const h = await harness();
    try {
      const response = await h.app.inject({
        method: 'GET',
        url: '/api/dns/checks?limit=0',
        headers: { cookie: h.cookie() },
      });

      expect(response.statusCode).toBe(422);
    } finally {
      await h.close();
    }
  });
});
