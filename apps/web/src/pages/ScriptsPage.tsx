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
import { useSourceTree, useSources, useSyncSource } from '../api/queries';
import { navigate } from '../lib/router';
import { ScriptDetail } from './ScriptDetail';

export function ScriptsPage({ scriptId }: { scriptId: string | null }) {
  const sources = useSources();
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');

  // Land on the first source so the tree is never pointlessly empty.
  useEffect(() => {
    if (selectedSourceId !== '') return;
    const first = sources.data?.[0];
    if (first) setSelectedSourceId(first.id);
  }, [sources.data, selectedSourceId]);

  const activeSource: SourceSummary | undefined = sources.data?.find(
    (source) => source.id === selectedSourceId,
  );

  return (
    <PageBody wide>
      <PageHeader
        eyebrow="Library"
        title="Scripts"
        description="Every script the dashboard has discovered, grouped by the source it came from."
      />

      {sources.isError ? (
        <ErrorBanner
          className="mt-5"
          message={sources.error.message}
          onRetry={() => void sources.refetch()}
        />
      ) : null}

      {sources.isPending ? (
        <Panel className="mt-5">
          <LoadingBlock label="Loading sources…" />
        </Panel>
      ) : (sources.data ?? []).length === 0 ? (
        <div className="mt-5">
          <EmptyState
            icon={<FolderTree className="size-5" aria-hidden />}
            title="No sources configured"
            description="A source is a directory of scripts — either a folder already shared with the container, or a GitHub repository to sync. Scripts appear here as soon as one exists."
            action={
              <Button variant="primary" onClick={() => navigate('/sources')}>
                Add a source
              </Button>
            }
          />
        </div>
      ) : (
        // The tree column is sized by the longest path the font can render, not
        // by a round number: at the current type scale 300px clipped ordinary
        // names like `deploy/api.sh` once they sat a couple of levels deep.
        <div className="mt-5 grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
          <div className="grid min-w-0 content-start gap-3">
            <Select
              aria-label="Source"
              value={selectedSourceId}
              onChange={(event) => setSelectedSourceId(event.target.value)}
            >
              {(sources.data ?? []).map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name} ({source.scriptCount})
                </option>
              ))}
            </Select>

            {activeSource ? (
              <div className="flex items-center justify-between gap-2 px-0.5">
                <SyncStatusLabel status={activeSource.syncStatus} />
                <SourceSyncButton sourceId={activeSource.id} />
              </div>
            ) : null}

            <SourceTreePane
              sourceId={selectedSourceId}
              scriptId={scriptId}
              onSelect={(node) => {
                const script = node.script;
                if (script) navigate(`/scripts/${encodeURIComponent(script.id)}`);
              }}
            />
          </div>

          <div className="min-w-0">
            {scriptId === null ? (
              <EmptyState
                icon={<FileCode className="size-5" aria-hidden />}
                title="No script selected"
                description="Pick a script from the tree to see its parameters, its source, and the form that runs it."
              />
            ) : (
              <ScriptDetail scriptId={scriptId} />
            )}
          </div>
        </div>
      )}
    </PageBody>
  );
}

function SourceSyncButton({ sourceId }: { sourceId: string }) {
  const sync = useSyncSource();
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={<RefreshCw className="size-4" aria-hidden />}
      loading={sync.isPending}
      onClick={() => sync.mutate(sourceId)}
    >
      Sync
    </Button>
  );
}

function SourceTreePane({
  sourceId,
  scriptId,
  onSelect,
}: {
  sourceId: string;
  scriptId: string | null;
  onSelect: (node: ScriptTreeNode) => void;
}) {
  const tree = useSourceTree(sourceId, sourceId !== '');

  if (sourceId === '') {
    return (
      <Panel>
        <p className="text-mute text-body">Choose a source to see its scripts.</p>
      </Panel>
    );
  }

  return (
    <Panel
      flush
      bodyClassName="p-1.5"
      aside={
        tree.data ? (
          <span className="mono text-faint text-micro">{countFiles(tree.data)} files</span>
        ) : null
      }
    >
      {tree.isPending ? (
        <LoadingBlock label="Loading tree…" />
      ) : tree.isError ? (
        <div className="p-1.5">
          <ErrorBanner message={tree.error.message} onRetry={() => void tree.refetch()} />
        </div>
      ) : tree.data ? (
        <div className="max-h-[calc(100vh-320px)] overflow-auto">
          <ScriptTree root={tree.data} selectedId={scriptId} onSelect={onSelect} />
        </div>
      ) : null}
    </Panel>
  );
}

function countFiles(node: ScriptTreeNode): number {
  if (node.type === 'file') return 1;
  return (node.children ?? []).reduce((total, child) => total + countFiles(child), 0);
}
