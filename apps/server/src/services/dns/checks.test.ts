import { MAX_DNS_CHECKS } from '@dashboard/shared';
import { describe, expect, test } from 'vitest';

import { openDatabase, type Db } from '../../db/client.js';
import {
  clearChecks,
  listChecks,
  recordCheck,
  summarizeChecks,
  type DnsCheckInput,
} from './checks.js';

function check(overrides: Partial<DnsCheckInput> = {}): DnsCheckInput {
  return {
    source: 'manual',
    ok: true,
    action: 'unchanged',
    failureReason: null,
    ipv6: '2606:4700::1',
    previousValue: null,
    provider: 'cloudflare',
    at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function rows(db: Db): number {
  return (
    db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM dns_checks').get()?.count ?? 0
  );
}

describe('recording checks', () => {
  test('lists the newest first, and the latest insert when two share a timestamp', () => {
    const db = openDatabase(':memory:');
    try {
      recordCheck(db, check({ at: '2026-01-01T00:00:00.000Z', ipv6: '2606:4700::1' }));
      recordCheck(db, check({ at: '2026-01-02T00:00:00.000Z', ipv6: '2606:4700::2' }));
      // Same millisecond: `at` alone cannot order these, which is why the listing
      // and the trim both fall back to rowid.
      recordCheck(db, check({ at: '2026-01-02T00:00:00.000Z', ipv6: '2606:4700::3' }));

      const { items, total } = listChecks(db, { limit: 10, offset: 0 });

      expect(total).toBe(3);
      expect(items.map((item) => item.ipv6)).toEqual([
        '2606:4700::3',
        '2606:4700::2',
        '2606:4700::1',
      ]);
    } finally {
      db.close();
    }
  });

  test('keeps the newest rows once the cap is reached', () => {
    const db = openDatabase(':memory:');
    try {
      // Seeded with one statement per row rather than through `recordCheck`, so
      // this measures the trim rather than five hundred of them.
      const seed = db.prepare(
        `INSERT INTO dns_checks
           (id, at, source, ok, action, failure_reason, ipv6, previous_value, provider)
         VALUES (?, ?, 'manual', 1, 'unchanged', NULL, '2606:4700::1', NULL, 'cloudflare')`,
      );
      db.transaction(() => {
        for (let i = 0; i < MAX_DNS_CHECKS; i += 1) {
          seed.run(`dnsc_seed${i}`, `2026-01-01T00:00:00.${String(i).padStart(3, '0')}Z`);
        }
      })();
      expect(rows(db)).toBe(MAX_DNS_CHECKS);

      // One more row, through the real path, is what triggers the trim.
      recordCheck(db, check({ at: '2026-06-01T00:00:00.000Z', ipv6: '2606:4700::newest' }));

      expect(rows(db)).toBe(MAX_DNS_CHECKS);
      expect(listChecks(db, { limit: 1, offset: 0 }).items[0]?.ipv6).toBe('2606:4700::newest');
      // The oldest seeded row is the one that went.
      expect(
        db
          .prepare<[string], { count: number }>(
            'SELECT COUNT(*) AS count FROM dns_checks WHERE id = ?',
          )
          .get('dnsc_seed0')?.count,
      ).toBe(0);
    } finally {
      db.close();
    }
  });

  test('records a failure with its reason', () => {
    const db = openDatabase(':memory:');
    try {
      recordCheck(
        db,
        check({ ok: false, action: 'failed', failureReason: 'dns_query_failed', ipv6: '' }),
      );

      expect(listChecks(db, { limit: 1, offset: 0 }).items[0]).toMatchObject({
        ok: false,
        action: 'failed',
        failureReason: 'dns_query_failed',
      });
    } finally {
      db.close();
    }
  });
});

describe('summarizeChecks', () => {
  test('counts totals, and counts only written changes as changed', () => {
    const db = openDatabase(':memory:');
    try {
      recordCheck(db, check({ at: '2026-01-01T00:00:00.000Z', action: 'created' }));
      recordCheck(db, check({ at: '2026-01-02T00:00:00.000Z', action: 'updated' }));
      recordCheck(db, check({ at: '2026-01-03T00:00:00.000Z', action: 'unchanged' }));
      recordCheck(db, check({ at: '2026-01-04T00:00:00.000Z', action: 'failed', ok: false }));

      expect(summarizeChecks(db)).toEqual({
        total: 4,
        succeeded: 3,
        failed: 1,
        changed: 2,
        lastRunAt: '2026-01-04T00:00:00.000Z',
        // An unchanged run is not a change, however recent it is.
        lastChangeAt: '2026-01-02T00:00:00.000Z',
      });
    } finally {
      db.close();
    }
  });

  test('reports nothing rather than zero timestamps when there is no history', () => {
    const db = openDatabase(':memory:');
    try {
      expect(summarizeChecks(db)).toEqual({
        total: 0,
        succeeded: 0,
        failed: 0,
        changed: 0,
        lastRunAt: null,
        lastChangeAt: null,
      });
    } finally {
      db.close();
    }
  });
});

describe('clearChecks', () => {
  test('removes everything and says how much went', () => {
    const db = openDatabase(':memory:');
    try {
      recordCheck(db, check());
      recordCheck(db, check());

      expect(clearChecks(db)).toBe(2);
      expect(summarizeChecks(db).total).toBe(0);
    } finally {
      db.close();
    }
  });
});
