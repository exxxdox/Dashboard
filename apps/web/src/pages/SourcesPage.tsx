import { useState } from 'react';
import { FolderGit2, FolderTree, Pencil, Plus, RefreshCw, Trash } from 'lucide-react';
import type { SourceSummary, SyncResult } from '@script-dashboard/shared';
import { PageBody } from '../components/AppShell';
import { PageHeader } from '../components/PageHeader';
import { Panel } from '../components/Panel';
import { Button, IconButton } from '../components/Button';
import { EmptyState, ErrorBanner, LoadingRows } from '../components/Feedback';
import { MonoValue } from '../components/MonoValue';
import { SyncStatusLabel } from '../components/StatusDot';
import { useDeleteSource, useSources, useSyncSource } from '../api/queries';
import { formatDateTime, formatRelative } from '../lib/format';
import { navigate } from '../lib/router';
import { SourceForm } from './SourceForm';

export function SourcesPage() {
  const sources = useSources();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SourceSummary | null>(null);
  const list = sources.data ?? [];
  const showForm = creating || editing !== null;

  function closeForm(): void {
    setCreating(false);
    setEditing(null);
  }

  return (
    <PageBody>
      <PageHeader
        eyebrow="Library"
        title="Sources"
        description="Where scripts come from: a directory already shared with this container, or a GitHub repository kept in sync."
        actions={
          showForm ? null : (
            <Button
              variant="primary"
              icon={<Plus className="size-4" aria-hidden />}
              onClick={() => {
                setEditing(null);
                setCreating(true);
              }}
            >
              Add source
            </Button>
          )
        }
      />

      {showForm ? (
        <Panel className="mt-5" title={editing ? `Edit ${editing.name}` : 'New source'}>
          {/* Keyed so switching rows reseeds the fields instead of editing the
              previous source's values. */}
          <SourceForm key={editing?.id ?? 'new'} source={editing} onDone={closeForm} />
        </Panel>
      ) : null}

      {sources.isError ? (
        <ErrorBanner
          className="mt-5"
          message={sources.error.message}
          onRetry={() => void sources.refetch()}
        />
      ) : null}

      <Panel className="mt-5" flush>
        {sources.isPending ? (
          <LoadingRows rows={3} />
        ) : list.length === 0 ? (
          <div className="p-3">
            <EmptyState
              icon={<FolderTree className="size-5" aria-hidden />}
              title="No sources yet"
              description="Point the dashboard at a directory of scripts. Local directories are scanned in place; repositories are cloned and refreshed on demand."
              action={
                <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                  Add source
                </Button>
              }
            />
          </div>
        ) : (
          <ul className="divide-line divide-y">
            {list.map((source) => (
              <li key={source.id}>
                <SourceRow
                  source={source}
                  onEdit={() => {
                    setCreating(false);
                    setEditing(source);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </PageBody>
  );
}

function SourceRow({ source, onEdit }: { source: SourceSummary; onEdit: () => void }) {
  const sync = useSyncSource();
  const remove = useDeleteSource();
  // Kept per row so the last sync's counts stay visible after the toast-less
  // mutation settles.
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);

  const Icon = source.kind === 'github' ? FolderGit2 : FolderTree;

  return (
    <div className="grid gap-3 px-4 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Icon className="text-faint size-4 shrink-0" aria-hidden />
            <span className="text-ink text-lead font-medium">{source.name}</span>
            <SyncStatusLabel status={source.syncStatus} />
            <span className="text-faint text-meta">
              {source.scriptCount} {source.scriptCount === 1 ? 'script' : 'scripts'}
            </span>
          </div>

          <div className="mt-1.5 grid gap-1">
            {source.repoUrl ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="label">Repo</span>
                <MonoValue value={source.repoUrl} />
                {source.branch ? <span className="mono text-mute text-meta">@{source.branch}</span> : null}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <span className="label">Mount</span>
              <MonoValue value={source.mountPath} />
              {source.subPath ? (
                <span className="mono text-mute text-meta">/{source.subPath}</span>
              ) : null}
            </div>
            <p className="text-faint text-meta">
              {source.lastSyncAt === null
                ? 'Never synced'
                : `Last synced ${formatRelative(source.lastSyncAt)} · ${formatDateTime(source.lastSyncAt)}`}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            icon={<RefreshCw className="size-4" aria-hidden />}
            loading={sync.isPending}
            onClick={() =>
              sync.mutate(source.id, { onSuccess: (result) => setLastSync(result) })
            }
          >
            Sync now
          </Button>
          <IconButton label={`Edit ${source.name}`} onClick={onEdit}>
            <Pencil className="size-4" aria-hidden />
          </IconButton>
          <IconButton
            label={`Delete ${source.name}`}
            className="hover:text-danger"
            disabled={remove.isPending}
            onClick={() => remove.mutate(source.id)}
          >
            <Trash className="size-4" aria-hidden />
          </IconButton>
        </div>
      </div>

      {source.syncError !== null ? <ErrorBanner message={source.syncError} /> : null}
      {sync.isError ? <ErrorBanner message={sync.error.message} /> : null}
      {remove.isError ? <ErrorBanner message={remove.error.message} /> : null}

      {lastSync ? (
        <div className="border-line bg-panel-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border px-3 py-2">
          <SyncCount label="added" value={lastSync.added} />
          <SyncCount label="updated" value={lastSync.updated} />
          <SyncCount label="removed" value={lastSync.removed} />
          <span className="mono text-mute text-meta">{lastSync.total} total</span>
          {lastSync.warnings.length > 0 ? (
            <span className="text-warn text-meta">
              {lastSync.warnings.length} {lastSync.warnings.length === 1 ? 'warning' : 'warnings'}
            </span>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => navigate('/scripts')}
          >
            Open scripts
          </Button>
        </div>
      ) : null}

      {lastSync && lastSync.warnings.length > 0 ? (
        <ul className="grid gap-1">
          {lastSync.warnings.map((warning) => (
            <li key={warning} className="text-mute mono text-meta">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SyncCount({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={`mono text-lead ${value > 0 ? 'text-ink' : 'text-faint'}`}>{value}</span>
      <span className="label">{label}</span>
    </span>
  );
}
