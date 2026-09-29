/**
 * Where the dashboard reaches you.
 *
 * The credential rules are the DNS form's -- blank means "keep", deleting is
 * its own button -- because they are the server's rules rather than either
 * form's. What is different is that nothing here is required: an address with
 * no token is a notifier that has not been set up, which is a state the
 * dashboard runs perfectly well in.
 */

import { useState, type FormEvent } from 'react';
import type { AppSettingsView, UpdateAppSettingsInput } from '@dashboard/shared';
import { Save, Send } from 'lucide-react';

import { Button } from '../components/Button';
import { ErrorBanner } from '../components/Feedback';
import { Field, TextInput } from '../components/Form';
import { SecretField } from '../components/SecretField';
import { errorMessage } from '../api/client';
import { useSaveAppSettings, useTestNotification } from '../api/queries';
import { cn } from '../lib/cn';
import { formatDateTime } from '../lib/format';
import { useI18n, useT } from '../lib/i18n';

type FormState = {
  gotifyAddress: string;
  gotifyToken: string;
};

/** Secrets are never sent back, so the token starts blank on every load. */
function toFormState(settings: AppSettingsView): FormState {
  return { gotifyAddress: settings.gotifyAddress, gotifyToken: '' };
}

export function NotificationSettingsForm({ settings }: { settings: AppSettingsView }) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const save = useSaveAppSettings();
  const test = useTestNotification();
  const [state, setState] = useState<FormState>(() => toFormState(settings));
  const [notice, setNotice] = useState<string | null>(null);

  function patch(next: Partial<FormState>): void {
    setState((current) => ({ ...current, ...next }));
    setNotice(null);
  }

  /** Only a credential that says something is sent; blank means "keep". */
  function buildUpdate(extra: UpdateAppSettingsInput = {}): UpdateAppSettingsInput {
    const input: UpdateAppSettingsInput = { gotifyAddress: state.gotifyAddress, ...extra };
    if (state.gotifyToken !== '') input.gotifyToken = state.gotifyToken;
    return input;
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    setNotice(null);
    save.mutate(buildUpdate(), {
      onSuccess: () => {
        setNotice(t('settings.notifications.saved'));
        // Empty the box: the server holds the value now, and leaving it filled
        // would make the next save look like a change.
        setState((current) => ({ ...current, gotifyToken: '' }));
      },
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <NotificationState settings={settings} />

      <Field
        label={t('settings.notifications.addressLabel')}
        hint={t('settings.notifications.addressHint')}
      >
        {({ id }) => (
          <TextInput
            id={id}
            className="mono"
            value={state.gotifyAddress}
            placeholder={t('settings.notifications.addressPlaceholder')}
            onChange={(event) => patch({ gotifyAddress: event.target.value })}
          />
        )}
      </Field>

      <SecretField
        label={t('settings.notifications.tokenLabel')}
        hint={t('settings.notifications.tokenHint')}
        saved={settings.hasGotifyToken}
        value={state.gotifyToken}
        onChange={(value) => patch({ gotifyToken: value })}
        onClear={() =>
          save.mutate(buildUpdate({ clearGotifyToken: true }), {
            onSuccess: () => setNotice(t('settings.notifications.cleared')),
          })
        }
        pending={save.isPending}
      />

      {save.isError ? <ErrorBanner message={errorMessage(save.error, i18n)} /> : null}
      {test.isError ? <ErrorBanner message={errorMessage(test.error, i18n)} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          icon={<Save className="size-4" aria-hidden />}
          loading={save.isPending}
        >
          {t('common.save')}
        </Button>
        <Button
          icon={<Send className="size-4" aria-hidden />}
          loading={test.isPending}
          disabled={save.isPending}
          onClick={() =>
            test.mutate(
              { gotifyAddress: state.gotifyAddress, gotifyToken: state.gotifyToken },
              { onSuccess: () => setNotice(t('settings.notifications.testSent')) },
            )
          }
        >
          {t('settings.notifications.test')}
        </Button>
        <span className="text-faint text-meta">{t('settings.notifications.testHint')}</span>
      </div>

      <p className="text-faint text-meta">
        {settings.updatedAt === null
          ? t('settings.notifications.neverSaved')
          : t('settings.notifications.lastSaved', {
              when: formatDateTime(settings.updatedAt, locale),
            })}
      </p>

      {notice === null ? null : (
        <p role="status" className="text-ok text-meta">
          {notice}
        </p>
      )}
    </form>
  );
}

/**
 * Whether a notification would go out, said once and in one place.
 *
 * Derived from what is *stored* rather than from what is in the boxes: the
 * boxes describe a configuration nobody has saved yet, and reporting on that
 * would make an unsaved edit look like a working notifier.
 */
function NotificationState({ settings }: { settings: AppSettingsView }) {
  const t = useT();

  const state = settings.notificationsReady
    ? 'ready'
    : settings.updatedAt === null
      ? 'off'
      : 'incomplete';

  return (
    <div className="border-line bg-panel-2/40 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border px-4 py-3">
      <span
        className={cn(
          'mono text-micro rounded-full px-2.5 py-1 tracking-wider uppercase',
          state === 'ready' && 'text-ok bg-ok/12',
          state === 'incomplete' && 'text-warn bg-warn/12',
          state === 'off' && 'text-faint bg-panel-3',
        )}
      >
        {t(`settings.notifications.state.${state}`)}
      </span>
      <span className="text-mute text-meta">{t(`settings.notifications.stateHint.${state}`)}</span>
    </div>
  );
}
