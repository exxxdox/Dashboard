/**
 * The IPv6 DNS console.
 *
 * What the page shows is what a check found and what it decided: the last
 * look, the result of the last run, and the newest few history rows. The two
 * things that are configuration rather than state -- the settings, and the
 * whole history -- are behind buttons, because a page someone opens to see
 * whether the record is right should not be mostly a form and a table.
 *
 * Results render in place rather than as toasts: there is no toast primitive
 * here, and a result you cannot re-read is the wrong shape for something that
 * rewrites a DNS record.
 */

import { useState } from 'react';
import type { DnsRecordProbe, DnsSettingsView, DnsUpdateResult } from '@dashboard/shared';
import { RefreshCw, Search, SlidersHorizontal, Zap } from 'lucide-react';

import { PageBody } from '../components/AppShell';
import { Button } from '../components/Button';
import { ErrorBanner, LoadingBlock, WarningBanner } from '../components/Feedback';
import { Modal } from '../components/Modal';
import { MonoValue } from '../components/MonoValue';
import { PageHeader } from '../components/PageHeader';
import { Panel, Stat } from '../components/Panel';
import { errorMessage } from '../api/client';
import { useDetectDnsIpv6, useDnsState, useQueryDnsRecord, useRunDnsUpdate } from '../api/queries';
import { describeUpdate, providerLabel } from '../lib/dns';
import { formatDateTime, formatRelative } from '../lib/format';
import { useI18n, type Translate } from '../lib/i18n';
import { DnsHistoryPreview } from './DnsHistoryPreview';
import { DnsHistoryTable } from './DnsHistoryTable';
import { DnsSettingsForm } from './DnsSettingsForm';

export function DnsPage({ search }: { search: URLSearchParams }) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const state = useDnsState();
  const detect = useDetectDnsIpv6();
  const query = useQueryDnsRecord();
  const update = useRunDnsUpdate();

  // The answers are held rather than read off the mutation: a mutation's data is
  // cleared the next time it runs, and the last result is exactly what someone
  // re-reads while deciding what to do next.
  const [probe, setProbe] = useState<DnsRecordProbe | null>(null);
  const [result, setResult] = useState<DnsUpdateResult | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  if (state.isError) {
    return (
      <PageBody>
        <PageHeader eyebrow={t('dns.eyebrow')} title={t('dns.title')} />
        <div className="mt-5">
          <ErrorBanner
            message={errorMessage(state.error, i18n)}
            onRetry={() => void state.refetch()}
          />
        </div>
      </PageBody>
    );
  }

  if (state.isPending || !state.data) {
    return (
      <PageBody>
        <PageHeader eyebrow={t('dns.eyebrow')} title={t('dns.title')} />
        <div className="mt-5">
          <Panel>
            <LoadingBlock />
          </Panel>
        </div>
      </PageBody>
    );
  }

  const data = state.data;
  const settings = data.settings;
  const busy = detect.isPending || query.isPending || update.isPending;
  const shownRecord = probe?.record ?? data.record;
  const shownRecordAt = probe?.queriedAt ?? data.recordCheckedAt;

  return (
    <PageBody>
      <PageHeader
        eyebrow={t('dns.eyebrow')}
        title={t('dns.title')}
        // What is configured, without opening anything: the settings are behind
        // a button now, so this is what keeps them from being hidden.
        hints={<StatusChip label={settingsSummary(t, settings)} muted={settings === null} />}
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              icon={<SlidersHorizontal className="size-[18px]" aria-hidden />}
              onClick={() => setSettingsOpen(true)}
            >
              {t('dns.action.settings')}
            </Button>
            <Button
              icon={<RefreshCw className="size-[18px]" aria-hidden />}
              loading={detect.isPending}
              disabled={busy}
              onClick={() => detect.mutate()}
            >
              {t('dns.action.detect')}
            </Button>
            <Button
              icon={<Search className="size-[18px]" aria-hidden />}
              loading={query.isPending}
              disabled={busy || settings === null}
              onClick={() => query.mutate(undefined, { onSuccess: setProbe })}
            >
              {t('dns.action.query')}
            </Button>
            <Button
              variant="primary"
              icon={<Zap className="size-[18px]" aria-hidden />}
              loading={update.isPending}
              disabled={busy}
              onClick={() => update.mutate(undefined, { onSuccess: setResult })}
            >
              {t('dns.action.checkAndUpdate')}
            </Button>
          </div>
        }
      />

      <div className="mt-5 grid gap-4">
        <Panel title={t('dns.lastCheck.title')}>
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
            <Stat label={t('dns.stat.publicIpv6')}>
              {data.ipv6 === null ? (
                <span className="text-faint">{t('dns.value.notDetected')}</span>
              ) : (
                <MonoValue value={data.ipv6} wrap />
              )}
            </Stat>

            <Stat label={t('dns.stat.detectedAt')}>
              {/* Both formatters answer '—' for null, which would print as two
                  of them side by side; the empty case says so once instead. */}
              {data.ipv6CheckedAt === null ? (
                <span className="text-faint">{t('common.notYet')}</span>
              ) : (
                <RelativeTime iso={data.ipv6CheckedAt} />
              )}
            </Stat>

            <Stat label={t('dns.stat.provider')} mono={false}>
              {settings === null ? (
                <span className="text-faint">{t('dns.value.notConfigured')}</span>
              ) : (
                providerLabel(t, settings.provider)
              )}
            </Stat>

            {/* A record is two values, not one: a name and an address. Printed
                on a single line the pair was wider than its column, so the
                address painted over the neighbouring stat. Each gets a line,
                and the address breaks rather than overflows. */}
            <Stat label={t('dns.stat.record')}>
              {shownRecord === null ? (
                <span className="text-faint">{t('dns.value.notQueried')}</span>
              ) : (
                <span className="grid gap-1">
                  <span className="text-mute text-meta break-all">{shownRecord.recordName}</span>
                  <MonoValue value={shownRecord.value} wrap />
                </span>
              )}
            </Stat>

            <Stat label={t('dns.stat.queriedAt')}>
              {shownRecordAt === null ? (
                <span className="text-faint">{t('common.notYet')}</span>
              ) : (
                <RelativeTime iso={shownRecordAt} />
              )}
            </Stat>

            <Stat label={t('dns.stat.schedule')} mono={false}>
              {data.schedule === null || !data.schedule.enabled ? (
                <span className="text-faint">{t('dns.schedule.off')}</span>
              ) : (
                <span className="grid gap-1">
                  <span>{t('dns.schedule.every', { minutes: data.schedule.intervalMinutes })}</span>
                  <span className="text-faint text-meta">
                    {t('dns.schedule.next', {
                      when: formatDateTime(data.schedule.nextRunAt, locale),
                    })}
                  </span>
                </span>
              )}
            </Stat>
          </div>
        </Panel>

        {detect.isError ? <ErrorBanner message={errorMessage(detect.error, i18n)} /> : null}
        {query.isError ? <ErrorBanner message={errorMessage(query.error, i18n)} /> : null}
        {update.isError ? <ErrorBanner message={errorMessage(update.error, i18n)} /> : null}

        {probe !== null && probe.record === null ? (
          <Panel>
            <p className="text-mute text-body">{t('dns.noRecord')}</p>
          </Panel>
        ) : null}

        {result === null ? null : (
          <Panel
            title={t('dns.result.title')}
            className={result.action === 'failed' ? 'card-accent' : undefined}
          >
            <p
              className={result.action === 'failed' ? 'text-danger text-body' : 'text-ink text-body'}
            >
              {describeUpdate(t, result)}
            </p>
            {result.notificationFailed ? (
              <div className="mt-4">
                <WarningBanner>{t('dns.result.notificationFailed')}</WarningBanner>
              </div>
            ) : null}
          </Panel>
        )}

        <Panel title={t('dns.history.title')} flush>
          <DnsHistoryPreview
            checks={data.history.records}
            onViewAll={() => setHistoryOpen(true)}
          />
        </Panel>
      </div>

      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title={t('dns.settings.title')}
        description={settingsSummary(t, settings)}
      >
        {/* Remounted whenever the stored settings change, so the form's
            one-shot seed of its fields cannot go stale. */}
        <DnsSettingsForm key={settings?.updatedAt ?? 'new'} settings={settings} />
      </Modal>

      <Modal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={t('dns.history.allTitle')}
        description={t('dns.history.allDescription')}
        size="xl"
      >
        {/* Paging navigates the hash, which re-renders this page without
            unmounting it -- so the dialog stays open across a page change. */}
        <DnsHistoryTable search={search} />
      </Modal>
    </PageBody>
  );
}

/** A small pill for the header: what is configured, at a glance. */
function StatusChip({ label, muted }: { label: string; muted: boolean }) {
  return (
    <span
      className={
        muted
          ? 'border-line bg-panel-2 text-faint text-meta mono rounded-full border px-3 py-1.5'
          : 'border-line bg-panel-2 text-mute text-meta mono rounded-full border px-3 py-1.5'
      }
    >
      {label}
    </span>
  );
}

/** A time as "3 minutes ago" over the absolute stamp, one line each. */
function RelativeTime({ iso }: { iso: string }) {
  const { t, locale } = useI18n();

  return (
    <span className="grid gap-1">
      <span>{formatRelative(iso, t)}</span>
      <span className="text-faint text-meta">{formatDateTime(iso, locale)}</span>
    </span>
  );
}

/** What is configured, in one line, for the header chip and the dialog alike. */
export function settingsSummary(t: Translate, settings: DnsSettingsView | null): string {
  if (settings === null) return t('dns.settings.summaryUnconfigured');
  const provider = providerLabel(t, settings.provider);
  return settings.scheduleEnabled
    ? t('dns.settings.summaryConfigured', { provider, minutes: settings.intervalMinutes })
    : t('dns.settings.summaryOff', { provider });
}
