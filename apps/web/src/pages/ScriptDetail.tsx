import { useState } from 'react';
import { FileCode, RefreshCw, Save } from 'lucide-react';
import { Button } from '../components/Button';
import { EmptyState, ErrorBanner, LoadingBlock } from '../components/Feedback';
import { Field, TextArea, TextInput } from '../components/Form';
import { MonoValue } from '../components/MonoValue';
import { Panel, Stat } from '../components/Panel';
import { PageHeader } from '../components/PageHeader';
import { useScript, useUpdateScript } from '../api/queries';
import { errorMessage } from '../api/client';
import { useI18n } from '../lib/i18n';
import { formatBytes, formatDateTime } from '../lib/format';
import { RunPanel } from './RunPanel';
import { ScriptSource } from './ScriptSource';

export function ScriptDetail({ scriptId }: { scriptId: string }) {
  const i18n = useI18n();
  const script = useScript(scriptId);

  // Rendered inside the Scripts page's right-hand column, so no page frame here.
  if (script.isError) {
    return (
      <div>
        <PageHeader eyebrow={i18n.t('scripts.script')} title={i18n.t('scripts.script')} />
        <ErrorBanner
          className="mt-4"
          message={errorMessage(script.error, i18n)}
          onRetry={() => void script.refetch()}
        />
      </div>
    );
  }

  if (!script.data) {
    return (
      <div>
        <PageHeader eyebrow={i18n.t('scripts.script')} title={i18n.t('scripts.script')} />
        <Panel className="mt-4">
          <LoadingBlock label={i18n.t('scripts.loadingScript')} />
        </Panel>
      </div>
    );
  }

  const data = script.data;

  return (
    <div>
      <PageHeader
        eyebrow={i18n.t('scripts.script')}
        title={data.displayName}
        description={data.description ?? undefined}
        actions={
          <Button
            icon={<RefreshCw className="size-4" aria-hidden />}
            loading={script.isFetching}
            onClick={() => void script.refetch()}
          >
            {i18n.t('scripts.refresh')}
          </Button>
        }
      />

      {/* Keyed off its own container, not the viewport: this pane sits beside the
          script tree, so how much room it has depends on the tree's width far
          more than on the window's. A `lg:` breakpoint here went two-column
          while the pane was still ~360px wide and squashed the source panel. */}
      <div className="@container mt-5">
        <div className="grid gap-4 @min-[760px]:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid min-w-0 content-start gap-4">
            <Panel title={i18n.t('scripts.panel.source')}>
              {data.content === null ? (
                <EmptyState
                  icon={<FileCode className="size-5" aria-hidden />}
                  title={i18n.t('scripts.unreadable.title')}
                  description={i18n.t('scripts.unreadable.description')}
                />
              ) : (
                <ScriptSource content={data.content} format={data.format} />
              )}
            </Panel>

            <ScriptMetadataPanel scriptId={data.id} />
          </div>

          <div className="grid min-w-0 content-start gap-4">
            <Panel title={i18n.t('scripts.panel.run')}>
              <RunPanel key={data.id} script={data} />
            </Panel>

            <Panel title={i18n.t('scripts.panel.facts')}>
              <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                <Stat label={i18n.t('scripts.field.format')}>{data.format}</Stat>
                <Stat label={i18n.t('scripts.field.size')}>{formatBytes(data.sizeBytes)}</Stat>
                <Stat label={i18n.t('scripts.field.interpreter')}>
                  {data.interpreterOverride === null
                    ? i18n.t('scripts.auto')
                    : data.interpreterOverride.join(' ')}
                </Stat>
                <Stat label={i18n.t('scripts.field.timeout')}>
                  {data.timeoutSec === null ? i18n.t('common.notSet') : `${data.timeoutSec}s`}
                </Stat>
                <Stat label={i18n.t('scripts.field.sourcePath')} className="col-span-2">
                  <MonoValue value={data.relPath} wrap />
                </Stat>
                <Stat
                  label={i18n.t('scripts.field.discovered')}
                  className="col-span-2"
                  mono={false}
                >
                  {formatDateTime(data.discoveredAt, i18n.locale)}
                </Stat>
                <Stat label={i18n.t('scripts.field.contentHash')} className="col-span-2">
                  <MonoValue value={data.contentHash} wrap />
                </Stat>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Display name, description, timeout and interpreter override.
 *
 * The whole panel is a form: nothing is sent until Save, so a half-typed name
 * never reaches the server.
 */
function ScriptMetadataPanel({ scriptId }: { scriptId: string }) {
  const i18n = useI18n();
  const script = useScript(scriptId);
  const update = useUpdateScript();
  const data = script.data;

  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [timeout, setTimeoutSec] = useState('');
  const [interpreter, setInterpreter] = useState('');
  const [touched, setTouched] = useState(false);

  // The first successful load seeds the fields; later edits own them.
  const [seeded, setSeeded] = useState(false);
  if (data && !seeded) {
    setSeeded(true);
    setDisplayName(data.displayName);
    setDescription(data.description ?? '');
    setTimeoutSec(data.timeoutSec === null ? '' : String(data.timeoutSec));
    setInterpreter(data.interpreterOverride?.join(' ') ?? '');
  }

  if (!data) return null;

  function save(): void {
    if (!data) return;
    const trimmedInterpreter = interpreter.trim();
    update.mutate(
      {
        id: data.id,
        input: {
          displayName: displayName.trim() || data.displayName,
          description: description.trim() === '' ? null : description.trim(),
          timeoutSec: timeout.trim() === '' ? null : Number(timeout),
          // A shell-split string is the honest input: an override is argv, not one path.
          interpreterOverride: trimmedInterpreter === '' ? null : trimmedInterpreter.split(/\s+/),
        },
      },
      { onSuccess: () => setTouched(false) },
    );
  }

  return (
    <Panel
      title={i18n.t('scripts.panel.metadata')}
      aside={
        touched ? (
          <Button
            size="sm"
            variant="primary"
            icon={<Save className="size-4" aria-hidden />}
            loading={update.isPending}
            onClick={save}
          >
            {i18n.t('common.save')}
          </Button>
        ) : (
          <span className="text-faint text-micro">{i18n.t('scripts.noChanges')}</span>
        )
      }
    >
      <div className="grid gap-3">
        <Field label={i18n.t('scripts.field.displayName')}>
          {({ id }) => (
            <TextInput
              id={id}
              value={displayName}
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
              rows={2}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                setTouched(true);
              }}
            />
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
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

        {update.isError ? <ErrorBanner message={errorMessage(update.error, i18n)} /> : null}
      </div>
    </Panel>
  );
}
