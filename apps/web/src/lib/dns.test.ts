import type { DnsAction, DnsFailureReason, DnsUpdateResult } from '@dashboard/shared';
import { describe, expect, test } from 'vitest';

import {
  describeUpdate,
  failureText,
  providerLabel,
  resultLabel,
  sourceLabel,
} from './dns.js';
import { translate, type Locale, type MessageKey, type MessageParams } from './i18n';

/**
 * The translator a page would hand in, built from the real dictionary.
 *
 * A stub would prove nothing here: the whole point of these functions is that a
 * code and its wording stay in step, and only the real lookup can show that.
 */
function translator(locale: Locale): (key: MessageKey, params?: MessageParams) => string {
  return (key, params) => translate(locale, key, params);
}

const en = translator('en');

/**
 * The lists are repeated here on purpose. The unions on the shared contract
 * already make a missing entry a compile error; what these tests catch is an
 * entry that exists but says nothing -- and, because `translate` falls back to
 * the key itself, an entry that exists in one language and not the other.
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
const LOCALES: Locale[] = ['en', 'zh'];

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
  test('has words for every action, reason, source and provider, in both languages', () => {
    for (const locale of LOCALES) {
      const t = translator(locale);
      for (const action of ACTIONS) {
        const words = resultLabel(t, action);
        expect(words.trim()).not.toBe('');
        // The fallback for an unknown key is the key itself.
        expect(words).not.toBe(`dns.resultLabel.${action}`);
      }
      for (const reason of REASONS) {
        expect(failureText(t, reason)).not.toBe(`dns.failure.${reason}`);
      }
      expect(sourceLabel(t, 'manual')).not.toBe('dns.source.manual');
      expect(sourceLabel(t, 'scheduled')).not.toBe('dns.source.scheduled');
      expect(providerLabel(t, 'cloudflare')).not.toBe('dns.provider.cloudflare');
      expect(providerLabel(t, 'alibaba')).not.toBe('dns.provider.alibaba');
    }
  });
});

describe('describeUpdate', () => {
  test('says what was created, and where', () => {
    expect(
      describeUpdate(en, result({ action: 'created', ipv6: '2606:4700::2', previousValue: null })),
    ).toBe('Created home.example.com, pointing at 2606:4700::2.');
  });

  test('shows both ends of an update', () => {
    expect(
      describeUpdate(
        en,
        result({ action: 'updated', ipv6: '2606:4700::2', previousValue: '2606:4700::1' }),
      ),
    ).toBe('Updated home.example.com from 2606:4700::1 to 2606:4700::2.');
  });

  test('says explicitly that an unchanged record wrote nothing', () => {
    // The sentence an operator should be able to trust: a run reporting no
    // change made no API call at all.
    expect(describeUpdate(en, result({ action: 'unchanged' }))).toBe(
      'home.example.com already points at 2606:4700::1; nothing was written.',
    );
  });

  test('explains a failure from its code', () => {
    expect(
      describeUpdate(en, result({ action: 'failed', failureReason: 'dns_query_failed' })),
    ).toBe(failureText(en, 'dns_query_failed'));
    // A failure with no code is still a sentence rather than an empty string.
    expect(describeUpdate(en, result({ action: 'failed', failureReason: null }))).toBe(
      'The check failed.',
    );
  });

  test('falls back to "the record" when no name was resolved', () => {
    expect(describeUpdate(en, result({ action: 'unchanged', recordName: '' }))).toContain(
      'the record',
    );
  });

  test('composes the same facts in Chinese, without leaving a placeholder behind', () => {
    const sentence = describeUpdate(translator('zh'), result({ action: 'updated' }));

    expect(sentence).toContain('home.example.com');
    expect(sentence).toContain('2606:4700::1');
    // An unsubstituted `{ipv6}` would mean a parameter name and its template had
    // drifted apart -- the one failure this shape of interpolation can hide.
    expect(sentence).not.toMatch(/\{\w+\}/);
  });
});
