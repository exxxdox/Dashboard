/**
 * The IPv6 DNS console.
 *
 * Three parts on one page: what the last checks saw, the settings, and the
 * history. Results render in place rather than as toasts -- there is no toast
 * primitive here, and a result you cannot re-read is the wrong shape for
 * something that rewrites a DNS record.
 */

import { useState } from 'react';
import type { DnsRecordProbe, DnsUpdateResult } from '@dashboard/shared';
import { RefreshCw, Search, Zap } from 'lucide-react';

import { PageBody } from '../components/AppShell';
import { Button } from '../components/Button';
import { ErrorBanner, LoadingBlock, WarningBanner } from '../components/Feedback';
import { MonoValue } from '../components/MonoValue';
import { PageHeader } from '../components/PageHeader';
import { Panel, Stat } from '../components/Panel';
import { errorMessage } from '../api/client';
import { useDetectDnsIpv6, useDnsState, useQueryDnsRecord, useRunDnsUpdate } from '../api/queries';
import { PROVIDER_LABEL, describeUpdate } from '../lib/dns';
import { formatDateTime, formatRelative } from '../lib/format';
import { DnsHistoryTable } from './DnsHistoryTable';
import { DnsSettingsForm } from './DnsSettingsForm';

export function DnsPage({ search }: { search: URLSearchParams }) {
  const state = useDnsState();
  const detect = useDetectDnsIpv6();
  const query = useQueryDnsRecord();
  const update = useRunDnsUpdate();

  // The answers are held rather than read off the mutation: a mutation's data is
  // cleared the next time it runs, and the last result is exactly what someone
  // re-reads while deciding what to do next.
  const [probe, setProbe] = useState<DnsRecordProbe | null>(null);
  const [result, setResult] = useState<DnsUpdateResult | null>(null);

  if (state.isError) {
    return (
      <PageBody>
        <PageHeader eyebrow="DNS" title="IPv6 DNS" />
        <div className="mt-5">
          <ErrorBanner message={errorMessage(state.error)} onRetry={() => void state.refetch()} />
        </div>
      </PageBody>
    );
  }

  if (state.isPending || !state.data) {
    return (
      <PageBody>
        <PageHeader eyebrow="DNS" title="IPv6 DNS" />
        <div className="mt-5">
          <Panel>
            <LoadingBlock label="Reading the DNS console" />
          </Panel>
        </div>
      </PageBody>
    );
  }

  const data = state.data;
  const settings = data.settings;
  const busy = detect.isPending || query.isPending || update.isPending;
  const shownRecord = probe?.record ?? data.record;

  return (
    <PageBody>
      <PageHeader
        eyebrow="DNS"
        title="IPv6 DNS"
        description="Keep an AAAA record pointed at this host's public IPv6 address. A check that finds the same address writes nothing."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              icon={<RefreshCw className="size-4" aria-hidden />}
              loading={detect.isPending}
              disabled={busy}
              onClick={() => detect.mutate()}
            >
              Detect address
            </Button>
            <Button
              icon={<Search className="size-4" aria-hidden />}
              loading={query.isPending}
              disabled={busy || settings === null}
              onClick={() => query.mutate(undefined, { onSuccess: setProbe })}
            >
              Query record
            </Button>
            <Button
              variant="primary"
              icon={<Zap className="size-4" aria-hidden />}
              loading={update.isPending}
              disabled={busy}
              onClick={() => update.mutate(undefined, { onSuccess: setResult })}
            >
              Check and update
            </Button>
          </div>
        }
      />

      <div className="mt-5 grid gap-4">
        <Panel title="Last check">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Stat label="Public IPv6" mono>
              {data.ipv6 === null ? (
                <span className="text-faint">Not detected yet</span>
              ) : (
                <MonoValue value={data.ipv6} />
              )}
            </Stat>
            <Stat label="Detected at" mono>
              {formatRelative(data.ipv6CheckedAt)}
              <span className="text-faint ml-2">{formatDateTime(data.ipv6CheckedAt)}</span>
            </Stat>
            <Stat label="Provider">
              {settings === null ? (
                <span className="text-faint">Not configured</span>
              ) : (
                PROVIDER_LABEL[settings.provider]
              )}
            </Stat>
            <Stat label="Record" mono>
              {shownRecord === null ? (
                <span className="text-faint">Not queried yet</span>
              ) : (
                <MonoValue value={`${shownRecord.recordName} ${shownRecord.value}`} />
              )}
            </Stat>
            <Stat label="Queried at" mono>
              {formatRelative(probe?.queriedAt ?? data.recordCheckedAt)}
              <span className="text-faint ml-2">
                {formatDateTime(probe?.queriedAt ?? data.recordCheckedAt)}
              </span>
            </Stat>
            <Stat label="Schedule">
              {data.schedule === null || !data.schedule.enabled ? (
                <span className="text-faint">Off</span>
              ) : (
                <>
                  Every {data.schedule.intervalMinutes} min
                  <span className="text-faint ml-2">
                    next {formatDateTime(data.schedule.nextRunAt)}
                  </span>
                </>
              )}
            </Stat>
          </div>
        </Panel>

        {detect.isError ? <ErrorBanner message={errorMessage(detect.error)} /> : null}
        {query.isError ? <ErrorBanner message={errorMessage(query.error)} /> : null}
        {update.isError ? <ErrorBanner message={errorMessage(update.error)} /> : null}

        {probe !== null && probe.record === null ? (
          <Panel>
            <p className="text-mute text-body">
              The provider has no AAAA record for this name yet. A check creates one on Cloudflare;
              Alibaba Cloud is never allowed to create one.
            </p>
          </Panel>
        ) : null}

        {result === null ? null : (
          <Panel title="Result">
            <p
              className={
                result.action === 'failed' ? 'text-danger text-body' : 'text-ink text-body'
              }
            >
              {describeUpdate(result)}
            </p>
            {result.notificationFailed ? (
              <div className="mt-3">
                <WarningBanner>
                  The record was updated, but the Gotify notification could not be sent.
                </WarningBanner>
              </div>
            ) : null}
          </Panel>
        )}

        <Panel title="Settings">
          {/* Remounted whenever the stored settings change, so the form's
              one-shot seed of its fields cannot go stale. */}
          <DnsSettingsForm key={settings?.updatedAt ?? 'new'} settings={settings} />
        </Panel>

        <Panel title="History" flush>
          <DnsHistoryTable search={search} />
        </Panel>
      </div>
    </PageBody>
  );
}
