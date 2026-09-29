/**
 * The DNS check history: totals, one page of rows, and paging.
 *
 * The totals come from the server's own aggregation rather than from the rows
 * below them, so a page and its summary cannot disagree.
 */

import { Button } from '../components/Button';
import { EmptyState, ErrorBanner, LoadingRows } from '../components/Feedback';
import { Stat } from '../components/Panel';
import { errorMessage } from '../api/client';
import { useDnsChecks, useDnsState } from '../api/queries';
import { ACTION_LABEL, FAILURE_TEXT, SOURCE_LABEL } from '../lib/dns';
import { formatDateTime, formatRelative } from '../lib/format';
import { navigate } from '../lib/router';

const PAGE_SIZE = 25;

/**
 * Defined once: the header and every row share it, so a column cannot drift out
 * of line with its heading.
 */
const GRID_COLUMNS =
  'grid-cols-[9.5rem_6rem_5.5rem_minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[10rem_6rem_5.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]';

function readPage(search: URLSearchParams): number {
  const raw = Number(search.get('page'));
  return Number.isInteger(raw) && raw > 0 ? raw : 1;
}

export function DnsHistoryTable({ search }: { search: URLSearchParams }) {
  const state = useDnsState();
  const page = readPage(search);
  const offset = (page - 1) * PAGE_SIZE;
  const checks = useDnsChecks({ limit: PAGE_SIZE, offset });

  const summary = state.data?.history.summary;

  return (
    <div className="grid gap-4 p-4">
      {summary ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Stat label="Checks" mono>
            {summary.total}
          </Stat>
          <Stat label="Succeeded" mono>
            {summary.succeeded}
          </Stat>
          <Stat label="Failed" mono>
            {summary.failed}
          </Stat>
          <Stat label="Changed" mono>
            {summary.changed}
          </Stat>
          <Stat label="Last change" mono>
            {formatRelative(summary.lastChangeAt)}
            <span className="text-faint ml-2">{formatDateTime(summary.lastChangeAt)}</span>
          </Stat>
        </div>
      ) : null}

      {checks.isError ? (
        <ErrorBanner message={errorMessage(checks.error)} onRetry={() => void checks.refetch()} />
      ) : checks.isPending ? (
        <LoadingRows rows={5} />
      ) : checks.data.items.length === 0 ? (
        <EmptyState
          title="No checks yet"
          description="Every manual and scheduled check is recorded here, including the ones that failed."
        />
      ) : (
        <>
          <div role="grid" aria-label="DNS checks">
            <div
              role="row"
              className={`border-line text-faint grid ${GRID_COLUMNS} items-center gap-3 border-b px-1 py-2`}
            >
              <span className="label">Ran</span>
              <span className="label">Source</span>
              <span className="label">Result</span>
              <span className="label">Address</span>
              <span className="label">Previous</span>
              <span className="label hidden xl:block">Why</span>
            </div>

            {checks.data.items.map((check) => (
              <div
                key={check.id}
                role="row"
                className={`border-line grid ${GRID_COLUMNS} items-center gap-3 border-b px-1 py-2.5 last:border-b-0`}
              >
                <span className="mono text-mute text-meta" title={formatDateTime(check.at)}>
                  {formatRelative(check.at)}
                </span>
                <span className="text-mute text-meta">{SOURCE_LABEL[check.source]}</span>
                <span className={check.ok ? 'text-ok text-meta' : 'text-danger text-meta'}>
                  {ACTION_LABEL[check.action]}
                </span>
                <span className="mono text-ink text-meta truncate">
                  {check.ipv6 === '' ? '—' : check.ipv6}
                </span>
                <span className="mono text-faint text-meta truncate">
                  {check.previousValue ?? '—'}
                </span>
                <span className="text-faint text-meta hidden truncate xl:block">
                  {check.failureReason === null ? '—' : FAILURE_TEXT[check.failureReason]}
                </span>
              </div>
            ))}
          </div>

          {checks.data.total > PAGE_SIZE ? (
            <div className="flex items-center justify-between">
              <span className="text-faint mono text-meta">
                {offset + 1}–{Math.min(offset + checks.data.items.length, checks.data.total)} of{' '}
                {checks.data.total}
              </span>
              <div className="flex items-center gap-2.5">
                <Button
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => navigate(`/dns?page=${page - 1}`)}
                >
                  Newer
                </Button>
                <Button
                  size="sm"
                  disabled={offset + PAGE_SIZE >= checks.data.total}
                  onClick={() => navigate(`/dns?page=${page + 1}`)}
                >
                  Older
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
