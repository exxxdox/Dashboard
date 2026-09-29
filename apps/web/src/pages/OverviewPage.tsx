import {
  Activity,
  ArrowRight,
  CircleAlert,
  FileCode,
  FolderTree,
  Globe,
  Server,
} from 'lucide-react';
import type { DnsConsistency, ExecutionSummary } from '@dashboard/shared';
import { PageBody } from '../components/AppShell';
import { PageHeader } from '../components/PageHeader';
import { Panel } from '../components/Panel';
import { Button } from '../components/Button';
import { EmptyState, ErrorBanner, LoadingRows } from '../components/Feedback';
import { ExecutionStatusLabel } from '../components/StatusDot';
import { errorMessage } from '../api/client';
import { useOverview } from '../api/queries';
import { useI18n, useT } from '../lib/i18n';
import { href, navigate } from '../lib/router';
import { formatDuration, formatRelative, runTag } from '../lib/format';

type CountTile = {
  label: string;
  value: number;
  icon: typeof Activity;
  href: string;
  /** Only the counts that mean trouble get colour. */
  alarm?: boolean;
};

export function OverviewPage() {
  const i18n = useI18n();
  const { t } = i18n;
  const overview = useOverview();

  if (overview.isError) {
    return (
      <PageBody>
        <PageHeader eyebrow={t('overview.eyebrow')} title={t('overview.title')} />
        <ErrorBanner
          className="mt-5"
          message={errorMessage(overview.error, i18n)}
          onRetry={() => void overview.refetch()}
        />
      </PageBody>
    );
  }

  const counts = overview.data?.counts;
  const recent = overview.data?.recent ?? [];
  const isBlank =
    overview.isSuccess && counts !== undefined && counts.targets === 0 && counts.sources === 0;

  const tiles: CountTile[] = [
    { label: t('overview.count.targets'), value: counts?.targets ?? 0, icon: Server, href: '/targets' },
    { label: t('overview.count.sources'), value: counts?.sources ?? 0, icon: FolderTree, href: '/sources' },
    { label: t('overview.count.scripts'), value: counts?.scripts ?? 0, icon: FileCode, href: '/scripts' },
    { label: t('overview.count.running'), value: counts?.running ?? 0, icon: Activity, href: '/runs?status=running' },
    { label: t('overview.count.failed'), value: counts?.failed24h ?? 0, icon: CircleAlert, href: '/runs?status=failed', alarm: true },
  ];

  return (
    <PageBody>
      <PageHeader
        eyebrow={t('overview.eyebrow')}
        title={t('overview.title')}
        description={t('overview.description')}
        actions={
          <Button
            variant="primary"
            icon={<ArrowRight className="size-4" aria-hidden />}
            onClick={() => navigate('/scripts')}
          >
            {t('overview.runScript')}
          </Button>
        }
      />

      {/* One strip, hairline-divided, rather than five floating cards: the counts
          are a single line of the ledger, not five separate things. */}
      <div className="card divide-line mt-6 grid grid-cols-2 divide-x overflow-hidden sm:grid-cols-3 lg:grid-cols-5">
        {overview.isPending
          ? Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="px-4 py-4">
                <div className="bg-panel-3 h-2.5 w-16 animate-pulse rounded" />
                <div className="bg-panel-3 mt-4 h-6 w-10 animate-pulse rounded" />
              </div>
            ))
          : tiles.map((tile) => {
              const Icon = tile.icon;
              const alarming = Boolean(tile.alarm) && tile.value > 0;
              return (
                <a
                  key={tile.label}
                  href={href(tile.href)}
                  // The underline carries the hover here: it grows from the
                  // centre, so the tile reacts without moving the grid lines.
                  className="focus-ring group hover:bg-panel-2 relative px-4 py-4 transition-colors duration-150 ease-out"
                >
                  <span
                    aria-hidden
                    className="bg-accent absolute inset-x-0 bottom-0 h-[2px] origin-center scale-x-0 transition-transform duration-200 ease-out group-hover:scale-x-100"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="label">{tile.label}</span>
                    <Icon
                      className={
                        alarming
                          ? 'text-danger size-4'
                          : 'text-faint group-hover:text-accent size-4 transition-colors duration-150'
                      }
                      aria-hidden
                    />
                  </div>
                  <p
                    className={`mono text-stat mt-3 ${
                      alarming
                        ? 'text-danger'
                        : 'text-ink group-hover:text-accent transition-colors duration-150'
                    }`}
                  >
                    {tile.value}
                  </p>
                </a>
              );
            })}
      </div>

      <DnsTile dns={overview.data?.dns} pending={overview.isPending} />

      <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel
          title={t('overview.recentRuns')}
          flush
          aside={
            <a
              href={href('/runs')}
              className="focus-ring text-mute hover:text-ink text-meta rounded-md px-2 py-1 transition-colors duration-150"
            >
              {t('overview.allRuns')}
            </a>
          }
        >
          {overview.isPending ? (
            <LoadingRows rows={5} />
          ) : recent.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={<Activity className="size-5" aria-hidden />}
                title={t('overview.noRunsTitle')}
                description={t('overview.noRunsBody')}
                action={
                  <Button variant="primary" size="sm" onClick={() => navigate('/scripts')}>
                    {t('overview.chooseScript')}
                  </Button>
                }
              />
            </div>
          ) : (
            <ul className="divide-line divide-y">
              {recent.map((execution) => (
                <RecentRunRow key={execution.id} execution={execution} />
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={isBlank ? t('overview.gettingStarted') : t('overview.jumpTo')}>
          {isBlank ? (
            <ol className="grid gap-4">
              <SetupStep
                index="01"
                title={t('overview.stepTargetTitle')}
                body={t('overview.stepTargetBody')}
                href="/targets"
              />
              <SetupStep
                index="02"
                title={t('overview.stepSourceTitle')}
                body={t('overview.stepSourceBody')}
                href="/sources"
              />
              <SetupStep
                index="03"
                title={t('overview.stepRunTitle')}
                body={t('overview.stepRunBody')}
                href="/scripts"
              />
            </ol>
          ) : (
            <div className="grid gap-1">
              <QuickLink
                href="/scripts"
                label={t('overview.quickScripts')}
                hint={t('overview.quickScriptsHint')}
              />
              <QuickLink
                href="/runs?status=running"
                label={t('overview.quickRunning')}
                hint={t('overview.quickRunningHint')}
              />
              <QuickLink
                href="/runs?status=failed"
                label={t('overview.quickFailed')}
                hint={t('overview.quickFailedHint')}
              />
              <QuickLink
                href="/targets"
                label={t('overview.quickTargets')}
                hint={t('overview.quickTargetsHint')}
              />
              <QuickLink
                href="/sources"
                label={t('overview.quickSources')}
                hint={t('overview.quickSourcesHint')}
              />
            </div>
          )}
        </Panel>
      </div>
    </PageBody>
  );
}

/**
 * Whether the AAAA record still points at this host.
 *
 * The third state is the honest one. The two addresses this compares live in
 * the server's memory and are lost on restart, so until a check has run there
 * is nothing to compare -- and a green light nobody has earned is worse than
 * saying so, because the entire point of the DNS console is being able to
 * trust that word.
 */
function DnsTile({ dns, pending }: { dns: DnsConsistency | undefined; pending: boolean }) {
  const { t } = useI18n();

  if (pending || !dns) {
    return <div className="card mt-5 h-[84px] animate-pulse" />;
  }

  const state = dns.state;
  const label =
    state === 'consistent'
      ? t('overview.dns.consistent')
      : state === 'moved'
        ? t('overview.dns.moved')
        : t('overview.dns.unknown');

  const hint =
    state === 'consistent'
      ? t('overview.dns.hint.consistent')
      : state === 'moved'
        ? t('overview.dns.hint.moved', {
            record: dns.recordValue ?? t('common.dash'),
            ipv6: dns.ipv6 ?? t('common.dash'),
          })
        : dns.recordName === null
          ? t('overview.dns.hint.unconfigured')
          : t('overview.dns.hint.unknown');

  return (
    <a
      href={href('/dns')}
      className="card focus-ring group hover:border-line-strong mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4 transition-colors duration-150 ease-out"
    >
      <span
        aria-hidden
        className={
          state === 'consistent'
            ? 'bg-ok/12 text-ok grid size-11 shrink-0 place-items-center rounded-xl'
            : state === 'moved'
              ? 'bg-danger/12 text-danger grid size-11 shrink-0 place-items-center rounded-xl'
              : 'bg-panel-3 text-faint grid size-11 shrink-0 place-items-center rounded-xl'
        }
      >
        <Globe className="size-5" />
      </span>

      <span className="grid gap-0.5">
        <span className="label">{t('overview.dns.title')}</span>
        <span
          className={
            state === 'consistent'
              ? 'text-ok text-lead font-semibold'
              : state === 'moved'
                ? 'text-danger text-lead font-semibold'
                : 'text-mute text-lead font-semibold'
          }
        >
          {label}
        </span>
      </span>

      <span className="text-mute text-body min-w-0 flex-1">{hint}</span>

      {dns.at === null ? null : (
        <span className="text-faint text-meta shrink-0">
          {t('overview.dns.at', { when: formatRelative(dns.at, t) })}
        </span>
      )}

      <span className="text-faint group-hover:text-accent flex shrink-0 items-center gap-1.5 text-meta transition-colors duration-150">
        {t('overview.dns.open')}
        <ArrowRight className="size-4" aria-hidden />
      </span>
    </a>
  );
}

function RecentRunRow({ execution }: { execution: ExecutionSummary }) {
  // Its own translator rather than a prop: the row is where the relative time is
  // rendered, so it is where the question of language is actually asked.
  const t = useT();
  return (
    <li>
      <a
        href={href(`/runs/${encodeURIComponent(execution.id)}`)}
        className="focus-ring hover:bg-panel-2 flex items-center gap-4 px-4 py-3 transition-colors duration-150 ease-out"
      >
        <span className="mono text-faint text-meta w-[72px] shrink-0">{runTag(execution.id)}</span>
        <ExecutionStatusLabel status={execution.status} className="w-[140px] shrink-0" />
        <span className="mono text-ink text-body min-w-0 flex-1 truncate">
          {execution.scriptRelPath}
        </span>
        <span className="text-mute text-meta hidden shrink-0 sm:inline">{execution.targetName}</span>
        <span className="mono text-mute text-meta w-[72px] shrink-0 text-right">
          {formatDuration(execution.durationMs)}
        </span>
        <span className="text-faint text-meta hidden w-[92px] shrink-0 text-right md:inline">
          {formatRelative(execution.queuedAt, t)}
        </span>
      </a>
    </li>
  );
}

function SetupStep({
  index,
  title,
  body,
  href: target,
}: {
  index: string;
  title: string;
  body: string;
  href: string;
}) {
  return (
    <li>
      <a href={href(target)} className="focus-ring group flex gap-3 rounded-lg">
        <span className="mono text-faint group-hover:text-accent text-meta pt-0.5 transition-colors duration-150">
          {index}
        </span>
        <span className="min-w-0">
          <span className="text-ink text-lead group-hover:text-accent block font-medium transition-colors duration-150">
            {title}
          </span>
          <span className="text-mute text-meta block">{body}</span>
        </span>
      </a>
    </li>
  );
}

function QuickLink({ href: target, label, hint }: { href: string; label: string; hint: string }) {
  return (
    <a
      href={href(target)}
      className="focus-ring hover:bg-panel-2 group flex items-center justify-between rounded-lg px-3 py-2 transition-colors duration-150 ease-out"
    >
      <span className="text-ink text-body group-hover:text-accent transition-colors duration-150">
        {label}
      </span>
      <span className="text-faint text-meta">{hint}</span>
    </a>
  );
}
