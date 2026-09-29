/**
 * The vocabulary the IPv6 DNS console is written in.
 *
 * Two ideas are worth stating once, here, because every module in this directory
 * depends on them:
 *
 * - "The provider has no record" is a value, not an error. Cloudflare creates
 *   the record on the first update, so an empty answer is the normal first step,
 *   and treating it as a failure is how a query problem turns into a second
 *   record.
 * - Anything an operator can act on comes back as a `DnsFailureError` carrying a
 *   reason code. Anything else is a bug, and bugs are allowed to become 500s
 *   rather than being recorded as a run that failed.
 */

import type { DnsAction, DnsFailureReason, DnsProviderName, DnsRecord } from '@dashboard/shared';

/** A run that ended for a reason the operator can do something about. */
export class DnsFailureError extends Error {
  readonly reason: DnsFailureReason;

  constructor(message: string, reason: DnsFailureReason, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'DnsFailureError';
    this.reason = reason;
  }
}

/**
 * A DNS provider: look, then write.
 *
 * `setIpv6` is handed what `getRecord` returned rather than re-reading it, so the
 * value being replaced is the one the caller already saw and recorded -- a second
 * read could report a different value and make history disagree with itself.
 */
export type DnsProvider = {
  readonly name: DnsProviderName;
  getRecord: (signal?: AbortSignal) => Promise<DnsRecord | null>;
  setIpv6: (ipv6: string, current: DnsRecord | null, signal?: AbortSignal) => Promise<DnsAction>;
};

/**
 * Settings with the secrets decrypted.
 *
 * Built only by `settings.ts`, handed only to a provider, and never returned
 * from a route: the API's own shape (`DnsSettingsView`) has no field these
 * could travel in.
 *
 * No notification address here. Where a message goes is the dashboard's
 * business rather than this console's, so the notifier is injected into the
 * service instead of being read out of these settings.
 */
export type ResolvedDnsSettings = {
  provider: DnsProviderName;
  scheduleEnabled: boolean;
  intervalMinutes: number;
  cloudflareToken: string;
  cloudflareZoneId: string;
  cloudflareRecordName: string;
  alibabaAccessKeyId: string;
  alibabaAccessKeySecret: string;
  alibabaRecordId: string;
  alibabaRecordType: string;
};
