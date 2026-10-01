/**
 * What a finished operation reports.
 *
 * Every one of these used to be a panel or a strip the page rendered from state
 * it held for as long as the tab stayed open. They are messages now: a result
 * nobody asked to keep is not worth a permanent box on a page whose subject is
 * something else, and someone who wants to re-read one only has to leave the
 * pointer on it.
 *
 * Pure and translator-taking, so the wording is testable without a renderer and
 * the English and the Chinese console are the same function. Each one returns
 * the whole message rather than a sentence for the caller to wrap, because the
 * tone -- an error, a confirmation, a fact worth noticing -- is part of what the
 * operation means and not a decision the caller is in a position to make.
 */

import type { DnsIpv6Probe, DnsRecordProbe, DnsUpdateResult, SyncResult, TargetCheckResult } from '@dashboard/shared';

import { describeUpdate } from './dns';
import type { Translate } from './i18n';
import type { ToastTone } from './toast';

export type Outcome = {
  message: string;
  detail?: string;
  tone: ToastTone;
};

/** The separator between facts on one line of a detail. */
const PART = ' · ';

/** Facts that answer a question sit on their own lines; a sentence gets one too. */
function lines(parts: Array<string | null>): string | undefined {
  const kept = parts.filter((part): part is string => part !== null && part !== '');
  return kept.length === 0 ? undefined : kept.join('\n');
}

/* ----------------------------------------------------------------- targets */

export function targetCheckOutcome(t: Translate, result: TargetCheckResult): Outcome {
  // A host that answers SSH but cannot enter its working directory looks
  // perfectly healthy until the first run, so readiness is all three facts and
  // not just reachability.
  const ready = result.reachable && result.workDirOk && result.stagingOk;
  const fact = (label: string, ok: boolean): string =>
    `${label} ${ok ? t('targets.fact.ok') : t('targets.fact.failed')}`;

  const facts = [
    fact(t('targets.fact.reachable'), result.reachable),
    fact(t('targets.fact.workDir'), result.workDirOk),
    fact(t('targets.fact.staging'), result.stagingOk),
  ].join(PART);

  const meta = [
    result.latencyMs === null ? null : `${result.latencyMs}ms`,
    result.hostUser,
    result.hostShell,
  ]
    .filter((part): part is string => part !== null && part !== '')
    .join(PART);

  // The two notes are advice rather than findings, and they are what makes the
  // message actionable: one names the config field to look at, the other says
  // runs still work and only cancellation is less thorough.
  const workDirNote = ready
    ? null
    : `${t('targets.workDirNote.before')} workDir${t('targets.workDirNote.after')}`;
  const setsidNote = result.hasSetsid ? null : `setsid ${t('targets.setsidNote')}`;

  return {
    message: ready ? t('targets.ready') : t('targets.cannotRun'),
    tone: ready ? 'success' : 'error',
    detail: lines([facts, meta === '' ? null : meta, result.detail, workDirNote, setsidNote]),
  };
}

/* ----------------------------------------------------------------- sources */

export function syncOutcome(t: Translate, result: SyncResult): Outcome {
  const counts = [
    `${t('sources.sync.added')} ${result.added}`,
    `${t('sources.sync.updated')} ${result.updated}`,
    `${t('sources.sync.removed')} ${result.removed}`,
    t('sources.sync.total', { count: result.total }),
  ].join(PART);

  // A sync that got through but complained is not a failure; it is a
  // confirmation with something to say, which is what the warning tone is.
  return {
    message: t('toast.sourceSynced'),
    tone: result.warnings.length === 0 ? 'success' : 'warning',
    detail: lines([counts, ...result.warnings]),
  };
}

/* --------------------------------------------------------------------- dns */

export function ipv6ProbeOutcome(t: Translate, probe: DnsIpv6Probe): Outcome {
  return {
    message: t('toast.dnsAddressDetected'),
    tone: 'success',
    detail: probe.ipv6,
  };
}

export function recordProbeOutcome(t: Translate, probe: DnsRecordProbe): Outcome {
  // "No record yet" is a legitimate answer rather than a failure -- for
  // Cloudflare it is the state that precedes creating one -- so it is reported
  // as the detail of a successful query, not as an error.
  return {
    message: t('toast.dnsRecordQueried'),
    tone: 'success',
    detail:
      probe.record === null
        ? t('dns.noRecord')
        : `${probe.record.recordName}\n${probe.record.value}`,
  };
}

export function updateOutcome(t: Translate, result: DnsUpdateResult): Outcome {
  return {
    // The run's own sentence is the headline: it already says whether anything
    // was written and to what, which a generic "update finished" does not.
    message: describeUpdate(t, result),
    tone: result.action === 'failed' ? 'error' : result.action === 'unchanged' ? 'info' : 'success',
    // A notification that failed does not fail the run, so it rides along
    // beside the outcome rather than replacing it.
    detail: result.notificationFailed ? t('dns.result.notificationFailed') : undefined,
  };
}
