import { useState, type FormEvent } from 'react';
import { FolderTree, Plus, Save, X } from 'lucide-react';
import type {
  CreateSourceInput,
  SourceKind,
  SourceSummary,
  UpdateSourceInput,
} from '@dashboard/shared';
import { Button } from '../components/Button';
import { Field, Select, TextInput } from '../components/Form';
import { useCreateSource, useUpdateSource } from '../api/queries';
import { useI18n, type Translate } from '../lib/i18n';

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

function kindLabel(kind: SourceKind, t: Translate): string {
  return kind === 'github'
    ? t('sources.form.githubRepository')
    : t('sources.form.localDirectory');
}

export function SourceForm({
  source,
  onDone,
}: {
  /** Null creates; a source edits in place. Its kind is fixed. */
  source: SourceSummary | null;
  onDone: () => void;
}) {
  const i18n = useI18n();
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
        <Field
          label={i18n.t('sources.form.name')}
          error={showErrors && missing.name ? i18n.t('sources.form.required') : null}
        >
          {({ id }) => (
            <TextInput
              id={id}
              value={state.name}
              placeholder={i18n.t('sources.form.namePlaceholder')}
              onChange={(event) => patch({ name: event.target.value })}
            />
          )}
        </Field>
        <Field
          label={i18n.t('sources.form.kind')}
          hint={
            isEdit
              ? i18n.t('sources.form.kindHintEdit')
              : state.kind === 'github'
                ? i18n.t('sources.form.kindHintGithub')
                : i18n.t('sources.form.kindHintLocal')
          }
        >
          {({ id }) =>
            isEdit ? (
              // Changing the kind would move the checkout, orphan the files and
              // strand every script path recorded against this source.
              <TextInput id={id} value={kindLabel(state.kind, i18n.t)} disabled />
            ) : (
              <Select
                id={id}
                value={state.kind}
                onChange={(event) => patch({ kind: event.target.value as SourceKind })}
              >
                <option value="local">{i18n.t('sources.form.localDirectory')}</option>
                <option value="github">{i18n.t('sources.form.githubRepository')}</option>
              </Select>
            )
          }
        </Field>
      </div>

      {state.kind === 'github' ? (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
          <Field
            label={i18n.t('sources.form.repoUrl')}
            error={showErrors && missing.repoUrl ? i18n.t('sources.form.required') : null}
          >
            {({ id }) => (
              <TextInput
                id={id}
                className="mono"
                value={state.repoUrl}
                placeholder={i18n.t('sources.form.repoUrlPlaceholder')}
                onChange={(event) => patch({ repoUrl: event.target.value })}
              />
            )}
          </Field>
          <Field label={i18n.t('sources.form.branch')} hint={i18n.t('sources.form.branchHint')}>
            {({ id }) => (
              <TextInput
                id={id}
                className="mono"
                value={state.branch}
                placeholder={i18n.t('sources.form.branchPlaceholder')}
                onChange={(event) => patch({ branch: event.target.value })}
              />
            )}
          </Field>
        </div>
      ) : null}

      <Field
        label={
          state.kind === 'github'
            ? i18n.t('sources.form.subdirectory')
            : i18n.t('sources.form.directory')
        }
        hint={
          state.kind === 'github'
            ? i18n.t('sources.form.subPathHintGithub')
            : i18n.t('sources.form.subPathHintLocal')
        }
        error={showErrors && missing.subPath ? i18n.t('sources.form.required') : null}
      >
        {({ id }) => (
          <TextInput
            id={id}
            className="mono"
            value={state.subPath}
            placeholder={
              state.kind === 'github'
                ? i18n.t('sources.form.subPathPlaceholderGithub')
                : i18n.t('sources.form.subPathPlaceholderLocal')
            }
            onChange={(event) => patch({ subPath: event.target.value })}
          />
        )}
      </Field>

      {state.kind === 'local' ? (
        <p className="text-faint text-meta flex items-start gap-2">
          <FolderTree className="mt-0.5 size-4 shrink-0" aria-hidden />
          {i18n.t('sources.form.localNote')}
        </p>
      ) : null}

      {isEdit ? (
        <p className="text-mute text-meta">
          {i18n.t('sources.form.editNote.before')}{' '}
          <span className="text-ink">{i18n.t('sources.neverSynced')}</span>{' '}
          {i18n.t('sources.form.editNote.after')}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          type="submit"
          variant="primary"
          icon={
            isEdit ? <Save className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />
          }
          loading={mutation.isPending}
        >
          {isEdit ? i18n.t('sources.form.save') : i18n.t('sources.add')}
        </Button>
        <Button variant="ghost" icon={<X className="size-4" aria-hidden />} onClick={onDone}>
          {i18n.t('sources.form.cancel')}
        </Button>
      </div>
    </form>
  );
}
