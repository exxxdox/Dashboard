import { useState } from 'react';
import { FileCode, Info, RefreshCw, SlidersHorizontal, Terminal } from 'lucide-react';
import type { ScriptSummary } from '@dashboard/shared';
import { Button } from '../components/Button';
import { EmptyState, ErrorBanner, LoadingBlock } from '../components/Feedback';
import { Panel } from '../components/Panel';
import { useScript } from '../api/queries';
import { errorMessage } from '../api/client';
import { useI18n } from '../lib/i18n';
import { RunNowButton } from './RunNowButton';
import { ScriptDialogs, type ScriptDialog } from './ScriptDialogs';
import { ScriptSource } from './ScriptSource';

/**
 * Which script this is, and everything that acts on it.
 *
 * It belongs in the page grid's first row rather than above the panels it
 * describes: sharing that row with the source picker is what keeps this column's
 * panels level with the tree beside them (see `ScriptsPage`). That row is also
 * where the actions went, because the source below it is the one thing on this
 * page that has to stay in the reading position -- facts, metadata and the run
 * form open over it instead of sharing it.
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
  const [dialog, setDialog] = useState<ScriptDialog | null>(null);

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
    <>
      {/* `min-h-12` is the height of the select across the gutter, so the two
          cells read as one row rather than as two controls of different sizes. */}
      <div className="flex min-h-12 min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-ink text-brand truncate font-semibold tracking-tight">
          {script.displayName}
        </h2>
        <span className="border-line text-mute text-micro mono rounded-md border px-2 py-0.5 uppercase">
          {script.format}
        </span>
        {/* The directory, not the whole path: a display name defaults to the file
            name, so the full path printed the same word twice. The full path
            lives in the facts dialog, where it is there to be copied. */}
        {script.relDir === '' ? null : (
          <span
            className="mono text-faint text-micro hidden min-w-0 truncate sm:block"
            title={script.relPath}
          >
            {script.relDir}/
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            icon={<Info className="size-4" aria-hidden />}
            onClick={() => setDialog('facts')}
          >
            {i18n.t('scripts.panel.facts')}
          </Button>
          <Button
            size="sm"
            icon={<SlidersHorizontal className="size-4" aria-hidden />}
            onClick={() => setDialog('metadata')}
          >
            {i18n.t('scripts.panel.metadata')}
          </Button>
          <Button
            size="sm"
            icon={<Terminal className="size-4" aria-hidden />}
            onClick={() => setDialog('run')}
          >
            {i18n.t('scripts.panel.run')}
          </Button>

          <RunNowButton script={script} onNeedSettings={() => setDialog('run')} />

          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className="size-4" aria-hidden />}
            loading={isFetching}
            onClick={onRefresh}
          >
            {i18n.t('scripts.refresh')}
          </Button>
        </div>
      </div>

      <ScriptDialogs script={script} open={dialog} onClose={() => setDialog(null)} />
    </>
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
      <ErrorBanner message={errorMessage(script.error, i18n)} onRetry={() => void script.refetch()} />
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

  // One panel, the full width of the column. It used to share a 360px column
  // with the run form and the facts, which is what made the code pane the
  // narrowest thing on a page whose subject is the code.
  return (
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
  );
}
