import { useState } from 'react';
import { Clock, Plus } from 'lucide-react';
import { useScriptSchedule, useScriptSchedules, useScripts } from '../api/queries';
import { errorMessage } from '../api/client';
import { PageBody } from '../components/AppShell';
import { Button } from '../components/Button';
import { EmptyState, ErrorBanner, LoadingBlock } from '../components/Feedback';
import { Field, Select } from '../components/Form';
import { PageHeader } from '../components/PageHeader';
import { Panel } from '../components/Panel';
import { formatDateTime } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { href, navigate } from '../lib/router';
import { RunPanel } from './RunPanel';
import { ScriptSchedulePanel } from './ScriptSchedulePanel';
import { ScheduleExecutions } from './ScheduleExecutions';

/** Plans have their own identity: selecting a script must never replace another plan. */
export function SchedulesPage({ scheduleId }: { scheduleId: string | null }) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const scripts = useScripts();
  const schedules = useScriptSchedules();
  const query = useScriptSchedule(scheduleId);
  const [chosenScriptId, setChosenScriptId] = useState('');
  const saved = scheduleId ? query.data : null;
  const scriptId = saved?.scriptId ?? chosenScriptId;
  const selected = scripts.data?.find((script) => script.id === scriptId);
  const scriptNames = new Map(scripts.data?.map((script) => [script.id, `${script.displayName} · ${script.relPath}`]));

  function create(): void {
    setChosenScriptId('');
    navigate('/schedules');
  }

  return (
    <PageBody>
      <PageHeader eyebrow={t('schedule.page.eyebrow')} title={t('schedule.page.title')} description={t('schedule.page.description')}
        actions={<Button icon={<Plus className="size-4" aria-hidden />} onClick={create}>{t('schedule.create')}</Button>} />
      <div className="mt-5 grid gap-4">
        <Panel title={t('schedule.plans')} aside={<Clock className="text-faint size-5" aria-hidden />}>
          {schedules.isError ? <ErrorBanner message={errorMessage(schedules.error, i18n)} onRetry={() => void schedules.refetch()} /> : schedules.isPending ? <LoadingBlock /> : schedules.data?.length ? (
            <ul className="grid gap-2">
              {schedules.data.map((schedule) => (
                <li key={schedule.id}>
                  <a href={href(`/schedules/${encodeURIComponent(schedule.id)}`)} aria-current={schedule.id === scheduleId ? 'page' : undefined}
                    className="focus-ring border-line hover:border-line-strong grid gap-2 rounded-lg border p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <span className="min-w-0">
                      <span className="text-ink block break-all font-semibold">{schedule.name}</span>
                      <span className="text-mute text-meta block break-all">{scriptNames.get(schedule.scriptId) ?? schedule.scriptId}</span>
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
            {scheduleId && query.isError ? <ErrorBanner message={errorMessage(query.error, i18n)} onRetry={() => void query.refetch()} /> : null}
            {scheduleId && !saved ? (query.isPending ? <LoadingBlock /> : null) : scripts.isError ? (
              <ErrorBanner message={errorMessage(scripts.error, i18n)} onRetry={() => void scripts.refetch()} />
            ) : scripts.isPending ? <LoadingBlock /> : (
              <>
                <Field label={t('schedule.script')} hint={t('schedule.scriptHint')}>
                  {({ id, describedBy }) => <Select id={id} aria-describedby={describedBy} value={scriptId} disabled={Boolean(saved)} onChange={(event) => setChosenScriptId(event.target.value)}>
                    <option value="">{t('schedule.chooseScript')}</option>
                    {scripts.data?.map((script) => <option key={script.id} value={script.id}>{script.displayName} · {script.relPath}</option>)}
                  </Select>}
                </Field>
                {selected ? (
                  // Polling changes status, not this key: unfinished edits survive a failed refresh.
                  <RunPanel key={`${scheduleId ?? 'new'}:${selected.id}`} script={selected} mode="schedule" initialInput={saved?.input}>
                    {(getInput) => <ScriptSchedulePanel scriptId={selected.id} schedule={saved ?? null} defaultName={selected.displayName} getInput={getInput} />}
                  </RunPanel>
                ) : scriptId ? <EmptyState title={t('schedule.scriptMissing')} description={t('schedule.scriptHint')} /> : null}
              </>
            )}
          </div>
        </Panel>
        {scheduleId && saved ? <ScheduleExecutions key={scheduleId} scheduleId={scheduleId} /> : null}
      </div>
    </PageBody>
  );
}
