import { lazy, Suspense, useEffect } from 'react';
import { ArrowLeft, Ban, Trash } from 'lucide-react';
import { TERMINAL_EXECUTION_STATUSES } from '@script-dashboard/shared';
import { PageBody } from '../components/AppShell';
import { Button } from '../components/Button';
import { Panel, Stat } from '../components/Panel';
import { ErrorBanner, LoadingBlock, WarningBanner } from '../components/Feedback';
import { ExecutionStatusLabel } from '../components/StatusDot';
import { MonoValue } from '../components/MonoValue';
import { KeyHints } from '../components/KeyHints';
import { PageHeader } from '../components/PageHeader';
import {
  useApplyExecutionUpdate,
  useCancelExecution,
  useDeleteExecution,
  useExecution,
} from '../api/queries';
import { TONE_RAIL, EXECUTION_STATUS_META } from '../lib/status';
import { formatBytes, formatDateTime, formatDuration, formatExit, formatParams, runTag } from '../lib/format';
import { goBack, navigate } from '../lib/router';
import { cn } from '../lib/cn';

// xterm is the largest dependency in the app and only a run page needs it.
const RunTerminal = lazy(() =>
  import('./RunTerminal').then((module) => ({ default: module.RunTerminal })),
);

export function RunDetailPage({ executionId }: { executionId: string }) {
  const execution = useExecution(executionId);
  const applyUpdate = useApplyExecutionUpdate();
  const cancel = useCancelExecution();
  const remove = useDeleteExecution();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') goBack('/runs');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const data = execution.data;
  // A run that is already finished needs no socket: the stored log is the log.
  const isLive = data !== undefined && !TERMINAL_EXECUTION_STATUSES.includes(data.status);

  if (execution.isError) {
    return (
      <PageBody>
        <PageHeader eyebrow="Execution" title={`Run ${runTag(executionId)}`} />
        <ErrorBanner
          className="mt-5"
          message={execution.error.message}
          onRetry={() => void execution.refetch()}
        />
      </PageBody>
    );
  }

  if (!data) {
    return (
      <PageBody>
        <PageHeader eyebrow="Execution" title={`Run ${runTag(executionId)}`} />
        <Panel className="mt-5">
          <LoadingBlock label="Loading run…" />
        </Panel>
      </PageBody>
    );
  }

  const meta = EXECUTION_STATUS_META[data.status];

  return (
    <div className="relative">
      {/* The rail: a full-height line whose colour is the run's state. */}
      <span
        aria-hidden
        className={cn(
          'absolute top-0 bottom-0 left-0 w-[3px] overflow-hidden',
          TONE_RAIL[meta.tone],
          isLive && 'rail-live',
        )}
      />

      <PageBody wide>
        <header className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => goBack('/runs')}
              className="focus-ring text-mute hover:text-ink hover:bg-panel-2 text-meta -ml-2 mb-3 inline-flex items-center gap-2 rounded-lg px-2 py-1 transition-colors duration-150"
            >
              <ArrowLeft className="size-4" aria-hidden />
              Runs
            </button>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="mono text-faint text-lead">{runTag(data.id)}</span>
              <h1 className="text-ink mono min-w-0 truncate text-title leading-tight font-semibold">
                {data.scriptRelPath}
              </h1>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              <ExecutionStatusLabel status={data.status} />
              <span className="text-mute text-meta">
                on <span className="text-ink">{data.targetName}</span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <KeyHints hints={[{ keys: ['esc'], label: 'back' }]} />
            {isLive ? (
              <Button
                variant="danger"
                icon={<Ban className="size-4" aria-hidden />}
                loading={cancel.isPending}
                onClick={() => cancel.mutate(data.id)}
              >
                Cancel run
              </Button>
            ) : (
              <Button
                variant="ghost"
                icon={<Trash className="size-4" aria-hidden />}
                loading={remove.isPending}
                onClick={() =>
                  remove.mutate(data.id, { onSuccess: () => navigate('/runs', { replace: true }) })
                }
              >
                Delete
              </Button>
            )}
          </div>
        </header>

        {cancel.isError ? (
          <ErrorBanner className="mt-4" message={cancel.error.message} />
        ) : null}
        {remove.isError ? (
          <ErrorBanner className="mt-4" message={remove.error.message} />
        ) : null}
        {data.errorMessage ? (
          <ErrorBanner className="mt-4" message={data.errorMessage} />
        ) : null}

        <Panel className="mt-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Exit code">{formatExit(data.exitCode, data.signal)}</Stat>
            <Stat label="Duration">{formatDuration(data.durationMs)}</Stat>
            <Stat label="Started">{formatDateTime(data.startedAt ?? data.queuedAt)}</Stat>
            <Stat label="Finished">{formatDateTime(data.finishedAt)}</Stat>
            <Stat label="Output">{formatBytes(data.logBytes)}</Stat>
            <Stat label="Target">
              <span className="truncate">{data.targetName}</span>
            </Stat>
          </div>

          <dl className="border-line mt-4 grid gap-3 border-t pt-4">
            <div className="grid gap-1.5">
              <dt className="label">Command</dt>
              <dd className="border-line bg-base mono text-ink overflow-x-auto rounded-lg border px-2.5 py-2 text-body whitespace-pre">
                {data.commandDisplay}
              </dd>
            </div>
            <div className="grid gap-1.5">
              <dt className="label">Parameters</dt>
              <dd className="mono text-body">
                {Object.keys(data.paramValues).length === 0 ? (
                  <span className="text-faint">{formatParams(data.paramValues)}</span>
                ) : (
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {Object.entries(data.paramValues).map(([key, value]) => (
                      <span key={key} className="inline-flex items-baseline gap-1.5">
                        <span className="text-mute">{key}</span>
                        <span className="text-faint">=</span>
                        <span className="text-ink break-all">{value}</span>
                      </span>
                    ))}
                  </div>
                )}
              </dd>
            </div>
            {data.argv.length > 0 ? (
              <div className="grid gap-1.5">
                <dt className="label">Arguments</dt>
                <dd className="mono text-body flex flex-col gap-1">
                  {data.argv.map((value, index) => (
                    // Position is part of what the value meant: these are read
                    // as `$1`, `$2` …, not by name.
                    <span key={`${index}-${value}`} className="inline-flex items-baseline gap-1.5">
                      <span className="text-faint w-6 shrink-0 text-right">${index + 1}</span>
                      <span className="text-ink break-all">{value === '' ? '(empty)' : value}</span>
                    </span>
                  ))}
                </dd>
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <dt className="label">Script path (relative to source)</dt>
              <dd>
                <MonoValue value={data.scriptRelPath} wrap />
              </dd>
            </div>
          </dl>
        </Panel>

        {data.truncated ? (
          <WarningBanner className="mt-4">
            <strong className="font-medium">Output was truncated.</strong> This run produced{' '}
            {formatBytes(data.logBytes)} and the server cut the tail. What follows is incomplete past
            the cut point.
          </WarningBanner>
        ) : null}

        <div className="mt-5">
          <Suspense
            fallback={
              <div className="border-line bg-base text-mute shadow-card flex h-[360px] items-center justify-center rounded-xl border text-body">
                Loading terminal…
              </div>
            }
          >
            <RunTerminal executionId={data.id} live={isLive} onStatus={applyUpdate} />
          </Suspense>
        </div>
      </PageBody>
    </div>
  );
}
