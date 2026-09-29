import { useState, type FormEvent } from 'react';
import { Plug, Save, X } from 'lucide-react';
import type { CreateTargetInput, TargetAuth, TargetSummary } from '@dashboard/shared';
import { Button } from '../components/Button';
import { ErrorBanner } from '../components/Feedback';
import { Field, Select, TextArea, TextInput } from '../components/Form';
import { useCreateTarget, useUpdateTarget } from '../api/queries';
import { errorMessage } from '../api/client';
import { useI18n } from '../lib/i18n';

type AuthMethod = 'key' | 'password';

type FormState = {
  name: string;
  host: string;
  port: string;
  username: string;
  authMethod: AuthMethod;
  privateKey: string;
  passphrase: string;
  password: string;
  workDir: string;
  connectTimeoutSec: string;
};

const EMPTY: FormState = {
  name: '',
  host: '',
  port: '22',
  username: '',
  authMethod: 'key',
  privateKey: '',
  passphrase: '',
  password: '',
  workDir: '',
  connectTimeoutSec: '15',
};

/** Stored secrets are never sent back, so an edit starts with empty auth fields. */
function toFormState(target: TargetSummary | null): FormState {
  if (!target) return EMPTY;
  return {
    ...EMPTY,
    name: target.name,
    host: target.host,
    port: String(target.port),
    username: target.username,
    authMethod: target.authMethod,
    workDir: target.workDir,
    connectTimeoutSec: String(target.connectTimeoutSec),
  };
}

export function TargetForm({
  target,
  onDone,
}: {
  /** Null creates; a target edits, replacing the secret only when one is typed. */
  target: TargetSummary | null;
  onDone: () => void;
}) {
  const i18n = useI18n();
  const create = useCreateTarget();
  const update = useUpdateTarget();
  const [state, setState] = useState<FormState>(() => toFormState(target));
  const [showErrors, setShowErrors] = useState(false);

  const isEdit = target !== null;
  const mutation = isEdit ? update : create;

  function patch(next: Partial<FormState>): void {
    setState((current) => ({ ...current, ...next }));
  }

  const missing = {
    name: state.name.trim() === '',
    host: state.host.trim() === '',
    username: state.username.trim() === '',
    workDir: state.workDir.trim() === '',
    // On an edit, an empty secret means "keep the stored one".
    secret: !isEdit && (state.authMethod === 'key' ? state.privateKey.trim() === '' : state.password === ''),
  };

  function buildAuth(): TargetAuth | null {
    if (state.authMethod === 'key') {
      if (state.privateKey.trim() === '') return null;
      return {
        method: 'key',
        privateKey: state.privateKey,
        ...(state.passphrase === '' ? {} : { passphrase: state.passphrase }),
      };
    }
    if (state.password === '') return null;
    return { method: 'password', password: state.password };
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    setShowErrors(true);
    if (Object.values(missing).some(Boolean)) return;

    const shared = {
      name: state.name.trim(),
      host: state.host.trim(),
      port: Number(state.port) || 22,
      username: state.username.trim(),
      workDir: state.workDir.trim(),
      connectTimeoutSec: Number(state.connectTimeoutSec) || 15,
    };

    if (isEdit) {
      const auth = buildAuth();
      update.mutate(
        { id: target.id, input: { ...shared, ...(auth === null ? {} : { auth }) } },
        { onSuccess: onDone },
      );
      return;
    }

    const auth = buildAuth();
    if (auth === null) return;
    create.mutate({ ...shared, auth } satisfies CreateTargetInput, { onSuccess: onDone });
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={i18n.t('targets.form.name')}
          error={showErrors && missing.name ? i18n.t('targets.form.required') : null}
        >
          {({ id }) => (
            <TextInput
              id={id}
              value={state.name}
              placeholder={i18n.t('targets.form.namePlaceholder')}
              onChange={(event) => patch({ name: event.target.value })}
            />
          )}
        </Field>
        <Field
          label={i18n.t('targets.form.username')}
          error={showErrors && missing.username ? i18n.t('targets.form.required') : null}
        >
          {({ id }) => (
            <TextInput
              id={id}
              className="mono"
              value={state.username}
              placeholder={i18n.t('targets.form.usernamePlaceholder')}
              autoComplete="off"
              onChange={(event) => patch({ username: event.target.value })}
            />
          )}
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px]">
        <Field
          label={i18n.t('targets.form.host')}
          error={showErrors && missing.host ? i18n.t('targets.form.required') : null}
        >
          {({ id }) => (
            <TextInput
              id={id}
              className="mono"
              value={state.host}
              placeholder={i18n.t('targets.form.hostPlaceholder')}
              onChange={(event) => patch({ host: event.target.value })}
            />
          )}
        </Field>
        <Field label={i18n.t('targets.form.port')}>
          {({ id }) => (
            <TextInput
              id={id}
              className="mono"
              type="number"
              min={1}
              max={65535}
              value={state.port}
              onChange={(event) => patch({ port: event.target.value })}
            />
          )}
        </Field>
      </div>

      <Field
        label={i18n.t('targets.form.workDir')}
        hint={i18n.t('targets.form.workDirHint')}
        error={showErrors && missing.workDir ? i18n.t('targets.form.required') : null}
      >
        {({ id }) => (
          <TextInput
            id={id}
            className="mono"
            value={state.workDir}
            placeholder={i18n.t('targets.form.workDirPlaceholder')}
            onChange={(event) => patch({ workDir: event.target.value })}
          />
        )}
      </Field>

      <Field label={i18n.t('targets.form.auth')}>
        {({ id }) => (
          <Select
            id={id}
            value={state.authMethod}
            onChange={(event) => patch({ authMethod: event.target.value as AuthMethod })}
          >
            <option value="key">{i18n.t('targets.form.privateKey')}</option>
            <option value="password">{i18n.t('targets.form.password')}</option>
          </Select>
        )}
      </Field>

      {state.authMethod === 'key' ? (
        <>
          <Field
            label={i18n.t('targets.form.privateKey')}
            hint={
              isEdit
                ? i18n.t('targets.form.privateKeyHintEdit')
                : i18n.t('targets.form.privateKeyHintNew')
            }
            error={showErrors && missing.secret ? i18n.t('targets.form.required') : null}
          >
            {({ id }) => (
              <TextArea
                id={id}
                className="mono h-28"
                value={state.privateKey}
                spellCheck={false}
                autoComplete="off"
                placeholder={
                  isEdit
                    ? i18n.t('targets.form.unchanged')
                    : i18n.t('targets.form.keyPlaceholder')
                }
                onChange={(event) => patch({ privateKey: event.target.value })}
              />
            )}
          </Field>
          <Field label={i18n.t('targets.form.passphrase')} hint={i18n.t('targets.form.passphraseHint')}>
            {({ id }) => (
              <TextInput
                id={id}
                type="password"
                value={state.passphrase}
                autoComplete="new-password"
                placeholder={isEdit ? i18n.t('targets.form.unchanged') : ''}
                onChange={(event) => patch({ passphrase: event.target.value })}
              />
            )}
          </Field>
        </>
      ) : (
        <Field
          label={i18n.t('targets.form.password')}
          hint={isEdit ? i18n.t('targets.form.passwordHintEdit') : undefined}
          error={showErrors && missing.secret ? i18n.t('targets.form.required') : null}
        >
          {({ id }) => (
            <TextInput
              id={id}
              type="password"
              value={state.password}
              autoComplete="new-password"
              placeholder={isEdit ? i18n.t('targets.form.unchanged') : ''}
              onChange={(event) => patch({ password: event.target.value })}
            />
          )}
        </Field>
      )}

      <Field
        label={i18n.t('targets.form.connectTimeout')}
        hint={i18n.t('targets.form.connectTimeoutHint')}
      >
        {({ id }) => (
          <TextInput
            id={id}
            className="mono w-28"
            type="number"
            min={1}
            max={120}
            value={state.connectTimeoutSec}
            onChange={(event) => patch({ connectTimeoutSec: event.target.value })}
          />
        )}
      </Field>

      {mutation.isError ? <ErrorBanner message={errorMessage(mutation.error, i18n)} /> : null}

      <div className="flex items-center gap-2">
        <Button
          type="submit"
          variant="primary"
          icon={isEdit ? <Save className="size-4" aria-hidden /> : <Plug className="size-4" aria-hidden />}
          loading={mutation.isPending}
        >
          {isEdit ? i18n.t('targets.form.save') : i18n.t('targets.add')}
        </Button>
        <Button variant="ghost" icon={<X className="size-4" aria-hidden />} onClick={onDone}>
          {i18n.t('targets.form.cancel')}
        </Button>
      </div>
    </form>
  );
}
