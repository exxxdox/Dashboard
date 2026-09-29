import { useState } from 'react';
import { FileCode, RefreshCw, Save } from 'lucide-react';
import type { ScriptSummary } from '@dashboard/shared';
import { Button } from '../components/Button';
import { EmptyState, ErrorBanner, LoadingBlock } from '../components/Feedback';
import { Field, TextArea, TextInput } from '../components/Form';
import { MonoValue } from '../components/MonoValue';
import { Panel, Stat } from '../components/Panel';
import { useScript, useUpdateScript } from '../api/queries';
import { errorMessage } from '../api/client';
import { useI18n } from '../lib/i18n';
import { formatBytes, formatDateTime } from '../lib/format';
import { RunPanel } from './RunPanel';
import { ScriptSource } from './ScriptSource';

/**
 * Which script this is, and the one action that reloads it.
 *
 * It belongs in the page grid's first row rather than above the panels it
 * describes: sharing that row with the source picker is what keeps this column's
 * panels level with the tree beside them (see `ScriptsPage`).
 */
export function ScriptIdentityBar({
  script,
  loading,
  isFetching,
  onRefresh,
}: {
  script: ScriptSummary | null;
  /** No response yet for the script in the URL. */
  loading: boolean;
  isFetching: boolean;
  onRefresh: () => void;
}) {
  const i18n = useI18n();

  if (!script) {
    // A placeholder rather than nothing: an empty cell would collapse the first
    // row while the request is in flight, and the panels below would jump up.
    return (
      <div className="flex min-h-12 items-center" aria-busy={loading}>
        {loading ? <div className="bg-panel-3 h-6 w-52 animate-pulse rounded-md" /> : null}
      </div>
    );
  }

  return (
    // `min-h-12` is the height of the select across the gutter, so the two cells
    // read as one row rather than as two controls of different sizes.
    <div className="flex min-h-12 min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      <h2 className="text-ink text-brand truncate font-semibold tracking-tight">
        {script.displayName}
      </h2>
      <span className="border-line text-mute text-micro mono rounded-md border px-2 py-0.5 uppercase">
        {script.format}
      </span>
      {/* The directory, not the whole path: a display name defaults to the file
          name, so the full path printed the same word twice. The full path lives
          in the Facts panel below, where it is there to be copied. */}
      {script.relDir === '' ? null : (
        <span
          className="mono text-faint text-micro hidden min-w-0 truncate sm:block"
          title={script.relPath}
        >
          {script.relDir}/
        </span>
      )}
      <Button
        className="ml-auto"
        size="sm"
        icon={<RefreshCw className="size-4" aria-hidden />}
        loading={isFetching}
        onClick={onRefresh}
      >
        {i18n.t('scripts.refresh')}
      </Button>
    </div>
  );
}

export function ScriptDetail({ scriptId }: { scriptId: string }) {
  const i18n = useI18n();
  const script = useScript(scriptId);

  // Rendered inside the Scripts page's grid, so it brings no page frame and no
  // title of its own: both belong to the page, and `ScriptIdentityBar` carries
  // the identity that used to be repeated here.
  if (script.isError) {
    return (
      <ErrorBanner
        message={errorMessage(script.error, i18n)}
        onRetry={() => void script.refetch()}
      />
    );
  }

  if (!script.data) {
    return (
      <Panel>
        <LoadingBlock label={i18n.t('scripts.loadingScript')} />
      </Panel>
    );
  }

  const data = script.data;

  return (
    // Keyed off its own container, not the viewport: this pane sits beside the
    // script tree, so how much room it has depends on the tree's width far more
    // than on the window's. A `lg:` breakpoint here went two-column while the
    // pane was still ~360px wide and squashed the source panel.
    //
    // 720px is the narrowest split that still leaves the source panel wider than
    // the 360px run column beside it -- below that the two are the same width and
    // the code pane stops being the reason to have two columns at all.
    <div className="@container">
      <div className="grid gap-4 @min-[720px]:grid-cols-[minmax(0,1fr)_360px]">
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
