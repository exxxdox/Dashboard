import type { ScriptSummary } from '@dashboard/shared';
import { Clock } from 'lucide-react';
import { useScriptSchedule, useScriptSchedules, useScripts } from '../api/queries';
import { errorMessage } from '../api/client';
import { PageBody } from '../components/AppShell';
import { EmptyState, ErrorBanner, LoadingBlock } from '../components/Feedback';
import { Field, Select } from '../components/Form';
import { PageHeader } from '../components/PageHeader';
import { Panel } from '../components/Panel';
import { formatDateTime } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { href, navigate } from '../lib/router';
import { RunPanel } from './RunPanel';
import { ScriptSchedulePanel } from './ScriptSchedulePanel';

/** A schedule is edited here, separately from the script's manual run draft. */
export function SchedulesPage({ scriptId }: { scriptId: string | null }) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const scripts = useScripts();
  const schedules = useScriptSchedules();
  const selected = scripts.data?.find((script) => script.id === scriptId);
  const scriptNames = new Map(scripts.data?.map((script) => [script.id, `${script.displayName} · ${script.relPath}`]));

  return (
    <PageBody>
      <PageHeader eyebrow={t('schedule.page.eyebrow')} title={t('schedule.page.title')} description={t('schedule.page.description')} />
      <div className="mt-5 grid gap-4">
        <Panel title={t('schedule.plans')} aside={<Clock className="text-faint size-5" aria-hidden />}>
          {schedules.isError ? <ErrorBanner message={errorMessage(schedules.error, i18n)} onRetry={() => void schedules.refetch()} /> : schedules.isPending ? <LoadingBlock /> : schedules.data?.length ? (
            <ul className="grid gap-2">
              {schedules.data.map((schedule) => (
                <li key={schedule.scriptId}>
                  <a href={href(`/schedules/${encodeURIComponent(schedule.scriptId)}`)} aria-current={schedule.scriptId === scriptId ? 'page' : undefined}
                    className="focus-ring border-line hover:border-line-strong grid gap-2 rounded-lg border p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <span className="min-w-0">
                      <span className="text-ink block break-all font-semibold">{scriptNames.get(schedule.scriptId) ?? schedule.scriptId}</span>
                      <span className="mono text-mute text-meta block break-all">{schedule.cron} · {schedule.timeZone} · {schedule.targetName}</span>
                    </span>
                    <span className="text-mute text-meta self-center sm:text-right">
                      {schedule.enabled ? t('schedule.nextAt', { when: formatDateTime(schedule.nextRunAt, locale) }) : t('schedule.paused')}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : <EmptyState title={t('schedule.empty.title')} description={t('schedule.empty.description')} />}
        </Panel>

        <Panel title={t('schedule.editor')}>
          <div className="grid gap-5">
            {scripts.isError ? <ErrorBanner message={errorMessage(scripts.error, i18n)} onRetry={() => void scripts.refetch()} /> : scripts.isPending ? <LoadingBlock /> : (
              <Field label={t('schedule.script')} hint={t('schedule.scriptHint')}>
                {({ id, describedBy }) => <Select id={id} aria-describedby={describedBy} value={scriptId ?? ''} onChange={(event) => navigate(event.target.value ? `/schedules/${encodeURIComponent(event.target.value)}` : '/schedules')}>
                  <option value="">{t('schedule.chooseScript')}</option>
                  {scripts.data?.map((script) => <option key={script.id} value={script.id}>{script.displayName} · {script.relPath}</option>)}
                </Select>}
              </Field>
            )}
            {selected ? <ScheduleEditor key={selected.id} script={selected} /> : scriptId && scripts.data ? <EmptyState title={t('schedule.scriptMissing')} description={t('schedule.scriptHint')} /> : null}
          </div>
        </Panel>
      </div>
    </PageBody>
  );
}

function ScheduleEditor({ script }: { script: ScriptSummary }) {
  const i18n = useI18n();
  const query = useScriptSchedule(script.id);
  if (query.isError && query.data === undefined) return <ErrorBanner message={errorMessage(query.error, i18n)} onRetry={() => void query.refetch()} />;
  if (query.isPending || query.data === undefined) return <LoadingBlock />;
  return (
    // Keep cached forms mounted on poll errors; the Cron panel reports the error without losing edits.
    <RunPanel key={`${script.id}:${query.data ? 'saved' : 'new'}`} script={script} mode="schedule" initialInput={query.data?.input}>
      {(getInput) => <ScriptSchedulePanel scriptId={script.id} getInput={getInput} />}
    </RunPanel>
  );
}
