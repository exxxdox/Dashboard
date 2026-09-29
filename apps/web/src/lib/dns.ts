/**
 * Copy for the DNS console.
 *
 * Every map here is keyed by a union from the shared contract, so adding a
 * failure reason or an action on the server makes this file fail to compile
 * until it has words for it. That is the point: the server reports codes, and
 * nothing in the UI ever renders one.
 */

import type {
  DnsAction,
  DnsCheckSource,
  DnsFailureReason,
  DnsProviderName,
  DnsUpdateResult,
} from '@dashboard/shared';

export const ACTION_LABEL: Record<DnsAction, string> = {
  created: 'Created',
  updated: 'Updated',
  unchanged: 'No change',
  failed: 'Failed',
};

/**
 * What went wrong, addressed to whoever has to fix it.
 *
 * Each line names the next thing to look at rather than restating the code: an
 * unreachable probe and a probe that answered with a private address are the
 * same sentence to a machine and different jobs for a person.
 */
export const FAILURE_TEXT: Record<DnsFailureReason, string> = {
  not_configured: 'Nothing has been configured yet.',
  invalid_settings: 'The saved settings are incomplete, so no check was attempted.',
  ipv6_detect_failed: 'The public IPv6 probe could not be reached.',
  ipv6_not_global: 'The detected address is not a public one, so nothing was written.',
  dns_query_failed: 'The provider could not be asked for the current record.',
  dns_write_failed: 'The provider rejected the write.',
  record_missing: 'The provider has no record with that id, and this console never creates one.',
  record_identity_missing: 'The queried record has no host name, so there was nothing to update.',
};

export const SOURCE_LABEL: Record<DnsCheckSource, string> = {
  manual: 'Manual',
  scheduled: 'Scheduled',
};

export const PROVIDER_LABEL: Record<DnsProviderName, string> = {
  cloudflare: 'Cloudflare',
  alibaba: 'Alibaba Cloud',
};

/**
 * A run in one sentence, composed from the numbers rather than from prose.
 *
 * The alternative -- the server sending a sentence -- would mean three wordings
 * for the same fact, because the same outcome appears in the live result, the
 * summary line and a history row.
 */
export function describeUpdate(result: DnsUpdateResult): string {
  const where = result.recordName === '' ? 'the record' : result.recordName;

  switch (result.action) {
    case 'created':
      return `Created ${where}, pointing at ${result.ipv6}.`;
    case 'updated':
      return `Updated ${where} from ${result.previousValue ?? '(empty)'} to ${result.ipv6}.`;
    case 'unchanged':
      return `${where} already points at ${result.ipv6}; nothing was written.`;
    case 'failed':
      return result.failureReason === null
        ? 'The check failed.'
        : FAILURE_TEXT[result.failureReason];
  }
}
