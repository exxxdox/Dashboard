import { describe, expect, it } from 'vitest';
import type { DnsUpdateResult, SyncResult, TargetCheckResult } from '@dashboard/shared';

import { translate } from './i18n';
import { recordProbeOutcome, syncOutcome, targetCheckOutcome, updateOutcome } from './outcome';

/**
 * Asserted through the real dictionary rather than a stub, the way
 * `format.test.ts` does it: the point of these functions is which words a
 * result turns into, and a stub would only prove that a key was passed along.
 */
const t = ((key, params) => translate('en', key, params)) as Parameters<
  typeof targetCheckOutcome
>[0];
const zh = ((key, params) => translate('zh', key, params)) as Parameters<
  typeof targetCheckOutcome
>[0];

const check = (overrides: Partial<TargetCheckResult> = {}): TargetCheckResult => ({
  reachable: true,
  latencyMs: 42,
  detail: '',
  hostShell: 'bash 5.2.15',
  hostUser: 'deploy',
  hasSetsid: true,
  workDirOk: true,
  stagingOk: true,
  ...overrides,
});

describe('targetCheckOutcome', () => {
  it('confirms a host that can actually run something', () => {
    const outcome = targetCheckOutcome(t, check());

    expect(outcome.tone).toBe('success');
    expect(outcome.message).toBe(t('targets.ready'));
    expect(outcome.detail).toContain('42ms');
    expect(outcome.detail).toContain('deploy');
  });

  it('calls a host that cannot enter its working directory not ready', () => {
    // The whole reason readiness is three facts: this host answers SSH, so
    // reachability alone would report a host every run would fail on.
    const outcome = targetCheckOutcome(t, check({ workDirOk: false }));

    expect(outcome.tone).toBe('error');
    expect(outcome.message).toBe(t('targets.cannotRun'));
    expect(outcome.detail).toContain(t('targets.fact.workDir') + ' ' + t('targets.fact.failed'));
    // The advice names the config field, which is what makes it actionable.
    expect(outcome.detail).toContain('workDir');
  });

  it('mentions setsid without treating it as a failure', () => {
    const outcome = targetCheckOutcome(t, check({ hasSetsid: false }));

    expect(outcome.tone).toBe('success');
    expect(outcome.detail).toContain('setsid');
  });

  it('says the same thing in Chinese', () => {
    const outcome = targetCheckOutcome(zh, check({ workDirOk: false }));

    expect(outcome.message).toBe(translate('zh', 'targets.cannotRun'));
    expect(outcome).not.toEqual(targetCheckOutcome(t, check({ workDirOk: false })));
  });
});

describe('syncOutcome', () => {
  const sync = (overrides: Partial<SyncResult> = {}): SyncResult => ({
    sourceId: 's1',
    added: 2,
    updated: 1,
    removed: 0,
    total: 12,
    warnings: [],
    ...overrides,
  });

  it('reports the counts as a confirmation', () => {
    const outcome = syncOutcome(t, sync());

    expect(outcome.tone).toBe('success');
    expect(outcome.detail).toContain('2');
    expect(outcome.detail).toContain('12');
  });

  it('downgrades to a warning when the sync complained', () => {
    // A sync that got through but warned is not a failure, and it is not a
    // clean success either -- the warning is the reason to look.
    const outcome = syncOutcome(t, sync({ warnings: ['skipped notes.txt'] }));

    expect(outcome.tone).toBe('warning');
    expect(outcome.detail).toContain('skipped notes.txt');
  });
});

describe('recordProbeOutcome', () => {
  it('treats "no record yet" as an answer, not an error', () => {
    // For Cloudflare this is the state that precedes creating one, so reporting
    // it as a failure would be reporting the normal path as a problem.
    const outcome = recordProbeOutcome(t, { record: null, queriedAt: '2026-01-01T00:00:00Z' });

    expect(outcome.tone).toBe('success');
    expect(outcome.detail).toBe(t('dns.noRecord'));
  });

  it('names the record and its address when there is one', () => {
    const outcome = recordProbeOutcome(t, {
      record: {
        provider: 'cloudflare',
        recordName: 'home.example.com',
        recordType: 'AAAA',
        value: '2001:db8::1',
        recordId: 'r1',
        proxied: false,
        ttl: 300,
      },
      queriedAt: '2026-01-01T00:00:00Z',
    });

    expect(outcome.detail).toContain('home.example.com');
    expect(outcome.detail).toContain('2001:db8::1');
  });
});

describe('updateOutcome', () => {
  const update = (overrides: Partial<DnsUpdateResult> = {}): DnsUpdateResult => ({
    provider: 'cloudflare',
    action: 'created',
    ipv6: '2001:db8::1',
    previousValue: null,
    recordName: 'home.example.com',
    failureReason: null,
    notificationAttempted: true,
    notificationFailed: false,
    ...overrides,
  });

  it('is a success when something was written', () => {
    expect(updateOutcome(t, update()).tone).toBe('success');
  });

  it('is not a success when nothing needed writing', () => {
    // Reporting "no change" in green would read as "something happened".
    expect(updateOutcome(t, update({ action: 'unchanged' })).tone).toBe('info');
  });

  it('is an error when the run failed', () => {
    const outcome = updateOutcome(t, update({ action: 'failed', failureReason: 'dns_query_failed' }));

    expect(outcome.tone).toBe('error');
    expect(outcome.message).toBe(t('dns.failure.dns_query_failed'));
  });

  it('carries a failed notification beside the outcome rather than instead of it', () => {
    const outcome = updateOutcome(t, update({ notificationFailed: true }));

    expect(outcome.tone).toBe('success');
    expect(outcome.detail).toBe(t('dns.result.notificationFailed'));
  });
});
