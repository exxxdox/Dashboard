/**
 * The newest few checks, as a glance rather than a table.
 *
 * History is the part of this page nobody reads until something is wrong, so
 * the page shows the last handful and the table -- with its totals and its
 * paging -- lives behind a button. The rows come from the state payload the
 * page already holds, so the preview costs no request of its own.
 */

import type { DnsCheck } from '@dashboard/shared';

import { Button } from '../components/Button';
import { EmptyState } from '../components/Feedback';
import { resultLabel } from '../lib/dns';
import { formatDateTime, formatRelative } from '../lib/format';
import { useI18n } from '../lib/i18n';

/** Three columns rather than the table's six: the ones a glance actually needs. */
const GRID = 'grid-cols-[6.5rem_5.5rem_minmax(0,1fr)]';

export function DnsHistoryPreview({
  checks,
  onViewAll,
}: {
  checks: DnsCheck[];
  onViewAll: () => void;
}) {
  const { t, locale } = useI18n();

  if (checks.length === 0) {
    return (
      <div className="p-5">
        <EmptyState
          title={t('dns.history.empty.title')}
          description={t('dns.history.empty.description')}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-4 p-5">
      <ul className="grid">
        {checks.map((check) => (
          <li
            key={check.id}
            className={`grid ${GRID} items-center gap-4 rounded-lg px-2 py-2.5 odd:bg-panel-2/40`}
          >
            <span className="mono text-mute text-meta" title={formatDateTime(check.at, locale)}>
              {formatRelative(check.at, t)}
            </span>
            <span className={check.ok ? 'text-ok text-meta' : 'text-danger text-meta'}>
              {resultLabel(t, check.action)}
            </span>
            <span className="mono text-ink text-meta truncate">
              {check.ipv6 === '' ? t('common.dash') : check.ipv6}
            </span>
          </li>
        ))}
      </ul>

      <div>
        <Button size="sm" onClick={onViewAll}>
          {t('dns.history.viewAll')}
        </Button>
      </div>
    </div>
  );
}
