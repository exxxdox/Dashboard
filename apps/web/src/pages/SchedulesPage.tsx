import { useState } from 'react';
import { Clock, History, Pause, Pencil, Play, Plus, Trash } from 'lucide-react';
import { useDeleteScriptSchedule, useSaveScriptSchedule, useScriptSchedule, useScriptSchedules, useScripts } from '../api/queries';
import { errorMessage } from '../api/client';
import { PageBody } from '../components/AppShell';
import { Button } from '../components/Button';
import { EmptyState, ErrorBanner, LoadingBlock } from '../components/Feedback';
import { Field, Select } from '../components/Form';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
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
  const remove = useDeleteScriptSchedule();
  const save = useSaveScriptSchedule();
  const pending = save.isPending || remove.isPending;
  const [creating, setCreating] = useState(false);
  const [saveActionContainer, setSaveActionContainer] = useState<HTMLDivElement | null>(null);
  // History belongs to the row action, independently of the editable plan route.
  const [history, setHistory] = useState<{ id: string; name: string } | null>(null);
  const query = useScriptSchedule(scheduleId);
  const [chosenScriptId, setChosenScriptId] = useState('');
  const saved = scheduleId ? query.data : null;
  const scriptId = saved?.scriptId ?? chosenScriptId;
  const selected = scripts.data?.find((script) => script.id === scriptId);
  // The scanner uses the file name as the default display name; only add a distinct path.
  const scriptNames = new Map(scripts.data?.map((script) => [script.id, script.displayName === script.relPath ? script.displayName : `${script.displayName} · ${script.relPath}`]));
  const editorOpen = creating || Boolean(scheduleId);

  function closeEditor(): void {
    setCreating(false);
    navigate('/schedules');
  }

  function create(): void {
    setChosenScriptId('');
    setCreating(true);
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
                <li key={schedule.id} className="border-line grid gap-3 rounded-lg border p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <a href={href(`/schedules/${encodeURIComponent(schedule.id)}`)} aria-current={schedule.id === scheduleId ? 'page' : undefined}
                    className="focus-ring grid min-w-0 gap-2 rounded-lg sm:grid-cols-[minmax(0,1fr)_auto]">
                    <span className="min-w-0">
                      <span className="text-ink block break-all font-semibold">{schedule.name}</span>
                      <span className="text-mute text-meta block break-all">{scriptNames.get(schedule.scriptId) ?? schedule.scriptId}</span>
                      <span className="mono text-mute text-meta block break-all">{schedule.cron} · {schedule.timeZone} · {schedule.targetName}</span>
                    </span>
                    <span className="text-mute text-meta self-center sm:text-right">
                      {schedule.enabled ? t('schedule.nextAt', { when: formatDateTime(schedule.nextRunAt, locale) }) : t('schedule.paused')}
                    </span>
                  </a>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Toggle only the saved snapshot, never the editor's unsaved input. */}
                    <Button size="sm" icon={schedule.enabled ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />} disabled={pending} onClick={() => save.mutate({ scheduleId: schedule.id, input: {
                      scriptId: schedule.scriptId, name: schedule.name, retentionDays: schedule.retentionDays,
                      cron: schedule.cron, timeZone: schedule.timeZone, enabled: !schedule.enabled, input: schedule.input,
                    } })}>{t(schedule.enabled ? 'schedule.pause' : 'schedule.resume')}</Button>
                    <Button size="sm" icon={<History className="size-4" aria-hidden />} onClick={() => setHistory({ id: schedule.id, name: schedule.name })}>{t('schedule.history.title')}</Button>
                    <Button size="sm" icon={<Pencil className="size-4" aria-hidden />} onClick={() => { setCreating(false); navigate(`/schedules/${encodeURIComponent(schedule.id)}`); }}>{t('schedule.edit')}</Button>
                    <Button size="sm" variant="danger" icon={<Trash className="size-4" aria-hidden />} disabled={pending} onClick={() => remove.mutate(schedule.id, { onSuccess: () => { if (scheduleId === schedule.id) closeEditor(); } })}>{t('schedule.delete')}</Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : <EmptyState title={t('schedule.empty.title')} description={t('schedule.empty.description')} />}
        </Panel>

        {editorOpen ? <Modal open onClose={closeEditor} title={t('schedule.editor')} size="lg" actions={<div ref={setSaveActionContainer} />}>
          <div className="grid gap-5">
            {scheduleId && query.isError ? <ErrorBanner message={errorMessage(query.error, i18n)} onRetry={() => void query.refetch()} /> : null}
            {scheduleId && !saved ? (query.isPending ? <LoadingBlock /> : null) : scripts.isError ? (
              <ErrorBanner message={errorMessage(scripts.error, i18n)} onRetry={() => void scripts.refetch()} />
            ) : scripts.isPending ? <LoadingBlock /> : (
              <>
                <Field label={t('schedule.script')} hint={t('schedule.scriptHint')}>
                  {({ id, describedBy }) => <Select id={id} aria-describedby={describedBy} value={scriptId} disabled={Boolean(saved)} onChange={(event) => setChosenScriptId(event.target.value)}>
                    <option value="">{t('schedule.chooseScript')}</option>
                    {scripts.data?.map((script) => <option key={script.id} value={script.id}>{scriptNames.get(script.id)}</option>)}
                  </Select>}
                </Field>
                {selected ? (
                  // Polling changes status, not this key: unfinished edits survive a failed refresh.
                  <RunPanel key={`${scheduleId ?? 'new'}:${selected.id}`} script={selected} mode="schedule" initialInput={saved?.input}>
                    {(getInput) => <ScriptSchedulePanel scriptId={selected.id} schedule={saved ?? null} defaultName={selected.displayName} getInput={getInput} onSaved={closeEditor} saveActionContainer={saveActionContainer} />}
                  </RunPanel>
                ) : scriptId ? <EmptyState title={t('schedule.scriptMissing')} description={t('schedule.scriptHint')} /> : null}
              </>
            )}
          </div>
        </Modal> : null}
        {history ? <Modal open onClose={() => setHistory(null)} title={t('schedule.history.title')} description={history.name} size="lg">
          <ScheduleExecutions key={history.id} scheduleId={history.id} />
        </Modal> : null}
      </div>
    </PageBody>
  );
}
