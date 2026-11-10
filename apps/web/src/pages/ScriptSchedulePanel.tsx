import { useState } from 'react';
import type { ExecuteScriptInput, ScriptSchedule } from '@dashboard/shared';
import { Clock, Save } from 'lucide-react';
import { useSaveScriptSchedule } from '../api/queries';
import { errorMessage } from '../api/client';
import { Button } from '../components/Button';
import { ErrorBanner } from '../components/Feedback';
import { Field, Switch, TextInput } from '../components/Form';
import { formatDateTime } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { href } from '../lib/router';

const DEFAULT_CRON = '*/5 * * * *';

export function ScriptSchedulePanel({ scriptId, schedule, defaultName, getInput, onSaved }: {
  onSaved?: () => void;
  scriptId: string;
  schedule: ScriptSchedule | null;
  defaultName: string;
  /** Uses the run form's own validation, so unattended runs cannot bypass it. */
  getInput: () => ExecuteScriptInput | null;
}) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const save = useSaveScriptSchedule();
  const [name, setName] = useState(schedule?.name ?? defaultName);
  const [cron, setCron] = useState(schedule?.cron ?? DEFAULT_CRON);
  const [timeZone, setTimeZone] = useState(schedule?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC');
  const [retentionDays, setRetentionDays] = useState(String(schedule?.retentionDays ?? 30));
  const [newEnabled, setNewEnabled] = useState(true);
  const pending = save.isPending;
  const enabled = schedule?.enabled ?? newEnabled;
  const retention = Number(retentionDays);
  const validRetention = retentionDays.trim() !== '' && Number.isInteger(retention) && retention >= 0 && retention <= 3650;

  function submit(): void {
    const input = getInput();
    if (!input || !name.trim() || !cron.trim() || !timeZone.trim() || !validRetention) return;
    save.mutate({ scheduleId: schedule?.id, input: { scriptId, name, retentionDays: retention, cron, timeZone, enabled, input } }, {
      onSuccess: () => onSaved?.(),
    });
  }

  function toggle(next: boolean): void {
    if (!schedule) { setNewEnabled(next); return; }
    // Toggling must preserve the saved invocation and policy, even while fields have unsaved edits.
    save.mutate({ scheduleId: schedule.id, input: {
      scriptId: schedule.scriptId, name: schedule.name, retentionDays: schedule.retentionDays,
      cron: schedule.cron, timeZone: schedule.timeZone, enabled: next, input: schedule.input,
    } });
  }

  return (
    <section aria-label={t('schedule.title')} className="border-line grid gap-4 border-t pt-5">
      <h3 className="text-ink flex items-center gap-2 font-semibold">
        <Clock className="text-accent size-4" aria-hidden />
        {t('schedule.title')}
      </h3>
          <p className="text-mute text-meta">{t('schedule.snapshotHint')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('schedule.name')}>
              {({ id }) => <TextInput id={id} value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />}
            </Field>
            <Field label={t('schedule.retention')} hint={t('schedule.retentionHint')}>
              {({ id, describedBy }) => <TextInput id={id} aria-describedby={describedBy} type="number" min={0} max={3650} step={1} value={retentionDays} onChange={(event) => setRetentionDays(event.target.value)} />}
            </Field>
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
          <p className="text-faint text-meta">{t('schedule.behaviorHint')}</p>
          <div className="flex flex-wrap gap-3">
            <Button icon={<Save className="size-4" aria-hidden />} onClick={submit} disabled={pending || !name.trim() || !cron.trim() || !timeZone.trim() || !validRetention} loading={save.isPending}>{t('schedule.save')}</Button>
          </div>
    </section>
  );
}
