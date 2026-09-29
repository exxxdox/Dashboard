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
import { failureText, resultLabel, sourceLabel } from '../lib/dns';
import { formatDateTime, formatRelative } from '../lib/format';
import { navigate } from '../lib/router';
import { useI18n } from '../lib/i18n';

const PAGE_SIZE = 25;

/**
 * Defined once: the header and every row share it, so a column cannot drift
 * out of line with its heading.
 */
const GRID_COLUMNS =
  'grid-cols-[9.5rem_6rem_5.5rem_minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[10rem_6rem_5.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]';

function readPage(search: URLSearchParams): number {
  const raw = Number(search.get('page'));
  return Number.isInteger(raw) && raw > 0 ? raw : 1;
}

export function DnsHistoryTable({ search }: { search: URLSearchParams }) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const state = useDnsState();
  const page = readPage(search);
  const offset = (page - 1) * PAGE_SIZE;
  const checks = useDnsChecks({ limit: PAGE_SIZE, offset });

  const summary = state.data?.history.summary;

  return (
    <div className="grid gap-5 p-5">
      {summary ? (
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-5">
          <Stat label={t('dns.history.checks')}>{summary.total}</Stat>
          <Stat label={t('dns.history.succeeded')}>{summary.succeeded}</Stat>
          <Stat label={t('dns.history.failed')}>{summary.failed}</Stat>
          <Stat label={t('dns.history.changed')}>{summary.changed}</Stat>
          <Stat label={t('dns.history.lastChange')} mono={false}>
            <span className="grid gap-1">
              <span>{formatRelative(summary.lastChangeAt, t)}</span>
              <span className="text-faint text-meta">
                {formatDateTime(summary.lastChangeAt, locale)}
              </span>
            </span>
          </Stat>
        </div>
      ) : null}

      {checks.isError ? (
        <ErrorBanner
          message={errorMessage(checks.error, i18n)}
          onRetry={() => void checks.refetch()}
        />
      ) : checks.isPending ? (
        <LoadingRows rows={5} />
      ) : checks.data.items.length === 0 ? (
        <EmptyState
          title={t('dns.history.empty.title')}
          description={t('dns.history.empty.description')}
        />
      ) : (
        <>
          <div role="grid" aria-label={t('dns.history.label')}>
            <div
              role="row"
              className={`border-line text-faint grid ${GRID_COLUMNS} items-center gap-3 border-b px-1 pb-3`}
            >
              <span className="label">{t('dns.history.column.ran')}</span>
              <span className="label">{t('dns.history.column.source')}</span>
              <span className="label">{t('dns.history.column.result')}</span>
              <span className="label">{t('dns.history.column.address')}</span>
              <span className="label">{t('dns.history.column.previous')}</span>
              <span className="label hidden xl:block">{t('dns.history.column.why')}</span>
            </div>

            {checks.data.items.map((check) => (
              <div
                key={check.id}
                role="row"
                className={`border-line grid ${GRID_COLUMNS} items-center gap-3 border-b px-1 py-3 last:border-b-0`}
              >
                <span className="mono text-mute text-meta" title={formatDateTime(check.at, locale)}>
                  {formatRelative(check.at, t)}
                </span>
                <span className="text-mute text-meta">{sourceLabel(t, check.source)}</span>
                <span className={check.ok ? 'text-ok text-meta' : 'text-danger text-meta'}>
                  {resultLabel(t, check.action)}
                </span>
                <span className="mono text-ink text-meta truncate">
                  {check.ipv6 === '' ? t('common.dash') : check.ipv6}
                </span>
                <span className="mono text-faint text-meta truncate">
                  {check.previousValue ?? t('common.dash')}
                </span>
                <span className="text-faint text-meta hidden truncate xl:block">
                  {check.failureReason === null
                    ? t('common.dash')
                    : failureText(t, check.failureReason)}
                </span>
              </div>
            ))}
          </div>

          {checks.data.total > PAGE_SIZE ? (
            <div className="flex items-center justify-between gap-4">
              <span className="text-faint mono text-meta">
                {t('dns.history.range', {
                  from: offset + 1,
                  to: Math.min(offset + checks.data.items.length, checks.data.total),
                  total: checks.data.total,
                })}
              </span>
              <div className="flex items-center gap-2.5">
                <Button
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => navigate(`/dns?page=${page - 1}`)}
                >
                  {t('dns.history.newer')}
                </Button>
                <Button
                  size="sm"
                  disabled={offset + PAGE_SIZE >= checks.data.total}
                  onClick={() => navigate(`/dns?page=${page + 1}`)}
                >
                  {t('dns.history.older')}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
