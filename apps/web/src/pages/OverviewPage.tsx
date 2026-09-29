import { Activity, ArrowRight, CircleAlert, FileCode, Server, FolderTree } from 'lucide-react';
import type { ExecutionSummary } from '@script-dashboard/shared';
import { PageBody } from '../components/AppShell';
import { PageHeader } from '../components/PageHeader';
import { Panel } from '../components/Panel';
import { Button } from '../components/Button';
import { EmptyState, ErrorBanner, LoadingRows } from '../components/Feedback';
import { ExecutionStatusLabel } from '../components/StatusDot';
import { useOverview } from '../api/queries';
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
  const overview = useOverview();

  if (overview.isError) {
    return (
      <PageBody>
        <PageHeader eyebrow="Dashboard" title="Overview" />
        <ErrorBanner
          className="mt-5"
          message={overview.error.message}
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
    { label: 'Targets', value: counts?.targets ?? 0, icon: Server, href: '/targets' },
    { label: 'Sources', value: counts?.sources ?? 0, icon: FolderTree, href: '/sources' },
    { label: 'Scripts', value: counts?.scripts ?? 0, icon: FileCode, href: '/scripts' },
    { label: 'Running', value: counts?.running ?? 0, icon: Activity, href: '/runs?status=running' },
    { label: 'Failed 24h', value: counts?.failed24h ?? 0, icon: CircleAlert, href: '/runs?status=failed', alarm: true },
  ];

  return (
    <PageBody>
      <PageHeader
        eyebrow="Dashboard"
        title="Overview"
        description="What is configured, what is running, and what just broke."
        actions={
          <Button
            variant="primary"
            icon={<ArrowRight className="size-4" aria-hidden />}
            onClick={() => navigate('/scripts')}
          >
            Run a script
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

      <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel
          title="Recent runs"
          flush
          aside={
            <a
              href={href('/runs')}
              className="focus-ring text-mute hover:text-ink text-meta rounded-md px-2 py-1 transition-colors duration-150"
            >
              All runs
            </a>
          }
        >
          {overview.isPending ? (
            <LoadingRows rows={5} />
          ) : recent.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={<Activity className="size-5" aria-hidden />}
                title="No runs yet"
                description="Pick a script and send it to a target; every execution lands here with its full output."
                action={
                  <Button variant="primary" size="sm" onClick={() => navigate('/scripts')}>
                    Choose a script
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

        <Panel title={isBlank ? 'Getting started' : 'Jump to'}>
          {isBlank ? (
            <ol className="grid gap-4">
              <SetupStep
                index="01"
                title="Add a target"
                body="Where the scripts run: host, credentials and the host path of the shared directory."
                href="/targets"
              />
              <SetupStep
                index="02"
                title="Add a source"
                body="Where the scripts live: a local directory or a GitHub repository to sync."
                href="/sources"
              />
              <SetupStep
                index="03"
                title="Run something"
                body="Once both exist, scripts appear in the tree and can be executed."
                href="/scripts"
              />
            </ol>
          ) : (
            <div className="grid gap-1">
              <QuickLink href="/scripts" label="Scripts" hint="Browse and run" />
              <QuickLink href="/runs?status=running" label="Running now" hint="Live output" />
              <QuickLink href="/runs?status=failed" label="Failed runs" hint="Last 24h first" />
              <QuickLink href="/targets" label="Targets" hint="Hosts and credentials" />
              <QuickLink href="/sources" label="Sources" hint="Sync and re-scan" />
            </div>
          )}
        </Panel>
      </div>
    </PageBody>
  );
}

function RecentRunRow({ execution }: { execution: ExecutionSummary }) {
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
          {formatRelative(execution.queuedAt)}
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
