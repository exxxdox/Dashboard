/**
 * The history of DNS checks.
 *
 * A side channel, deliberately: whether a run was recorded must never change
 * what that run did, so the service logs a failure here and carries on. The
 * summary is computed by the database rather than from the rows on the current
 * page, so a page of history and the totals above it cannot disagree.
 */

import type {
  DnsAction,
  DnsCheck,
  DnsCheckList,
  DnsCheckSource,
  DnsCheckSummary,
  DnsFailureReason,
  DnsProviderName,
} from '@dashboard/shared';
import { MAX_DNS_CHECKS } from '@dashboard/shared';

import type { Db } from '../../db/client.js';
import { newDnsCheckId } from '../../lib/ids.js';

export type DnsCheckRow = {
  id: string;
  at: string;
  source: DnsCheckSource;
  ok: number;
  action: DnsAction;
  failure_reason: DnsFailureReason | null;
  ipv6: string;
  previous_value: string | null;
  /** Null when the run failed before a provider had been chosen at all. */
  provider: DnsProviderName | null;
};

export type DnsCheckInput = {
  source: DnsCheckSource;
  ok: boolean;
  action: DnsAction;
  failureReason: DnsFailureReason | null;
  ipv6: string;
  previousValue: string | null;
  /** Null when the run failed before a provider had been chosen at all. */
  provider: DnsProviderName | null;
  at: string;
};

export type DnsCheckFilter = {
  limit: number;
  offset: number;
};

const INSERT = `INSERT INTO dns_checks (
    id, at, source, ok, action, failure_reason, ipv6, previous_value, provider
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * Keep the newest rows, at or below the cap.
 *
 * `rowid` breaks the tie: `at` has millisecond resolution and ids are random, so
 * two runs inside the same millisecond would otherwise be ordered arbitrarily --
 * and a trim that disagrees with the listing order deletes the wrong row.
 */
const TRIM = `DELETE FROM dns_checks WHERE id NOT IN (
    SELECT id FROM dns_checks ORDER BY at DESC, rowid DESC LIMIT ?
  )`;

export function recordCheck(db: Db, input: DnsCheckInput): void {
  // Insert and trim in one transaction: the table must not be able to grow past
  // the cap, not even for the moment between two statements.
  const write = db.transaction(() => {
    db.prepare(INSERT).run(
      newDnsCheckId(),
      input.at,
      input.source,
      input.ok ? 1 : 0,
      input.action,
      input.failureReason,
      input.ipv6,
      input.previousValue,
      input.provider,
    );
    db.prepare(TRIM).run(MAX_DNS_CHECKS);
  });
  write();
}

export function listChecks(db: Db, filter: DnsCheckFilter): DnsCheckList {
  const rows = db
    .prepare<[number, number], DnsCheckRow>(
      'SELECT * FROM dns_checks ORDER BY at DESC, rowid DESC LIMIT ? OFFSET ?',
    )
    .all(filter.limit, filter.offset);
  const total = db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM dns_checks').get();
  return { items: rows.map(toCheck), total: total?.count ?? 0 };
}

export function listRecentChecks(db: Db, limit: number): DnsCheck[] {
  return listChecks(db, { limit, offset: 0 }).items;
}

/**
 * Totals over the whole table.
 *
 * `changed` counts only what was actually written, so a scheduled check that
 * keeps finding the same address raises `succeeded` and leaves `changed` alone --
 * which is the difference an operator is looking for.
 */
export function summarizeChecks(db: Db): DnsCheckSummary {
  const row = db
    .prepare<
      [],
      {
        total: number;
        succeeded: number;
        changed: number;
        last_run_at: string | null;
        last_change_at: string | null;
      }
    >(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(ok), 0) AS succeeded,
         COALESCE(SUM(CASE WHEN ok = 1 AND action IN ('created','updated') THEN 1 ELSE 0 END), 0) AS changed,
         MAX(at) AS last_run_at,
         MAX(CASE WHEN ok = 1 AND action IN ('created','updated') THEN at END) AS last_change_at
       FROM dns_checks`,
    )
    .get();

  const total = row?.total ?? 0;
  const succeeded = row?.succeeded ?? 0;
  return {
    total,
    succeeded,
    failed: total - succeeded,
    changed: row?.changed ?? 0,
    lastRunAt: row?.last_run_at ?? null,
    lastChangeAt: row?.last_change_at ?? null,
  };
}

/** Delete everything; returns how many rows went. */
export function clearChecks(db: Db): number {
  return db.prepare('DELETE FROM dns_checks').run().changes;
}

function toCheck(row: DnsCheckRow): DnsCheck {
  return {
    id: row.id,
    at: row.at,
    source: row.source,
    ok: row.ok === 1,
    action: row.action,
    failureReason: row.failure_reason,
    ipv6: row.ipv6,
    previousValue: row.previous_value,
    provider: row.provider,
  };
}
