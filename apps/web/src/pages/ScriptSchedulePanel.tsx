import { useState } from 'react';
import type { ExecuteScriptInput } from '@dashboard/shared';
import { Clock, Save, Trash } from 'lucide-react';
import { useDeleteScriptSchedule, useSaveScriptSchedule, useScriptSchedule } from '../api/queries';
import { errorMessage } from '../api/client';
import { Button } from '../components/Button';
import { ErrorBanner } from '../components/Feedback';
import { Field, Switch, TextInput } from '../components/Form';
import { formatDateTime } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { href } from '../lib/router';

const DEFAULT_CRON = '*/5 * * * *';

export function ScriptSchedulePanel({ scriptId, getInput }: {
  scriptId: string;
  /** Uses the run form's own validation, so unattended runs cannot bypass it. */
  getInput: () => ExecuteScriptInput | null;
}) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const query = useScriptSchedule(scriptId);
  const save = useSaveScriptSchedule();
  const remove = useDeleteScriptSchedule();
  const schedule = query.data;
  const [cron, setCron] = useState(DEFAULT_CRON);
  const [timeZone, setTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [newEnabled, setNewEnabled] = useState(true);
  const [seeded, setSeeded] = useState(false);

  if (schedule !== undefined && !seeded) {
    setSeeded(true);
    if (schedule) {
      setCron(schedule.cron);
      setTimeZone(schedule.timeZone);
    }
  }

  const pending = save.isPending || remove.isPending;
  const enabled = schedule?.enabled ?? newEnabled;

  function submit(): void {
    const input = getInput();
    if (!input || !cron.trim() || !timeZone.trim()) return;
    save.mutate({ scriptId, input: { cron, timeZone, enabled, input } });
  }

  function toggle(next: boolean): void {
    if (!schedule) {
      setNewEnabled(next);
      return;
    }
    // Toggling must preserve the saved target and arguments, even if the run form has changed.
    save.mutate({ scriptId, input: { cron: schedule.cron, timeZone: schedule.timeZone, enabled: next, input: schedule.input } });
  }

  function deleteSchedule(): void {
    remove.mutate(scriptId, { onSuccess: () => {
      setCron(DEFAULT_CRON);
      setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
      setNewEnabled(true);
    } });
  }

  return (
    <section aria-label={t('schedule.title')} className="border-line grid gap-4 border-t pt-5">
      <h3 className="text-ink flex items-center gap-2 font-semibold">
        <Clock className="text-accent size-4" aria-hidden />
        {t('schedule.title')}
      </h3>
      {query.isPending ? <p className="text-mute text-meta">{t('schedule.loading')}</p> : query.isError ? (
        <ErrorBanner message={errorMessage(query.error, i18n)} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <p className="text-mute text-meta">{t('schedule.snapshotHint')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('schedule.cron')} hint={t('schedule.cronHint')}>
              {({ id, describedBy }) => <TextInput id={id} aria-describedby={describedBy} className="mono" value={cron} maxLength={200} placeholder={DEFAULT_CRON} onChange={(event) => setCron(event.target.value)} />}
            </Field>
            <Field label={t('schedule.timeZone')} hint={t('schedule.timeZoneHint')}>
              {({ id, describedBy }) => <TextInput id={id} aria-describedby={describedBy} className="mono" value={timeZone} maxLength={100} placeholder="Asia/Shanghai" onChange={(event) => setTimeZone(event.target.value)} />}
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <span className="label">{t('schedule.enabled')}</span>
            <Switch label={t('schedule.enabled')} checked={enabled} onChange={toggle} disabled={pending} />
          </div>
          {schedule ? (
            <div className="bg-panel-2/50 grid min-w-0 gap-3 rounded-lg p-4 text-meta">
              <h4 className="font-semibold">{t('schedule.savedSettings')}</h4>
              <dl className="grid gap-2">
                <div><dt className="text-faint">{t('schedule.target')}</dt><dd className="break-all">{schedule.targetName}</dd></div>
                <div><dt className="text-faint">{t('schedule.savedRule')}</dt><dd className="mono break-all">{schedule.cron} · {schedule.timeZone}</dd></div>
                <div><dt className="text-faint">{t('schedule.params')}</dt><dd className="mono whitespace-pre-wrap break-all">{Object.entries(schedule.input.params).map(([name, value]) => `${name}=${value}`).join('\n') || t('schedule.none')}</dd></div>
                <div><dt className="text-faint">{t('schedule.argv')}</dt><dd className="mono whitespace-pre-wrap break-all">{schedule.input.argv.map((value, index) => `$${index + 1}: ${value}`).join('\n') || t('schedule.none')}</dd></div>
                <div><dt className="text-faint">{t('schedule.timeout')}</dt><dd>{schedule.input.timeoutSec === undefined ? t('schedule.defaultTimeout') : t('schedule.seconds', { seconds: schedule.input.timeoutSec })}</dd></div>
                <div><dt className="text-faint">{t('schedule.nextRun')}</dt><dd>{schedule.enabled ? formatDateTime(schedule.nextRunAt, locale) : t('schedule.paused')}</dd></div>
                <div><dt className="text-faint">{t('schedule.lastTrigger')}</dt><dd>{formatDateTime(schedule.lastTriggeredAt, locale)}</dd></div>
              </dl>
              {schedule.lastExecutionId ? <a className="text-accent w-fit underline underline-offset-2" href={href(`/runs/${encodeURIComponent(schedule.lastExecutionId)}`)}>{t('schedule.viewRun')}</a> : null}
              {schedule.lastError ? <p className="text-danger" role="alert">{t(`schedule.error.${schedule.lastError}`)}</p> : null}
            </div>
          ) : null}
          {/* Validation must remain visible above the modal’s controls, beyond the global toast layer. */}
          {save.isError ? <ErrorBanner message={errorMessage(save.error, i18n)} /> : null}
          {remove.isError ? <ErrorBanner message={errorMessage(remove.error, i18n)} /> : null}
          <p className="text-faint text-meta">{t('schedule.behaviorHint')}</p>
          <div className="flex flex-wrap gap-3">
            <Button icon={<Save className="size-4" aria-hidden />} onClick={submit} disabled={pending || !cron.trim() || !timeZone.trim()} loading={save.isPending}>{t('schedule.save')}</Button>
            {schedule ? <Button icon={<Trash className="size-4" aria-hidden />} onClick={deleteSchedule} disabled={pending} loading={remove.isPending}>{t('schedule.delete')}</Button> : null}
          </div>
        </>
      )}
    </section>
  );
}
