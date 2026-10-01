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
  DnsConsistency,
  DnsFailureReason,
  DnsIpv6Probe,
  DnsProviderName,
  DnsRecord,
  DnsRecordProbe,
  DnsSchedulerView,
  DnsSettingsView,
  DnsState,
  DnsUpdateResult,
  UpdateDnsSettingsInput,
} from '@dashboard/shared';
import { DNS_CHECK_PREVIEW } from '@dashboard/shared';

import type { Db } from '../../db/client.js';
import { nowIso } from '../../db/client.js';
import type { SecretBox } from '../../lib/crypto.js';
import { AppError, UpstreamError, ValidationError, errorMessage } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { createMutex } from '../../lib/mutex.js';
// Only the redactor: the notifier itself is injected, because where a
// notification goes is the dashboard's setting rather than this console's.
import { redactToken } from '../notifications/gotify.js';
import type { OutgoingNotification } from '../notifications/service.js';
import { createAlibabaProvider } from './aliyun.js';
import {
  clearChecks,
  listChecks,
  recordCheck,
  summarizeChecks,
  type DnsCheckFilter,
} from './checks.js';
import { createCloudflareProvider } from './cloudflare.js';
import { detectPublicIpv6 } from './ipv6.js';
import {
  getSettingsView,
  resolveSettings,
  validate,
  // Renamed at the import: the service exposes its own `saveSettings`, and two
  // bindings with one name in this file is a reading hazard.
  saveSettings as writeSettings,
} from './settings.js';
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
  /**
   * How to reach a person. Required rather than defaulted: where a message goes
   * is a dashboard-wide setting, and a console that quietly sent nothing would
   * look exactly like one whose notifications work.
   *
   * False means nothing is configured, which is a skip rather than a failure.
   */
  sendNotification: (
    notification: OutgoingNotification,
    signal?: AbortSignal,
  ) => Promise<boolean>;
  /** Wired by the composition root once the scheduler exists; null before that. */
  getSchedule?: () => DnsSchedulerView | null;
  /**
   * Also wired by the composition root. Saving settings is where the schedule
   * changes, so the service applies it: that way there is no path that stores an
   * interval and forgets to arm the timer for it.
   */
  configureSchedule?: (settings: { scheduleEnabled: boolean; intervalMinutes: number }) => void;
};

export type DnsService = {
  /** Check and, if the address moved, update. Always records a history row. */
  update: (source: DnsCheckSource, signal?: AbortSignal) => Promise<DnsUpdateResult>;
  detect: (signal?: AbortSignal) => Promise<DnsIpv6Probe>;
  queryRecord: (signal?: AbortSignal) => Promise<DnsRecordProbe>;
  /**
   * Whether the record and this host agree, for the overview page.
   *
   * Read from what this process has already seen rather than by asking anyone:
   * the overview is a glance at the dashboard, and a tile that made two network
   * calls to render would be a worse tile.
   */
  consistency: () => DnsConsistency;
  state: () => DnsState;
  listChecks: (filter: DnsCheckFilter) => DnsCheckList;
  clearChecks: () => number;
  /** Store a settings update, and re-arm the schedule to match. */
  saveSettings: (input: UpdateDnsSettingsInput) => DnsSettingsView;
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
  const { sendNotification } = deps;

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
      logger.warn({ reason: problem.message }, 'the DNS settings are not usable');
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
      try {
        // The call itself answers "was one attempted": false means nothing is
        // configured, which is a skip and not a failure.
        notificationAttempted = await sendNotification(
          {
            title: 'DNS IPv6 updated',
            message: `${provider.name}: ${previousValue ?? '(no record)'} -> ${ipv6}`,
          },
          signal,
        );
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

    consistency() {
      // Comparing one known address against an unknown one would answer
      // "moved" for a record nobody has looked at, so a missing half is
      // reported as unknown and the tile sends the reader to the console.
      const state: DnsConsistency['state'] =
        lastIpv6 === null || lastRecord === null
          ? 'unknown'
          : lastIpv6 === lastRecord.value
            ? 'consistent'
            : 'moved';

      return {
        state,
        ipv6: lastIpv6,
        recordValue: lastRecord?.value ?? null,
        recordName: lastRecord?.recordName ?? null,
        // The more recent of the two observations: a verdict is only as fresh
        // as its older half.
        at: latest(lastIpv6At, lastRecordAt),
      };
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
          records: listChecks(db, { limit: DNS_CHECK_PREVIEW, offset: 0 }).items,
        },
      };
    },

    listChecks(filter) {
      return listChecks(db, filter);
    },

    clearChecks() {
      return clearChecks(db);
    },

    saveSettings(input) {
      const view = writeSettings(db, box, input);
      deps.configureSchedule?.({
        scheduleEnabled: view.scheduleEnabled,
        intervalMinutes: view.intervalMinutes,
      });
      return view;
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

/**
 * The later of two ISO stamps, either of which may be absent.
 *
 * Plain string comparison, which is what the format is for: every stamp here
 * comes from `nowIso()`, so they are the same shape and UTC.
 */
function latest(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return left > right ? left : right;
}
