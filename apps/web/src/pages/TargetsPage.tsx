import { useState } from 'react';
import { Pencil, Plug, Plus, Server, ShieldCheck, Trash, TriangleAlert } from 'lucide-react';
import type { TargetSummary } from '@dashboard/shared';
import { PageBody } from '../components/AppShell';
import { PageHeader } from '../components/PageHeader';
import { Panel } from '../components/Panel';
import { Button, IconButton } from '../components/Button';
import { EmptyState, ErrorBanner, LoadingRows } from '../components/Feedback';
import { MonoValue } from '../components/MonoValue';
import { useCheckTarget, useDeleteTarget, useTargets } from '../api/queries';
import { errorMessage } from '../api/client';
import { useI18n } from '../lib/i18n';
import { formatDateTime } from '../lib/format';
import { cn } from '../lib/cn';
import { TargetForm } from './TargetForm';

export function TargetsPage() {
  const i18n = useI18n();
  const targets = useTargets();
  const [editing, setEditing] = useState<TargetSummary | null>(null);
  const [creating, setCreating] = useState(false);

  const list = targets.data ?? [];
  const showForm = creating || editing !== null;

  function closeForm(): void {
    setCreating(false);
    setEditing(null);
  }

  return (
    <PageBody>
      <PageHeader
        eyebrow={i18n.t('targets.eyebrow')}
        title={i18n.t('targets.title')}
        description={i18n.t('targets.description')}
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
              {i18n.t('targets.add')}
            </Button>
          )
        }
      />

      {showForm ? (
        <Panel
          className="mt-5"
          title={
            editing ? i18n.t('targets.editTitle', { name: editing.name }) : i18n.t('targets.newTitle')
          }
        >
          <TargetForm target={editing} onDone={closeForm} />
        </Panel>
      ) : null}

      {targets.isError ? (
        <ErrorBanner
          className="mt-5"
          message={errorMessage(targets.error, i18n)}
          onRetry={() => void targets.refetch()}
        />
      ) : null}

      <Panel className="mt-5" flush>
        {targets.isPending ? (
          <LoadingRows rows={3} />
        ) : list.length === 0 ? (
          <div className="p-3">
            <EmptyState
              icon={<Server className="size-5" aria-hidden />}
              title={i18n.t('targets.empty.title')}
              description={i18n.t('targets.empty.description')}
              action={
                <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                  {i18n.t('targets.add')}
                </Button>
              }
            />
          </div>
        ) : (
          <ul className="divide-line divide-y">
            {list.map((target) => (
              <li key={target.id}>
                <TargetRow
                  target={target}
                  onEdit={() => {
                    setCreating(false);
                    setEditing(target);
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

function TargetRow({ target, onEdit }: { target: TargetSummary; onEdit: () => void }) {
  const i18n = useI18n();
  const check = useCheckTarget();
  const remove = useDeleteTarget();

  return (
    <div className="grid gap-3 px-4 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-ink text-lead font-medium">{target.name}</span>
            <MonoValue value={`${target.username}@${target.host}:${target.port}`} />
            <span className="text-faint text-micro tracking-[0.15em] uppercase">
              {target.authMethod === 'key'
                ? i18n.t('targets.auth.key')
                : i18n.t('targets.auth.password')}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="mono text-mute text-meta">{target.workDir}</span>
            <TargetCheckStamp target={target} />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            icon={<Plug className="size-4" aria-hidden />}
            loading={check.isPending}
            onClick={() => check.mutate(target.id)}
          >
            {i18n.t('targets.testConnection')}
          </Button>
          <IconButton label={i18n.t('targets.editTitle', { name: target.name })} onClick={onEdit}>
            <Pencil className="size-4" aria-hidden />
          </IconButton>
          <IconButton
            label={i18n.t('targets.deleteNamed', { name: target.name })}
            className="hover:text-danger"
            disabled={remove.isPending}
            onClick={() => remove.mutate(target.id)}
          >
            <Trash className="size-4" aria-hidden />
          </IconButton>
        </div>
      </div>

      {/* Both of these report through a toast, and a check reports what it
          found there too -- the row's own stamp is the part worth keeping. */}
    </div>
  );
}

/** The stored result of the last check, when the page has not run a fresh one. */
function TargetCheckStamp({ target }: { target: TargetSummary }) {
  const i18n = useI18n();
  if (target.lastCheckAt === null) {
    return <span className="text-faint text-meta">{i18n.t('targets.neverChecked')}</span>;
  }

  const ok = target.lastCheckOk === true;

  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-meta', ok ? 'text-ok' : 'text-danger')}
      title={target.lastCheckDetail ?? undefined}
    >
      {ok ? (
        <ShieldCheck className="size-3" aria-hidden />
      ) : (
        <TriangleAlert className="size-3" aria-hidden />
      )}
      {ok ? i18n.t('targets.ready') : i18n.t('targets.notReady')}
      <span className="text-faint">· {formatDateTime(target.lastCheckAt, i18n.locale)}</span>
    </span>
  );
}

