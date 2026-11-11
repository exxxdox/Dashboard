import { useEffect, useState } from 'react';
import { FileCode, FolderTree, RefreshCw } from 'lucide-react';
import type { ScriptTreeNode, SourceSummary } from '@dashboard/shared';
import { PageBody } from '../components/AppShell';
import { PageHeader } from '../components/PageHeader';
import { Panel } from '../components/Panel';
import { Button } from '../components/Button';
import { EmptyState, ErrorBanner, LoadingBlock } from '../components/Feedback';
import { Select } from '../components/Form';
import { ScriptTree } from '../components/ScriptTree';
import { SyncStatusLabel } from '../components/StatusDot';
import { useScript, useSourceTree, useSources, useSyncSource } from '../api/queries';
import { errorMessage } from '../api/client';
import { useI18n, useT } from '../lib/i18n';
import { navigate } from '../lib/router';
import { readScriptSource, saveScriptSource } from '../lib/script-browser';
import { ScriptDetail, ScriptIdentityBar } from './ScriptDetail';
import { CreateScriptButton } from './ScriptFileEditor';

export function ScriptsPage({ scriptId }: { scriptId: string | null }) {
  const i18n = useI18n();
  const sources = useSources();
  const [chosenSourceId, setChosenSourceId] = useState<string>('');
  const [rememberedSourceId] = useState(readScriptSource);
  // The same query key the detail pane asks for, so react-query answers both from
  // one request. It is read here because the script's identity has to sit in the
  // grid's *first* row, beside the source picker -- see the grid comment below.
  const script = useScript(scriptId);

  // A linked script takes priority over browser memory; deleted sources fall back to an available one.
  const selectedSourceId = [chosenSourceId, script.data?.sourceId, rememberedSourceId]
    .find((id) => sources.data?.some((source) => source.id === id)) ?? sources.data?.[0]?.id ?? '';

  useEffect(() => {
    if (selectedSourceId) saveScriptSource(selectedSourceId);
  }, [selectedSourceId]);

  const activeSource: SourceSummary | undefined = sources.data?.find(
    (source) => source.id === selectedSourceId,
  );

  return (
    <PageBody wide>
      <PageHeader
        eyebrow={i18n.t('scripts.eyebrow')}
        title={i18n.t('nav.scripts')}
        description={i18n.t('scripts.description')}
      />

      {sources.isError ? (
        <ErrorBanner
          className="mt-5"
          message={errorMessage(sources.error, i18n)}
          onRetry={() => void sources.refetch()}
        />
      ) : null}

      {sources.isPending ? (
        <Panel className="mt-5">
          <LoadingBlock label={i18n.t('scripts.loadingSources')} />
        </Panel>
      ) : (sources.data ?? []).length === 0 ? (
        <div className="mt-5">
          <EmptyState
            icon={<FolderTree className="size-5" aria-hidden />}
            title={i18n.t('scripts.noSources.title')}
            description={i18n.t('scripts.noSources.description')}
            action={
              <Button variant="primary" onClick={() => navigate('/sources')}>
                {i18n.t('scripts.addSource')}
              </Button>
            }
          />
        </div>
      ) : (
        // Two columns, four cells: the source picker and the selected script's
        // identity share the first row. That is what makes the panels below start
        // at the same height -- letting the detail column carry a title block of
        // its own made the right column start ~25px lower than the tree, because
        // a title block is taller than a select. Below `xl` the columns stack,
        // which also hands the detail the full width its own source/run split
        // needs rather than the ~350px a second column left it at 1024px.
        <div className="mt-5 grid items-start gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
          <Select
            aria-label={i18n.t('scripts.source')}
            // While the columns are stacked this is the only thing in its row, and
            // a select stretched the full width of a laptop reads as a band rather
            // than a control. At `xl` the column is narrower than the cap anyway.
            className="max-w-[420px] xl:max-w-none"
            value={selectedSourceId}
            onChange={(event) => setChosenSourceId(event.target.value)}
          >
            {(sources.data ?? []).map((source) => (
              <option key={source.id} value={source.id}>
                {source.name} ({source.scriptCount})
              </option>
            ))}
          </Select>

          <ScriptIdentityBar
            script={script.data ?? null}
            isFetching={script.isFetching}
            loading={scriptId !== null && script.isPending}
            onRefresh={() => void script.refetch()}
          />

          <SourceTreePane
            source={activeSource}
            scriptId={scriptId}
            onSelect={(node) => {
              const selected = node.script;
              if (selected) navigate(`/scripts/${encodeURIComponent(selected.id)}`);
            }}
          />

          <div className="min-w-0">
            {scriptId === null ? (
              <EmptyState
                icon={<FileCode className="size-5" aria-hidden />}
                title={i18n.t('scripts.noSelection.title')}
                description={i18n.t('scripts.noSelection.description')}
              />
            ) : (
              <ScriptDetail key={scriptId} scriptId={scriptId} />
            )}
          </div>
        </div>
      )}
    </PageBody>
  );
}

function SourceSyncButton({ source }: { source: SourceSummary }) {
  const t = useT();
  const sync = useSyncSource();
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={<RefreshCw className="size-4" aria-hidden />}
      loading={sync.isPending}
      onClick={() => sync.mutate(source.id)}
    >
      {t(source.kind === 'local' ? 'sources.rescan' : 'scripts.sync')}
    </Button>
  );
}

function SourceTreePane({
  source,
  scriptId,
  onSelect,
}: {
  source: SourceSummary | undefined;
  scriptId: string | null;
  onSelect: (node: ScriptTreeNode) => void;
}) {
  const i18n = useI18n();
  const sourceId = source?.id ?? '';
  const tree = useSourceTree(sourceId === '' ? null : sourceId);

  if (!source) {
    return (
      <Panel className="min-w-0">
        <p className="text-mute text-body">{i18n.t('scripts.chooseSource')}</p>
      </Panel>
    );
  }

  return (
    <Panel
      // Stacked, the tree spans the page and its rows run the full width -- names
      // at one edge, child counts at the other, with a laptop screen between them.
      // The cap keeps a row a row; at `xl` the column is narrower than it anyway.
      className="min-w-0 max-w-[520px] xl:max-w-none"
      flush
      title={source.name}
      // The sync state, and the button that changes it, belong to the source, so
      // they live in the panel's own header. As a row of their own above the
      // panel they pushed the tree out of line with the detail column. No file
      // count here: the picker above already says "(4)", and every directory row
      // carries its own.
      aside={
        <div className="flex flex-wrap items-center gap-3">
          <SyncStatusLabel status={source.syncStatus} sourceKind={source.kind} />
          {source.kind === 'local' ? <CreateScriptButton key={source.id} sourceId={source.id} /> : null}
          <SourceSyncButton source={source} />
        </div>
      }
    >
      {source.kind === 'local' ? (
        <p className="text-mute text-meta px-5 py-2">{i18n.t('sources.localScanHint')}</p>
      ) : null}
      {tree.isPending ? (
        <LoadingBlock label={i18n.t('scripts.loadingTree')} />
      ) : tree.isError ? (
        <div className="p-1.5">
          <ErrorBanner
            message={errorMessage(tree.error, i18n)}
            onRetry={() => void tree.refetch()}
          />
        </div>
      ) : tree.data ? (
        <div className="max-h-[calc(100vh-320px)] overflow-auto">
          <ScriptTree key={sourceId} sourceId={sourceId} root={tree.data} selectedId={scriptId} onSelect={onSelect} />
        </div>
      ) : null}
    </Panel>
  );
}
