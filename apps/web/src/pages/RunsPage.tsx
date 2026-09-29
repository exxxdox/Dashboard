import { useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, Terminal } from 'lucide-react';
import type { ExecutionStatus } from '@dashboard/shared';
import { PageBody } from '../components/AppShell';
import { PageHeader } from '../components/PageHeader';
import { Panel } from '../components/Panel';
import { Button } from '../components/Button';
import { EmptyState, ErrorBanner, LoadingRows } from '../components/Feedback';
import { ExecutionStatusLabel } from '../components/StatusDot';
import { KeyHints } from '../components/KeyHints';
import { Select } from '../components/Form';
import { ScriptSearch } from '../components/ScriptSearch';
import { useExecutions, useScript, useTargets } from '../api/queries';
import { errorMessage } from '../api/client';
import { EXECUTION_STATUS_META, executionStatusLabel } from '../lib/status';
import { formatDuration, formatRelative, formatExit, runTag } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { goBack, href, navigate, type Route } from '../lib/router';
import { useListKeyboard } from '../lib/keyboard';

const PAGE_SIZE = 25;

const STATUS_OPTIONS = Object.keys(EXECUTION_STATUS_META) as ExecutionStatus[];

// One grid definition for the header and every row, so the columns cannot drift
// apart. A single fixed template would keep reserving tracks for the cells that
// are hidden at narrow widths, squeezing the script column to nothing, so each
// breakpoint declares exactly the tracks its visible cells occupy.
// The breakpoints also account for the rail: it appears at `lg` and takes 264px,
// so a column only earns its place one step later than the viewport alone would
// suggest. Widths are what the type scale needs, not round numbers.
const GRID_COLUMNS = [
  'grid-cols-[104px_148px_minmax(160px,1fr)_96px]',
  'md:grid-cols-[104px_148px_minmax(160px,1fr)_100px_96px]',
  'xl:grid-cols-[104px_148px_minmax(200px,1fr)_180px_100px_96px]',
  '2xl:grid-cols-[104px_148px_minmax(200px,1fr)_180px_100px_96px_116px]',
].join(' ');

type RunsFilters = {
  status: string;
  scriptId: string;
  targetId: string;
  page: number;
};

function readFilters(search: URLSearchParams): RunsFilters {
  const page = Number.parseInt(search.get('page') ?? '1', 10);
  return {
    status: search.get('status') ?? '',
    scriptId: search.get('scriptId') ?? '',
    targetId: search.get('targetId') ?? '',
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export function RunsPage({ route }: { route: Extract<Route, { name: 'runs' }> }) {
  const i18n = useI18n();
  const t = i18n.t;
  const filters = useMemo(() => readFilters(route.search), [route.search]);
  const containerRef = useRef<HTMLDivElement>(null);
  // `/` focuses the script picker — the filter worth reaching for mid-scan.
  const searchRef = useRef<HTMLInputElement>(null);

  const offset = (filters.page - 1) * PAGE_SIZE;
  const executions = useExecutions({
    status: filters.status || undefined,
    scriptId: filters.scriptId || undefined,
    targetId: filters.targetId || undefined,
    limit: PAGE_SIZE,
    offset,
  });

  const targets = useTargets();
  // Resolved so the picker can show the chosen script's path, not a raw id.
  const selectedScript = useScript(filters.scriptId || null);

  const items = executions.data?.items ?? [];
  const total = executions.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function applyFilters(patch: Partial<RunsFilters>): void {
    const next = { ...filters, ...patch };
    // Any filter change resets paging; staying on page 4 of a new filter is a trap.
    if (!('page' in patch)) next.page = 1;
    navigate(
      href('/runs', {
        status: next.status || undefined,
        scriptId: next.scriptId || undefined,
        targetId: next.targetId || undefined,
        page: next.page > 1 ? next.page : undefined,
      }),
    );
  }

  const keyboard = useListKeyboard({
    count: items.length,
    containerRef,
    searchRef,
    onOpen: (index) => {
      const execution = items[index];
      if (execution) navigate(`/runs/${encodeURIComponent(execution.id)}`);
    },
    onEscape: () => {
      // `Esc` first drops the keyboard cursor; only then does it leave the page.
      if (keyboard.activeIndex >= 0) keyboard.setActiveIndex(-1);
      else goBack('/');
    },
  });

  const hasFilters = Boolean(filters.status || filters.scriptId || filters.targetId);

  return (
    <PageBody>
      <PageHeader
        eyebrow={t('runs.eyebrow')}
        title={t('nav.runs')}
        description={t('runs.description')}
        hints={
          <KeyHints
            hints={[
              { keys: ['j', 'k'], label: t('runs.hint.move') },
              { keys: ['/'], label: t('runs.hint.search') },
              { keys: ['↵'], label: t('runs.hint.open') },
              { keys: ['esc'], label: t('runs.hint.back') },
            ]}
          />
        }
        actions={
          <Button
            icon={<RotateCcw className="size-4" aria-hidden />}
            onClick={() => void executions.refetch()}
            loading={executions.isFetching}
          >
            {t('runs.refresh')}
          </Button>
        }
      />

      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <Select
          aria-label={t('runs.filter.status')}
          value={filters.status}
          onChange={(event) => applyFilters({ status: event.target.value })}
          className="w-[184px] shrink-0"
        >
          <option value="">{t('runs.filter.allStatuses')}</option>
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {executionStatusLabel(t, status)}
            </option>
          ))}
        </Select>

        <ScriptSearch
          inputRef={searchRef}
          selected={selectedScript.data ?? null}
          onSelect={(script) => applyFilters({ scriptId: script?.id ?? '' })}
        />

        <Select
          aria-label={t('runs.filter.target')}
          value={filters.targetId}
          onChange={(event) => applyFilters({ targetId: event.target.value })}
          className="w-[208px] shrink-0"
        >
          <option value="">{t('runs.filter.allTargets')}</option>
          {(targets.data ?? []).map((target) => (
            <option key={target.id} value={target.id}>
              {target.name}
            </option>
          ))}
        </Select>

        {hasFilters ? (
          <Button size="sm" variant="ghost" onClick={() => navigate('/runs')}>
            {t('common.clear')}
          </Button>
        ) : null}

        <span className="text-faint mono text-meta ml-auto shrink-0">
          {total === 1
            ? t('runs.count.one', { count: total })
            : t('runs.count.many', { count: total })}
        </span>
      </div>

      {executions.isError ? (
        <ErrorBanner
          className="mt-4"
          message={errorMessage(executions.error, i18n)}
          onRetry={() => void executions.refetch()}
        />
      ) : null}

      <Panel className="mt-5" flush>
        {executions.isPending ? (
          <LoadingRows rows={8} />
        ) : items.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<Terminal className="size-5" aria-hidden />}
              title={hasFilters ? t('runs.empty.filtered.title') : t('runs.empty.none.title')}
              description={
                hasFilters
                  ? t('runs.empty.filtered.description')
                  : t('runs.empty.none.description')
              }
              action={
                hasFilters ? (
                  <Button size="sm" onClick={() => navigate('/runs')}>
                    {t('runs.empty.filtered.action')}
                  </Button>
                ) : (
                  <Button size="sm" variant="primary" onClick={() => navigate('/scripts')}>
                    {t('runs.empty.none.action')}
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <div ref={containerRef} role="grid" aria-label={t('runs.eyebrow')}>
            <div
              role="row"
              className={`border-line text-faint grid ${GRID_COLUMNS} items-center gap-4 border-b px-4 py-2.5`}
            >
              <span className="label">{t('runs.col.run')}</span>
              <span className="label">{t('runs.col.status')}</span>
              <span className="label">{t('runs.col.script')}</span>
              <span className="label hidden xl:block">{t('runs.col.target')}</span>
              <span className="label hidden text-right md:block">{t('runs.col.exit')}</span>
              <span className="label text-right">{t('runs.col.time')}</span>
              <span className="label hidden text-right 2xl:block">{t('runs.col.queued')}</span>
            </div>

            {items.map((execution, index) => (
              <button
                key={execution.id}
                type="button"
                role="row"
                data-row-index={index}
                onClick={() => navigate(`/runs/${encodeURIComponent(execution.id)}`)}
                onMouseMove={() => keyboard.setActiveIndex(index)}
                className={`focus-ring border-line grid w-full ${GRID_COLUMNS} items-center gap-4 border-b px-4 py-3 text-left transition-colors duration-150 ease-out last:border-b-0 ${
                  keyboard.activeIndex === index ? 'row-active' : 'hover:bg-panel-2'
                }`}
              >
                <span className="mono text-faint text-meta">{runTag(execution.id)}</span>
                <ExecutionStatusLabel status={execution.status} />
                <span className="mono text-ink text-body min-w-0 truncate" title={execution.scriptRelPath}>
                  {execution.scriptName}
                  <span className="text-faint ml-2">{execution.scriptRelPath}</span>
                </span>
                <span className="text-mute text-meta hidden truncate xl:block">{execution.targetName}</span>
                <span className="mono text-mute text-meta hidden text-right md:block">
                  {execution.status === 'running' || execution.status === 'queued'
                    ? t('common.dash')
                    : formatExit(execution.exitCode, execution.signal)}
                </span>
                <span className="mono text-mute text-meta text-right">
                  {formatDuration(execution.durationMs)}
                </span>
                <span className="text-faint text-meta hidden text-right 2xl:block">
                  {formatRelative(execution.queuedAt, t)}
                </span>
              </button>
            ))}
          </div>
        )}
      </Panel>

      {total > PAGE_SIZE ? (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-faint mono text-meta">
            {t('runs.range', {
              from: offset + 1,
              to: Math.min(offset + items.length, total),
              total,
            })}
          </span>
          <div className="flex items-center gap-2.5">
            <Button
              size="sm"
              disabled={filters.page <= 1}
              icon={<ChevronLeft className="size-4" aria-hidden />}
              onClick={() => applyFilters({ page: filters.page - 1 })}
            >
              {t('runs.previous')}
            </Button>
            <span className="text-mute mono text-meta">
              {filters.page} / {lastPage}
            </span>
            <Button
              size="sm"
              disabled={filters.page >= lastPage}
              onClick={() => applyFilters({ page: filters.page + 1 })}
            >
              {t('runs.next')}
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      ) : null}
    </PageBody>
  );
}
