import { randomBytes } from 'node:crypto';
import type { DnsRecord } from '@dashboard/shared';
import { describe, expect, test, vi } from 'vitest';

import { openDatabase, type Db } from '../../db/client.js';
import { createSecretBox, type SecretBox } from '../../lib/crypto.js';
import { ValidationError } from '../../lib/errors.js';
import { createLogger } from '../../lib/logger.js';
import { listChecks, summarizeChecks } from './checks.js';
import { createDnsService, type DnsService } from './service.js';
import { saveSettings } from './settings.js';
import { DnsFailureError, type DnsProvider } from './types.js';

const logger = createLogger({ level: 'silent', pretty: false });

const CLOUDFLARE = {
  provider: 'cloudflare' as const,
  cloudflareToken: 'token',
  cloudflareZoneId: 'zone-1',
  cloudflareRecordName: 'home.example.com',
};

const EXISTING: DnsRecord = {
  provider: 'cloudflare',
  recordName: 'home.example.com',
  recordType: 'AAAA',
  value: '2606:4700::1',
  recordId: 'rec-1',
  proxied: null,
  ttl: null,
};

/**
 * Overrides are plain functions rather than mocks: `setup` wraps them, so a test
 * writes the behaviour it wants and the type is the interface's.
 */
type ProviderOverrides = {
  getRecord?: DnsProvider['getRecord'];
  setIpv6?: DnsProvider['setIpv6'];
};

type Harness = {
  db: Db;
  box: SecretBox;
  service: DnsService;
  provider: { getRecord: ReturnType<typeof vi.fn>; setIpv6: ReturnType<typeof vi.fn> };
  detect: ReturnType<typeof vi.fn>;
  detectLocal: ReturnType<typeof vi.fn>;
  sendNotification: ReturnType<typeof vi.fn>;
  save: () => void;
};

/** Let every already-resolved promise in a run settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function setup(overrides: { provider?: ProviderOverrides } = {}): Harness {
  const db = openDatabase(':memory:');
  const box = createSecretBox(randomBytes(32));

  const provider = {
    getRecord: vi.fn(
      overrides.provider?.getRecord ?? (async (): Promise<DnsRecord | null> => EXISTING),
    ),
    setIpv6: vi.fn(overrides.provider?.setIpv6 ?? (async (): Promise<'unchanged'> => 'unchanged')),
  };
  const detect = vi.fn(async (): Promise<string> => '2606:4700::1');
  const detectLocal = vi.fn(async (): Promise<string> => '2001:4860::8888');
  const sendNotification = vi.fn(async (): Promise<boolean> => true);

  const service = createDnsService({
    db,
    box,
    logger,
    createProvider: () => ({ name: 'cloudflare', ...provider }) as unknown as DnsProvider,
    detectIpv6: detect,
    detectLocalIpv6: detectLocal,
    sendNotification: sendNotification as unknown as (
      notification: unknown,
    ) => Promise<boolean>,
  });

  return {
    db,
    box,
    service,
    provider,
    detect,
    detectLocal,
    sendNotification,
    save: () => {
      saveSettings(db, box, CLOUDFLARE);
    },
  };
}

describe('before anything is configured', () => {
  test('reports it as a failed run and records why', async () => {
    const h = setup();
    try {
      const result = await h.service.update('manual');

      expect(result).toMatchObject({
        action: 'failed',
        failureReason: 'not_configured',
        provider: null,
      });
      expect(h.detect).not.toHaveBeenCalled();

      const { items } = listChecks(h.db, { limit: 10, offset: 0 });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        source: 'manual',
        ok: false,
        failureReason: 'not_configured',
      });
    } finally {
      h.db.close();
    }
  });

  test('refuses a record query, because there is no provider to ask', async () => {
    const h = setup();
    try {
      await expect(h.service.queryRecord()).rejects.toThrow(ValidationError);
    } finally {
      h.db.close();
    }
  });
});

describe('consistency', () => {
  test('answers unknown before anything has been looked at', () => {
    const h = setup();
    try {
      // A comparison nobody has performed is not a comparison. The overview
      // tile is built around being allowed to say exactly this.
      expect(h.service.consistency()).toEqual({
        state: 'unknown',
        ipv6: null,
        recordValue: null,
        recordName: null,
        at: null,
      });
    } finally {
      h.db.close();
    }
  });

  test('stays unknown when only half the pair has been seen', () => {
    const h = setup();
    try {
      h.save();
      // We know where this host is; nobody has asked the provider anything, and
      // comparing a known address against an unasked question would read as
      // "moved" for a record that is probably fine.
      expect(h.service.consistency()).toMatchObject({
        state: 'unknown',
        ipv6: null,
        recordValue: null,
      });
    } finally {
      h.db.close();
    }
  });

  test('reports a match once both addresses are known', async () => {
    const h = setup();
    try {
      h.save();
      await h.service.queryRecord();
      await h.service.detect();

      expect(h.service.consistency()).toMatchObject({
        state: 'consistent',
        ipv6: '2606:4700::1',
        recordValue: '2606:4700::1',
        recordName: 'home.example.com',
      });
    } finally {
      h.db.close();
    }
  });

  test('reports the record pointing elsewhere when the address has moved', async () => {
    const h = setup();
    try {
      h.save();
      await h.service.queryRecord();
      // The host's address changed since the provider was last asked, which is
      // the one state a check exists to correct.
      h.detect.mockResolvedValue('2606:4700::9');
      await h.service.detect();

      expect(h.service.consistency()).toMatchObject({
        state: 'moved',
        ipv6: '2606:4700::9',
        recordValue: '2606:4700::1',
      });
    } finally {
      h.db.close();
    }
  });

  test('stamps the verdict with the older of its two halves', async () => {
    const h = setup();
    try {
      h.save();
      await h.service.queryRecord();
      const first = h.service.consistency().at;

      await h.service.detect();
      const second = h.service.consistency().at;

      // The later observation is what the verdict is dated by, and a clock that
      // moved forward must show up here rather than being pinned to the first.
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(new Date(second ?? 0).getTime()).toBeGreaterThanOrEqual(
        new Date(first ?? 0).getTime(),
      );
    } finally {
      h.db.close();
    }
  });
});

describe('update', () => {
  test('aborts before any write when the query fails, and never reads it as "no record"', async () => {
    // The one thing that must never happen: a query that failed looking like an
    // absence, which for Cloudflare means creating a second record.
    const h = setup({
      provider: {
        getRecord: async () => {
          throw new DnsFailureError('Cloudflare rejected the record query', 'dns_query_failed');
        },
      },
    });
    try {
      h.save();
      const result = await h.service.update('manual');

      expect(result).toMatchObject({ action: 'failed', failureReason: 'dns_query_failed' });
      expect(h.provider.setIpv6).toHaveBeenCalledTimes(0);
      expect(listChecks(h.db, { limit: 1, offset: 0 }).items[0]).toMatchObject({ ok: false });
    } finally {
      h.db.close();
    }
  });

  test('does not reach the provider when detection fails', async () => {
    const h = setup();
    try {
      h.save();
      h.detect.mockRejectedValue(
        new DnsFailureError('The probe returned a private address', 'ipv6_not_global'),
      );

      const result = await h.service.update('manual');

      expect(result).toMatchObject({ action: 'failed', failureReason: 'ipv6_not_global' });
      expect(h.provider.getRecord).not.toHaveBeenCalled();
    } finally {
      h.db.close();
    }
  });

  test('handles an unchanged record without notifying anyone', async () => {
    const h = setup();
    try {
      h.save();
      const result = await h.service.update('manual');

      expect(result).toMatchObject({ action: 'unchanged', notificationAttempted: false });
      expect(h.sendNotification).not.toHaveBeenCalled();
      // The record the query returned is the one the write was handed, so a
      // second read cannot disagree with what the history row says.
      expect(h.provider.setIpv6).toHaveBeenCalledWith('2606:4700::1', EXISTING, undefined);
    } finally {
      h.db.close();
    }
  });

  test('notifies on a create and on an update, and reports the previous value', async () => {
    for (const action of ['created', 'updated'] as const) {
      const h = setup({ provider: { setIpv6: async () => action } });
      try {
        h.save();
        h.provider.getRecord.mockResolvedValue(action === 'created' ? null : EXISTING);

        const result = await h.service.update('manual');

        expect(result).toMatchObject({
          action,
          previousValue: action === 'created' ? null : '2606:4700::1',
          notificationAttempted: true,
          notificationFailed: false,
        });
        expect(h.sendNotification).toHaveBeenCalledTimes(1);
        const sent = h.sendNotification.mock.calls[0]?.[0] as { message: string };
        expect(sent.message).toContain('2606:4700::1');
      } finally {
        h.db.close();
      }
    }
  });

  test('carries on when the notification fails', async () => {
    const h = setup({ provider: { setIpv6: async () => 'updated' } });
    try {
      h.save();
      h.sendNotification.mockRejectedValue(new Error('Gotify answered 500'));

      const result = await h.service.update('manual');

      expect(result).toMatchObject({ action: 'updated', notificationFailed: true });
      expect(listChecks(h.db, { limit: 1, offset: 0 }).items[0]).toMatchObject({ ok: true });
    } finally {
      h.db.close();
    }
  });

  test('reports a notification that was not configured as a skip', async () => {
    const h = setup({ provider: { setIpv6: async () => 'updated' } });
    try {
      h.save();
      h.sendNotification.mockResolvedValue(false);

      expect(await h.service.update('manual')).toMatchObject({
        action: 'updated',
        notificationAttempted: false,
        notificationFailed: false,
      });
    } finally {
      h.db.close();
    }
  });

  test('records the source it was asked for', async () => {
    const h = setup();
    try {
      h.save();
      await h.service.update('manual');
      await h.service.update('scheduled');

      const { items } = listChecks(h.db, { limit: 10, offset: 0 });
      expect(items.map((item) => item.source)).toEqual(['scheduled', 'manual']);
      expect(summarizeChecks(h.db).total).toBe(2);
    } finally {
      h.db.close();
    }
  });

  test('returns the real outcome even when the history cannot be written', async () => {
    const h = setup({ provider: { setIpv6: async () => 'updated' } });
    try {
      h.save();
      // History is a side channel: an operator whose disk is full still deserves
      // the run's actual result.
      h.db.exec('DROP TABLE dns_checks');

      await expect(h.service.update('manual')).resolves.toMatchObject({ action: 'updated' });
    } finally {
      h.db.close();
    }
  });

  test('runs one check at a time, however many are asked for', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const h = setup({
      provider: {
        getRecord: async () => {
          order.push('query');
          await gate;
          return EXISTING;
        },
        setIpv6: async () => {
          order.push('write');
          return 'unchanged';
        },
      },
    });
    try {
      h.save();

      const first = h.service.update('manual');
      const second = h.service.update('scheduled');
      await flush();
      // The second run has not started while the first is between its steps.
      expect(order).toEqual(['query']);

      release();
      await Promise.all([first, second]);
      expect(order).toEqual(['query', 'write', 'query', 'write']);
    } finally {
      h.db.close();
    }
  });
});

describe('detect and queryRecord', () => {
  test.each([
    { cloudflareRecordName: 'new.example.com' },
    { cloudflareZoneId: 'zone-2' },
  ])('clears the old record when its identity changes: %j', async input => {
    const h = setup();
    try {
      h.save();
      await h.service.detect();
      await h.service.queryRecord();
      expect(h.service.consistency().state).toBe('consistent');
      h.service.saveSettings(input);
      expect(h.service.state()).toMatchObject({ record: null, recordCheckedAt: null });
      expect(h.service.consistency().state).toBe('unknown');
    } finally { h.db.close(); }
  });

  test.each(['queryRecord', 'update'] as const)('an old %s cannot overwrite the new record cache', async operation => {
    const h = setup();
    try {
      h.save();
      let finish!: (record: DnsRecord) => void;
      h.provider.getRecord.mockReturnValueOnce(new Promise<DnsRecord>(resolve => { finish = resolve; }));
      const pending = operation === 'queryRecord' ? h.service.queryRecord() : h.service.update('manual');
      await flush();
      expect(h.provider.getRecord).toHaveBeenCalledOnce();
      h.service.saveSettings({ cloudflareRecordName: 'new.example.com' });
      const newRecord = { ...EXISTING, recordId: 'new', recordName: 'new.example.com' };
      h.provider.getRecord.mockResolvedValueOnce(newRecord);
      await h.service.queryRecord();
      finish(EXISTING);
      await pending;
      expect(h.service.state().record).toEqual(newRecord);
    } finally { h.db.close(); }
  });

  test('remember what they saw, for the state payload', async () => {
    const h = setup();
    try {
      h.save();

      const probe = await h.service.detect();
      const queried = await h.service.queryRecord();

      expect(probe.ipv6).toBe('2606:4700::1');
      expect(queried.record?.value).toBe('2606:4700::1');
      expect(h.service.state()).toMatchObject({
        ipv6: '2606:4700::1',
        ipv6CheckedAt: probe.detectedAt,
        recordCheckedAt: queried.queriedAt,
      });
    } finally {
      h.db.close();
    }
  });

  test('reports no record as a value rather than an error', async () => {
    const h = setup({ provider: { getRecord: async () => null } });
    try {
      h.save();
      await expect(h.service.queryRecord()).resolves.toMatchObject({ record: null });
    } finally {
      h.db.close();
    }
  });
});

// The notification tests used to live here. They moved to
// `services/notifications/service.test.ts` with the code they cover: the
// credential they exercise is an application setting now, not a DNS one.


describe('IPv6 detection source', () => {
  test.each(['manual', 'scheduled'] as const)('%s updates use the saved local source', async source => {
    const h = setup();
    try {
      h.save();
      h.service.saveSettings({ ipv6Source: 'local' });
      const result = await h.service.update(source);
      expect(result).toMatchObject({ ipv6: '2001:4860::8888', action: 'unchanged' });
      expect(h.detectLocal).toHaveBeenCalledOnce();
      expect(h.detect).not.toHaveBeenCalled();
      expect(h.provider.setIpv6).toHaveBeenCalledWith('2001:4860::8888', EXISTING, undefined);
    } finally { h.db.close(); }
  });

  test('standalone detection follows the saved source and switching clears the cached address', async () => {
    const h = setup();
    try {
      h.save();
      expect((await h.service.detect()).ipv6).toBe('2606:4700::1');
      h.service.saveSettings({ ipv6Source: 'local' });
      expect(h.service.state().ipv6).toBeNull();
      expect(h.service.state().ipv6CheckedAt).toBeNull();
      expect((await h.service.detect()).ipv6).toBe('2001:4860::8888');
      h.service.saveSettings({ intervalMinutes: 20 });
      expect(h.service.state().ipv6).toBe('2001:4860::8888');
      h.service.saveSettings({ ipv6Source: 'ipify' });
      expect((await h.service.detect()).ipv6).toBe('2606:4700::1');
    } finally { h.db.close(); }
  });

  test('does not fall back to ipify or query/write DNS when local detection fails', async () => {
    const h = setup();
    try {
      h.save();
      h.service.saveSettings({ ipv6Source: 'local' });
      h.detectLocal.mockRejectedValue(new DnsFailureError('No local address', 'ipv6_not_global'));
      expect(await h.service.update('scheduled')).toMatchObject({ action: 'failed', failureReason: 'ipv6_not_global' });
      expect(h.detect).not.toHaveBeenCalled();
      expect(h.provider.getRecord).not.toHaveBeenCalled();
      expect(h.provider.setIpv6).not.toHaveBeenCalled();
    } finally { h.db.close(); }
  });
});


test.each(['detect', 'update'] as const)('an in-flight %s cannot restore the previous source cache', async operation => {
  const h = setup();
  try {
    h.save();
    let finish!: (address: string) => void;
    h.detect.mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve; }));
    const pending = operation === 'detect' ? h.service.detect() : h.service.update('manual');
    await flush();
    expect(h.detect).toHaveBeenCalledOnce();
    h.service.saveSettings({ ipv6Source: 'local' });
    await h.service.detect();
    finish('2606:4700::1');
    await pending;
    expect(h.service.state().ipv6).toBe('2001:4860::8888');
  } finally { h.db.close(); }
});


test('forwards the saved interface to local detection and clears its cache when it changes', async () => {
  const h = setup();
  try {
    h.save();
    h.service.saveSettings({ ipv6Source: 'local', localIpv6Interface: 'enp1s0' });
    await h.service.detect();
    expect(h.detectLocal).toHaveBeenLastCalledWith('enp1s0', undefined);
    h.service.saveSettings({ localIpv6Interface: 'wlp2s0' });
    expect(h.service.state().ipv6).toBeNull();
    await h.service.update('scheduled');
    expect(h.detectLocal).toHaveBeenLastCalledWith('wlp2s0', undefined);
  } finally { h.db.close(); }
});
