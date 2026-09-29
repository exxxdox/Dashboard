/**
 * The one place a DNS check happens.
 *
 * The manual button and the scheduler both come through here, so the order below
 * exists once:
 *
 *   validate the settings -> detect the public address -> query the provider
 *   -> write -> notify -> record
 *
 * Two of those steps are load-bearing in a way that is easy to lose:
 *
 * - A failed query aborts before anything is written, and it is never read as
 *   "there is no record". For Cloudflare that reading creates a second record
 *   for the same name, which is the worst outcome this feature has.
 * - A run that would write the same value writes nothing at all: no API call,
 *   and nothing in the provider's audit log.
 *
 * Everything the operator can act on leaves here as a failed result carrying a
 * reason code. Anything else is a bug and is allowed to propagate.
 */

import type {
  DnsAction,
  DnsCheckList,
  DnsCheckSource,
  DnsFailureReason,
  DnsIpv6Probe,
  DnsNotificationTest,
  DnsProviderName,
  DnsRecord,
  DnsRecordProbe,
  DnsSchedulerView,
  DnsState,
  DnsUpdateResult,
  TestDnsNotificationInput,
} from '@dashboard/shared';
import { DNS_CHECK_PREVIEW, MAX_DNS_CHECKS } from '@dashboard/shared';

import type { Db } from '../../db/client.js';
import { nowIso } from '../../db/client.js';
import type { SecretBox } from '../../lib/crypto.js';
import { AppError, UpstreamError, ValidationError, errorMessage } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { createMutex } from '../../lib/mutex.js';
import { createAlibabaProvider } from './aliyun.js';
import {
  clearChecks,
  listChecks,
  listRecentChecks,
  recordCheck,
  summarizeChecks,
  type DnsCheckFilter,
} from './checks.js';
import { createCloudflareProvider } from './cloudflare.js';
import { redactToken, sendGotify, type GotifyMessage } from './gotify.js';
import { detectPublicIpv6 } from './ipv6.js';
import { getSettingsView, resolveSettings, resolveSettingsOrEmpty, validate } from './settings.js';
import { DnsFailureError, type DnsProvider, type ResolvedDnsSettings } from './types.js';

export type DnsServiceDeps = {
  db: Db;
  box: SecretBox;
  logger: Logger;
  /**
   * Injected so a test can drive the whole sequence without a network, the same
   * way `createFakeTransport` stands in for ssh. The defaults are the real ones.
   */
  createProvider?: (settings: ResolvedDnsSettings) => DnsProvider;
  detectIpv6?: (signal?: AbortSignal) => Promise<string>;
  notify?: (message: GotifyMessage) => Promise<boolean>;
  /** Wired by the composition root once the scheduler exists; null before that. */
  getSchedule?: () => DnsSchedulerView | null;
};

export type DnsService = {
  /** Check and, if the address moved, update. Always records a history row. */
  update: (source: DnsCheckSource, signal?: AbortSignal) => Promise<DnsUpdateResult>;
  detect: (signal?: AbortSignal) => Promise<DnsIpv6Probe>;
  queryRecord: (signal?: AbortSignal) => Promise<DnsRecordProbe>;
  testNotification: (
    input: TestDnsNotificationInput,
    signal?: AbortSignal,
  ) => Promise<DnsNotificationTest>;
  state: () => DnsState;
  listChecks: (filter: DnsCheckFilter) => DnsCheckList;
  clearChecks: () => number;
};

/**
 * Turn a recorded failure into the answer a probe route owes its caller.
 *
 * The probes do not run the full sequence, so they have no history row to carry
 * the reason; a 502 with the reason in `details` is what they report instead.
 */
export function toUpstreamError(error: unknown): AppError {
  if (error instanceof DnsFailureError) {
    return new UpstreamError(error.message, { reason: error.reason });
  }
  if (error instanceof AppError) return error;
  return new UpstreamError(errorMessage(error));
}

export function createDnsService(deps: DnsServiceDeps): DnsService {
  const { db, box, logger } = deps;
  const createProvider = deps.createProvider ?? defaultProvider;
  const detectIpv6 = deps.detectIpv6 ?? detectPublicIpv6;
  const notify = deps.notify ?? sendGotify;

  // The lock the Python version kept at module level, now that two paths -- the
  // button and the timer -- can reach the same record.
  const mutex = createMutex();

  // What the last probe saw, held in memory exactly as the Python console did:
  // lost on restart, and never a substitute for the durable settings and history.
  let lastIpv6: string | null = null;
  let lastIpv6At: string | null = null;
  let lastRecord: DnsRecord | null = null;
  let lastRecordAt: string | null = null;

  async function runUpdate(
    source: DnsCheckSource,
    signal: AbortSignal | undefined,
  ): Promise<DnsUpdateResult> {
    const settings = resolveSettings(db, box);
    if (!settings) return remember(source, failure('not_configured', null, ''));

    // Checked again here rather than trusted from save time: the row can be
    // edited by hand, and a run with half a configuration should say so instead
    // of sending a request the provider will reject.
    const problem = validate(settings);
    if (problem !== null) {
      logger.warn({ reason: problem }, 'the DNS settings are not usable');
      return remember(source, failure('invalid_settings', settings.provider, ''));
    }

    let ipv6: string;
    try {
      ipv6 = await detectIpv6(signal);
      lastIpv6 = ipv6;
      lastIpv6At = nowIso();
    } catch (error) {
      return remember(source, failFrom(error, settings.provider, ''));
    }

    let provider: DnsProvider;
    try {
      provider = createProvider(settings);
    } catch (error) {
      // An SDK refusing to build its client out of what was stored is still the
      // operator's configuration rather than a bug in here.
      logger.warn({ err: errorMessage(error) }, 'the DNS provider client could not be built');
      return remember(source, failure('invalid_settings', settings.provider, ipv6));
    }

    let current: DnsRecord | null;
    try {
      current = await provider.getRecord(signal);
    } catch (error) {
      // The step this whole file exists to protect: a failed query is not an
      // absence, and must never lead to a create.
      return remember(source, failFrom(error, provider.name, ipv6));
    }

    let action: DnsAction;
    try {
      action = await provider.setIpv6(ipv6, current, signal);
    } catch (error) {
      return remember(
        source,
        failFrom(error, provider.name, ipv6, current?.value ?? null, current?.recordName ?? ''),
      );
    }

    const previousValue = current?.value ?? null;
    const recordName = current?.recordName ?? settings.cloudflareRecordName;

    // Only a run that wrote something is worth a notification, and failing to
    // send one is reported beside a run that still succeeded.
    let notificationAttempted = false;
    let notificationFailed = false;
    if (action === 'created' || action === 'updated') {
      notificationAttempted = true;
      try {
        const sent = await notify({
          address: settings.gotifyAddress,
          token: settings.gotifyToken,
          title: 'DNS IPv6 updated',
          message: `${provider.name}: ${previousValue ?? '(no record)'} -> ${ipv6}`,
          ...(signal === undefined ? {} : { signal }),
        });
        // False means the notifier is not configured after all, which is a skip.
        notificationAttempted = sent;
      } catch (error) {
        notificationFailed = true;
        logger.warn(
          { err: redactToken(errorMessage(error)) },
          'the DNS notification could not be sent',
        );
      }
    }

    // The record panel reflects what this run knows. After a create there was no
    // record to query, so it appears on the next explicit query rather than being
    // invented here without an id.
    if (current) {
      lastRecord = { ...current, value: action === 'unchanged' ? current.value : ipv6 };
      lastRecordAt = nowIso();
    }

    return remember(source, {
      provider: provider.name,
      action,
      ipv6,
      previousValue,
      recordName,
      failureReason: null,
      notificationAttempted,
      notificationFailed,
    });
  }

  /**
   * Write the history row, and never let that decide anything.
   *
   * History is a side channel: an operator whose disk is full should still get
   * the run's real outcome, and the log line is where the lost row shows up.
   */
  function remember(source: DnsCheckSource, result: DnsUpdateResult): DnsUpdateResult {
    try {
      recordCheck(db, {
        source,
        ok: result.action !== 'failed',
        action: result.action,
        failureReason: result.failureReason,
        ipv6: result.ipv6,
        previousValue: result.previousValue,
        provider: result.provider,
        at: nowIso(),
      });
    } catch (error) {
      logger.warn({ err: errorMessage(error) }, 'the DNS check could not be recorded');
    }
    return result;
  }

  function requireSettings(): ResolvedDnsSettings {
    const settings = resolveSettings(db, box);
    if (!settings) throw new ValidationError('The DNS settings have not been saved yet');
    return settings;
  }

  return {
    update(source, signal) {
      return mutex.run(() => runUpdate(source, signal));
    },

    async detect(signal) {
      // A refusal from the probe is left to the route: it answers 502 with the
      // reason, and there is no history row for a probe on its own.
      const ipv6 = await detectIpv6(signal);
      lastIpv6 = ipv6;
      lastIpv6At = nowIso();
      return { ipv6, detectedAt: lastIpv6At };
    },

    async queryRecord(signal) {
      const settings = requireSettings();
      const provider = createProvider(settings);
      const record = await provider.getRecord(signal);
      lastRecord = record;
      lastRecordAt = nowIso();
      return { record, queriedAt: lastRecordAt };
    },

    async testNotification(input, signal) {
      const settings = resolveSettingsOrEmpty(db, box);
      // The form's value wins so a credential can be tried before it is saved;
      // blank means "use what is stored", as it does when saving.
      const address = pick(input.gotifyAddress, settings.gotifyAddress);
      const token = pick(input.gotifyToken, settings.gotifyToken);
      if (address === '' || token === '') {
        throw new ValidationError(
          'A Gotify address and token are both needed to send a test message',
        );
      }

      try {
        await notify({
          address,
          token,
          title: 'Test notification',
          message: 'The DNS console reached this Gotify server.',
          ...(signal === undefined ? {} : { signal }),
        });
      } catch (error) {
        throw new UpstreamError(
          `The test message could not be sent: ${redactToken(errorMessage(error))}`,
        );
      }
      return { sent: true };
    },

    state() {
      const summary = summarizeChecks(db);
      return {
        settings: getSettingsView(db),
        ipv6: lastIpv6,
        ipv6CheckedAt: lastIpv6At,
        record: lastRecord,
        recordCheckedAt: lastRecordAt,
        // A page refresh asks for the schedule too, which is what lets a failed
        // boot-time read repair itself without a restart.
        schedule: deps.getSchedule?.() ?? null,
        history: {
          summary,
          records: listRecentChecks(db, DNS_CHECK_PREVIEW),
          total: summary.total,
        },
        limits: { historyPreviewSize: DNS_CHECK_PREVIEW, historyMaxRecords: MAX_DNS_CHECKS },
      };
    },

    listChecks(filter) {
      return listChecks(db, filter);
    },

    clearChecks() {
      return clearChecks(db);
    },
  };
}

function defaultProvider(settings: ResolvedDnsSettings): DnsProvider {
  return settings.provider === 'cloudflare'
    ? createCloudflareProvider(settings)
    : createAlibabaProvider(settings);
}

/** A failed run, carrying whatever the run had learned before it stopped. */
function failure(
  reason: DnsFailureReason,
  provider: DnsProviderName | null,
  ipv6: string,
  previousValue: string | null = null,
  recordName = '',
): DnsUpdateResult {
  return {
    provider,
    action: 'failed',
    ipv6,
    previousValue,
    recordName,
    failureReason: reason,
    notificationAttempted: false,
    notificationFailed: false,
  };
}

/**
 * A failure the operator can act on becomes a result; anything else is rethrown.
 *
 * That distinction is the whole point of `DnsFailureError`: an unexpected error
 * here is a bug, and recording it as "the check failed" would hide it behind a
 * history row that looks like a network problem.
 */
function failFrom(
  error: unknown,
  provider: DnsProviderName | null,
  ipv6: string,
  previousValue: string | null = null,
  recordName = '',
): DnsUpdateResult {
  if (!(error instanceof DnsFailureError)) throw error;
  return failure(error.reason, provider, ipv6, previousValue, recordName);
}

/** A form value when it says something, otherwise the stored one. */
function pick(provided: string | undefined, stored: string): string {
  const trimmed = (provided ?? '').trim();
  return trimmed === '' ? stored.trim() : trimmed;
}
