/**
 * Copy for the DNS console.
 *
 * Every function here is keyed by a union from the shared contract, so adding a
 * failure reason or an action on the server makes this file fail to compile
 * until it has words for it. That is the point: the server reports codes, and
 * nothing in the UI ever renders one.
 *
 * The words themselves live in the i18n dictionary -- `areas/dns.ts`. This
 * module is only the mapping from a code onto one, which is why each lookup
 * builds its key from the union rather than spelling the key out.
 */

import type {
  DnsAction,
  DnsCheckSource,
  DnsFailureReason,
  DnsProviderName,
  DnsUpdateResult,
} from '@dashboard/shared';

import type { Translate } from './i18n';

export function resultLabel(t: Translate, action: DnsAction): string {
  return t(`dns.resultLabel.${action}`);
}

/**
 * What went wrong, addressed to whoever has to fix it.
 *
 * Each line names the next thing to look at rather than restating the code: an
 * unreachable probe and a probe that answered with a private address are the
 * same sentence to a machine and different jobs for a person.
 */
export function failureText(t: Translate, reason: DnsFailureReason): string {
  return t(`dns.failure.${reason}`);
}

export function sourceLabel(t: Translate, source: DnsCheckSource): string {
  return t(`dns.source.${source}`);
}

export function providerLabel(t: Translate, provider: DnsProviderName): string {
  return t(`dns.provider.${provider}`);
}

/**
 * A run in one sentence, composed from the numbers rather than from prose.
 *
 * The alternative -- the server sending a sentence -- would mean three wordings
 * for the same fact, because the same outcome appears in the live result, the
 * summary line and a history row.
 */
export function describeUpdate(t: Translate, result: DnsUpdateResult): string {
  const where = result.recordName === '' ? t('dns.update.theRecord') : result.recordName;

  switch (result.action) {
    case 'created':
      return t('dns.update.created', { where, ipv6: result.ipv6 });
    case 'updated':
      return t('dns.update.updated', {
        where,
        previous: result.previousValue ?? t('dns.update.emptyValue'),
        ipv6: result.ipv6,
      });
    case 'unchanged':
      return t('dns.update.unchanged', { where, ipv6: result.ipv6 });
    case 'failed':
      return result.failureReason === null
        ? t('dns.update.failed')
        : failureText(t, result.failureReason);
  }
}
