import type { DnsAction, DnsFailureReason, DnsUpdateResult } from '@dashboard/shared';
import { describe, expect, test } from 'vitest';

import { ACTION_LABEL, FAILURE_TEXT, PROVIDER_LABEL, SOURCE_LABEL, describeUpdate } from './dns.js';

/**
 * The lists are repeated here on purpose. The `Record<Union, string>` types
 * already make a missing entry a compile error; what these tests catch is an
 * entry that exists but says nothing, which is the shape a rushed addition
 * takes.
 */
const ACTIONS: DnsAction[] = ['created', 'updated', 'unchanged', 'failed'];
const REASONS: DnsFailureReason[] = [
  'not_configured',
  'invalid_settings',
  'ipv6_detect_failed',
  'ipv6_not_global',
  'dns_query_failed',
  'dns_write_failed',
  'record_missing',
  'record_identity_missing',
];

function result(overrides: Partial<DnsUpdateResult> = {}): DnsUpdateResult {
  return {
    provider: 'cloudflare',
    action: 'unchanged',
    ipv6: '2606:4700::1',
    previousValue: null,
    recordName: 'home.example.com',
    failureReason: null,
    notificationAttempted: false,
    notificationFailed: false,
    ...overrides,
  };
}

describe('copy tables', () => {
  test('has words for every action, reason, source and provider', () => {
    for (const action of ACTIONS) expect(ACTION_LABEL[action].trim()).not.toBe('');
    for (const reason of REASONS) expect(FAILURE_TEXT[reason].trim()).not.toBe('');
    expect(SOURCE_LABEL.manual.trim()).not.toBe('');
    expect(PROVIDER_LABEL.alibaba.trim()).not.toBe('');
  });
});

describe('describeUpdate', () => {
  test('says what was created, and where', () => {
    expect(
      describeUpdate(result({ action: 'created', ipv6: '2606:4700::2', previousValue: null })),
    ).toBe('Created home.example.com, pointing at 2606:4700::2.');
  });

  test('shows both ends of an update', () => {
    expect(
      describeUpdate(
        result({ action: 'updated', ipv6: '2606:4700::2', previousValue: '2606:4700::1' }),
      ),
    ).toBe('Updated home.example.com from 2606:4700::1 to 2606:4700::2.');
  });

  test('says explicitly that an unchanged record wrote nothing', () => {
    // The sentence an operator should be able to trust: a run reporting no
    // change made no API call at all.
    expect(describeUpdate(result({ action: 'unchanged' }))).toBe(
      'home.example.com already points at 2606:4700::1; nothing was written.',
    );
  });

  test('explains a failure from its code', () => {
    expect(describeUpdate(result({ action: 'failed', failureReason: 'dns_query_failed' }))).toBe(
      FAILURE_TEXT.dns_query_failed,
    );
    // A failure with no code is still a sentence rather than an empty string.
    expect(describeUpdate(result({ action: 'failed', failureReason: null }))).toBe(
      'The check failed.',
    );
  });

  test('falls back to "the record" when no name was resolved', () => {
    expect(describeUpdate(result({ action: 'unchanged', recordName: '' }))).toContain('the record');
  });
});
