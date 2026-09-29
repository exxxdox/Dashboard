import { useState, type FormEvent } from 'react';
import { Plug, Save, X } from 'lucide-react';
import type { CreateTargetInput, TargetAuth, TargetSummary } from '@dashboard/shared';
import { Button } from '../components/Button';
import { ErrorBanner } from '../components/Feedback';
import { Field, Select, TextArea, TextInput } from '../components/Form';
import { useCreateTarget, useUpdateTarget } from '../api/queries';
import { errorMessage } from '../api/client';

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
        <Field label="Name" error={showErrors && missing.name ? 'Required' : null}>
          {({ id }) => (
            <TextInput
              id={id}
              value={state.name}
              placeholder="prod-01"
              onChange={(event) => patch({ name: event.target.value })}
            />
          )}
        </Field>
        <Field label="Username" error={showErrors && missing.username ? 'Required' : null}>
          {({ id }) => (
            <TextInput
              id={id}
              className="mono"
              value={state.username}
              placeholder="deploy"
              autoComplete="off"
              onChange={(event) => patch({ username: event.target.value })}
            />
          )}
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px]">
        <Field label="Host" error={showErrors && missing.host ? 'Required' : null}>
          {({ id }) => (
            <TextInput
              id={id}
              className="mono"
              value={state.host}
              placeholder="10.0.0.12 or host.example.com"
              onChange={(event) => patch({ host: event.target.value })}
            />
          )}
        </Field>
        <Field label="Port">
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
        label="Working directory on host"
        hint="Absolute path the script runs in. It does not need to match anything in this container: the script is uploaded to a temporary directory and simply run from here, so this only has to exist. Files it reads by relative path must already live there."
        error={showErrors && missing.workDir ? 'Required' : null}
      >
        {({ id }) => (
          <TextInput
            id={id}
            className="mono"
            value={state.workDir}
            placeholder="/srv/scripts"
            onChange={(event) => patch({ workDir: event.target.value })}
          />
        )}
      </Field>

      <Field label="Authentication">
        {({ id }) => (
          <Select
            id={id}
            value={state.authMethod}
            onChange={(event) => patch({ authMethod: event.target.value as AuthMethod })}
          >
            <option value="key">Private key</option>
            <option value="password">Password</option>
          </Select>
        )}
      </Field>

      {state.authMethod === 'key' ? (
        <>
          <Field
            label="Private key"
            hint={isEdit ? 'Leave blank to keep the stored key.' : 'PEM text, including the BEGIN/END lines.'}
            error={showErrors && missing.secret ? 'Required' : null}
          >
            {({ id }) => (
              <TextArea
                id={id}
                className="mono h-28"
                value={state.privateKey}
                spellCheck={false}
                autoComplete="off"
                placeholder={isEdit ? 'unchanged' : '-----BEGIN OPENSSH PRIVATE KEY-----'}
                onChange={(event) => patch({ privateKey: event.target.value })}
              />
            )}
          </Field>
          <Field label="Passphrase" hint="Only if the key is encrypted.">
            {({ id }) => (
              <TextInput
                id={id}
                type="password"
                value={state.passphrase}
                autoComplete="new-password"
                placeholder={isEdit ? 'unchanged' : ''}
                onChange={(event) => patch({ passphrase: event.target.value })}
              />
            )}
          </Field>
        </>
      ) : (
        <Field
          label="Password"
          hint={isEdit ? 'Leave blank to keep the stored password.' : undefined}
          error={showErrors && missing.secret ? 'Required' : null}
        >
          {({ id }) => (
            <TextInput
              id={id}
              type="password"
              value={state.password}
              autoComplete="new-password"
              placeholder={isEdit ? 'unchanged' : ''}
              onChange={(event) => patch({ password: event.target.value })}
            />
          )}
        </Field>
      )}

      <Field label="Connect timeout" hint="Seconds to wait for the SSH handshake.">
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

      {mutation.isError ? <ErrorBanner message={errorMessage(mutation.error)} /> : null}

      <div className="flex items-center gap-2">
        <Button
          type="submit"
          variant="primary"
          icon={isEdit ? <Save className="size-4" aria-hidden /> : <Plug className="size-4" aria-hidden />}
          loading={mutation.isPending}
        >
          {isEdit ? 'Save target' : 'Add target'}
        </Button>
        <Button variant="ghost" icon={<X className="size-4" aria-hidden />} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
