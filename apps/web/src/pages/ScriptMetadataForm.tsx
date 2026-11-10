import { useState } from 'react';
import { Save } from 'lucide-react';
import type { ScriptSummary } from '@dashboard/shared';
import { Button } from '../components/Button';
import { Field, TextArea, TextInput } from '../components/Form';
import { useSources, useUpdateScript } from '../api/queries';
import { useI18n } from '../lib/i18n';

/**
 * Local filename or GitHub display name, plus execution metadata.
 *
 * The whole thing is a form: nothing is sent until Save, so a half-typed name
 * never reaches the server. It draws no frame of its own, because the dialog it
 * lives in already provides one -- and a panel header inside a dialog header
 * would name the same thing twice.
 */
export function ScriptMetadataForm({ script }: { script: ScriptSummary }) {
  const i18n = useI18n();
  const update = useUpdateScript();
  const sources = useSources();
  const local = sources.data?.find((source) => source.id === script.sourceId)?.kind === 'local';

  const [displayName, setDisplayName] = useState<string | null>(null);
  const [description, setDescription] = useState(script.description ?? '');
  const [timeout, setTimeoutSec] = useState(
    script.timeoutSec === null ? '' : String(script.timeoutSec),
  );
  const [interpreter, setInterpreter] = useState(script.interpreterOverride?.join(' ') ?? '');
  const [touched, setTouched] = useState(false);

  function save(): void {
    const trimmedInterpreter = interpreter.trim();
    update.mutate(
      {
        id: script.id,
        input: {
          displayName: (displayName ?? '').trim() || (local ? script.fileName : script.displayName),
          description: description.trim() === '' ? null : description.trim(),
          timeoutSec: timeout.trim() === '' ? null : Number(timeout),
          // A shell-split string is the honest input: an override is argv, not one path.
          interpreterOverride: trimmedInterpreter === '' ? null : trimmedInterpreter.split(/\s+/),
        },
      },
      { onSuccess: (saved) => {
        setDisplayName(local ? saved.fileName : saved.displayName);
        setTouched(false);
      } },
    );
  }

  return (
    <div className="grid gap-4">
      <Field label={i18n.t(local ? 'scripts.file.name' : 'scripts.field.displayName')} hint={local ? i18n.t('scripts.file.renameHint') : undefined}>
        {({ id }) => (
          <TextInput
            id={id}
            value={displayName ?? (local ? script.fileName : script.displayName)}
            onChange={(event) => {
              setDisplayName(event.target.value);
              setTouched(true);
            }}
          />
        )}
      </Field>

      <Field label={i18n.t('scripts.field.description')}>
        {({ id }) => (
          <TextArea
            id={id}
            rows={3}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              setTouched(true);
            }}
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={i18n.t('scripts.field.timeoutSec')}>
          {({ id }) => (
            <TextInput
              id={id}
              type="number"
              min={1}
              max={86_400}
              className="mono"
              value={timeout}
              placeholder={i18n.t('common.notSet')}
              onChange={(event) => {
                setTimeoutSec(event.target.value);
                setTouched(true);
              }}
            />
          )}
        </Field>
        <Field
          label={i18n.t('scripts.field.interpreter')}
          hint={i18n.t('scripts.field.interpreterHint')}
        >
          {({ id }) => (
            <TextInput
              id={id}
              className="mono"
              value={interpreter}
              placeholder={i18n.t('scripts.auto')}
              onChange={(event) => {
                setInterpreter(event.target.value);
                setTouched(true);
              }}
            />
          )}
        </Field>
      </div>

      {/* The hint sits beside the button rather than in the dialog header: it is
          about this form's state, and the header is about what the dialog is. */}
      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          icon={<Save className="size-4" aria-hidden />}
          disabled={!touched}
          loading={update.isPending}
          onClick={save}
        >
          {i18n.t('common.save')}
        </Button>
        <span className="text-faint text-meta">
          {touched ? i18n.t('scripts.unsavedChanges') : i18n.t('scripts.noChanges')}
        </span>
      </div>
    </div>
  );
}
