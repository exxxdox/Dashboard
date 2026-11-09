import { useState } from 'react';
import { useScriptScheduleExecutions } from '../api/queries';
import { errorMessage } from '../api/client';
import { Button } from '../components/Button';
import { EmptyState, ErrorBanner, LoadingBlock } from '../components/Feedback';
import { Panel } from '../components/Panel';
import { ExecutionStatusLabel } from '../components/StatusDot';
import { formatDateTime, formatDuration } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { href } from '../lib/router';

const PAGE_SIZE = 20;

/** History is scoped to the plan ID, since one script can have several independent plans. */
export function ScheduleExecutions({ scheduleId }: { scheduleId: string }) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const [offset, setOffset] = useState(0);
  const query = useScriptScheduleExecutions(scheduleId, offset);
  const data = query.data;
  return (
    <Panel title={t('schedule.history.title')}>
      <div className="grid gap-4">
        {query.isError ? <ErrorBanner message={errorMessage(query.error, i18n)} onRetry={() => void query.refetch()} /> : null}
        {query.isPending ? <LoadingBlock /> : data ? (
          <>
            {data.items.length ? <ul className="grid gap-2">
              {data.items.map((run) => <li key={run.id}>
                <a className="focus-ring border-line grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto]" href={href(`/runs/${encodeURIComponent(run.id)}`)}>
                  <span className="grid min-w-0 gap-1">
                    <ExecutionStatusLabel status={run.status} />
                    <span className="text-mute text-meta break-all">{formatDateTime(run.queuedAt, locale)} · {run.targetName}</span>
                  </span>
                  <span className="text-mute text-meta self-center">{t('schedule.history.duration', { duration: formatDuration(run.durationMs) })}</span>
                </a>
              </li>)}
            </ul> : <EmptyState title={t('schedule.history.empty')} description={t('schedule.history.emptyHint')} />}
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" disabled={offset === 0 || query.isFetching} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>{t('runs.previous')}</Button>
              <span className="text-mute text-meta">{t('runs.range', { from: data.total === 0 ? 0 : offset + 1, to: offset + data.items.length, total: data.total })}</span>
              <Button size="sm" disabled={offset + PAGE_SIZE >= data.total || query.isFetching} onClick={() => setOffset(offset + PAGE_SIZE)}>{t('runs.next')}</Button>
            </div>
          </>
        ) : null}
      </div>
    </Panel>
  );
}
