import { useState, type FormEvent } from 'react';
import { FolderTree, Plus, Save, X } from 'lucide-react';
import type {
  CreateSourceInput,
  SourceKind,
  SourceSummary,
  UpdateSourceInput,
} from '@script-dashboard/shared';
import { Button } from '../components/Button';
import { ErrorBanner } from '../components/Feedback';
import { Field, Select, TextInput } from '../components/Form';
import { useCreateSource, useUpdateSource } from '../api/queries';
import { errorMessage } from '../api/client';

type FormState = {
  name: string;
  kind: SourceKind;
  repoUrl: string;
  branch: string;
  subPath: string;
};

const EMPTY: FormState = { name: '', kind: 'local', repoUrl: '', branch: '', subPath: '' };

/** An edit starts from what the source already is. */
function toFormState(source: SourceSummary | null): FormState {
  if (!source) return EMPTY;
  return {
    name: source.name,
    kind: source.kind,
    repoUrl: source.repoUrl ?? '',
    branch: source.branch ?? '',
    subPath: source.subPath ?? '',
  };
}

function kindLabel(kind: SourceKind): string {
  return kind === 'github' ? 'GitHub repository' : 'Local directory';
}

export function SourceForm({
  source,
  onDone,
}: {
  /** Null creates; a source edits in place. Its kind is fixed. */
  source: SourceSummary | null;
  onDone: () => void;
}) {
  const create = useCreateSource();
  const update = useUpdateSource();
  const [state, setState] = useState<FormState>(() => toFormState(source));
  const [showErrors, setShowErrors] = useState(false);

  const isEdit = source !== null;
  const mutation = isEdit ? update : create;

  function patch(next: Partial<FormState>): void {
    setState((current) => ({ ...current, ...next }));
  }

  const missing = {
    name: state.name.trim() === '',
    repoUrl: state.kind === 'github' && state.repoUrl.trim() === '',
    // A local source with no sub-path would import everything shared. For a
    // GitHub source a blank value is meaningful: it means the repository root.
    subPath: state.kind === 'local' && state.subPath.trim() === '',
  };

  function submit(event: FormEvent): void {
    event.preventDefault();
    setShowErrors(true);
    if (Object.values(missing).some(Boolean)) return;

    const name = state.name.trim();
    const repoUrl = state.repoUrl.trim();
    const branch = state.branch.trim();
    const subPath = state.subPath.trim();

    if (source) {
      // Empty branch or sub-path is sent as null, which is how the API is told
      // to go back to the repository default rather than keep the old value.
      const input: UpdateSourceInput =
        source.kind === 'github'
          ? {
              name,
              repoUrl,
              branch: branch === '' ? null : branch,
              subPath: subPath === '' ? null : subPath,
            }
          : { name, subPath };

      update.mutate({ id: source.id, input }, { onSuccess: onDone });
      return;
    }

    const input: CreateSourceInput =
      state.kind === 'github'
        ? {
            name,
            kind: 'github',
            repoUrl,
            ...(branch === '' ? {} : { branch }),
            ...(subPath === '' ? {} : { subPath }),
          }
        : { name, kind: 'local', subPath };

    create.mutate(input, { onSuccess: onDone });
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
        <Field label="Name" error={showErrors && missing.name ? 'Required' : null}>
          {({ id }) => (
            <TextInput
              id={id}
              value={state.name}
              placeholder="ops-scripts"
              onChange={(event) => patch({ name: event.target.value })}
            />
          )}
        </Field>
        <Field
          label="Kind"
          hint={
            isEdit
              ? 'Fixed: it decides where the files live.'
              : state.kind === 'github'
                ? 'Cloned and refreshed on sync.'
                : 'Already on this machine.'
          }
        >
          {({ id }) =>
            isEdit ? (
              // Changing the kind would move the checkout, orphan the files and
              // strand every script path recorded against this source.
              <TextInput id={id} value={kindLabel(state.kind)} disabled />
            ) : (
              <Select
                id={id}
                value={state.kind}
                onChange={(event) => patch({ kind: event.target.value as SourceKind })}
              >
                <option value="local">Local directory</option>
                <option value="github">GitHub repository</option>
              </Select>
            )
          }
        </Field>
      </div>

      {state.kind === 'github' ? (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
          <Field label="Repository URL" error={showErrors && missing.repoUrl ? 'Required' : null}>
            {({ id }) => (
              <TextInput
                id={id}
                className="mono"
                value={state.repoUrl}
                placeholder="https://github.com/acme/ops"
                onChange={(event) => patch({ repoUrl: event.target.value })}
              />
            )}
          </Field>
          <Field label="Branch" hint="Blank uses the default branch.">
            {({ id }) => (
              <TextInput
                id={id}
                className="mono"
                value={state.branch}
                placeholder="main"
                onChange={(event) => patch({ branch: event.target.value })}
              />
            )}
          </Field>
        </div>
      ) : null}

      <Field
        label={state.kind === 'github' ? 'Subdirectory' : 'Directory'}
        hint={
          state.kind === 'github'
            ? 'Path inside the repository to treat as the script root. Blank uses the repository root.'
            : 'Directory inside the shared mount that holds the scripts, relative to the mount root.'
        }
        error={showErrors && missing.subPath ? 'Required' : null}
      >
        {({ id }) => (
          <TextInput
            id={id}
            className="mono"
            value={state.subPath}
            placeholder={state.kind === 'github' ? 'scripts' : 'ops-scripts'}
            onChange={(event) => patch({ subPath: event.target.value })}
          />
        )}
      </Field>

      {state.kind === 'local' ? (
        <p className="text-faint text-meta flex items-start gap-2">
          <FolderTree className="mt-0.5 size-4 shrink-0" aria-hidden />
          The directory must already exist inside the shared mount. Git-backed directories are
          browsable from the source list once created.
        </p>
      ) : null}

      {isEdit ? (
        <p className="text-mute text-meta">
          Changing the repository, branch or directory leaves what was already scanned behind, so the
          source goes back to <span className="text-ink">Never synced</span> until you sync it again.
        </p>
      ) : null}

      {mutation.isError ? <ErrorBanner message={errorMessage(mutation.error)} /> : null}

      <div className="flex items-center gap-2">
        <Button
          type="submit"
          variant="primary"
          icon={
            isEdit ? <Save className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />
          }
          loading={mutation.isPending}
        >
          {isEdit ? 'Save source' : 'Add source'}
        </Button>
        <Button variant="ghost" icon={<X className="size-4" aria-hidden />} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
