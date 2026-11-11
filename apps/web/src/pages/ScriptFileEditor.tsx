import { useEffect, useRef, useState } from 'react';
import { FilePlus, Pencil, Trash2 } from 'lucide-react';
import type { ScriptContent, ScriptSummary } from '@dashboard/shared';
import { Button } from '../components/Button';
import { Field, TextInput } from '../components/Form';
import { ErrorBanner, LoadingBlock } from '../components/Feedback';
import { Modal } from '../components/Modal';
import { BashEditor } from '../components/BashEditor';
import { useCreateScript, useDeleteScript, useSaveScriptContent, useScriptContent } from '../api/queries';
import { errorMessage } from '../api/client';
import { useI18n } from '../lib/i18n';
import { guardNavigation, navigate } from '../lib/router';

type FileMode = 'create' | 'edit' | 'delete';

export function CreateScriptButton({ sourceId }: { sourceId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return <>
    <Button size="sm" icon={<FilePlus className="size-4" aria-hidden />} onClick={() => setOpen(true)}>{t('scripts.file.create')}</Button>
    {open ? <ScriptFileForm sourceId={sourceId} relPath="" mode="create" onClose={() => setOpen(false)} /> : null}
  </>;
}

export function ScriptFileActions({ script }: { script: ScriptSummary }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'edit' | 'delete' | null>(null);
  return <>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" icon={<Pencil className="size-4" aria-hidden />} onClick={() => setMode('edit')}>{t('scripts.file.edit')}</Button>
      <Button size="sm" variant="danger" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setMode('delete')}>{t('scripts.file.delete')}</Button>
    </div>
    {mode ? <ExistingScriptFileDialog key={`${script.id}:${mode}`} script={script} mode={mode} onClose={() => setMode(null)} /> : null}
  </>;
}

function ExistingScriptFileDialog({ script, mode, onClose }: { script: ScriptSummary; mode: 'edit' | 'delete'; onClose: () => void }) {
  const i18n = useI18n();
  const query = useScriptContent(script.id);
  const [snapshot, setSnapshot] = useState<ScriptContent | null>(null);
  if (!snapshot && query.data && !query.isFetching && !query.isError) setSnapshot(query.data);
  // A background invalidation must not unmount an editor holding unsaved work.
  if (!snapshot) {
    return <Modal open title={i18n.t(`scripts.file.${mode}`)} description={script.relPath} onClose={onClose}>
      {query.isError ? <ErrorBanner message={errorMessage(query.error, i18n)} onRetry={() => void query.refetch()} /> : <LoadingBlock label={i18n.t('scripts.loadingScript')} />}
    </Modal>;
  }
  return <ScriptFileForm sourceId={script.sourceId} scriptId={script.id} relPath={script.relPath} initial={snapshot} mode={mode} onClose={onClose} />;
}

export function ScriptFileForm({ sourceId, scriptId, relPath, initial, mode, onClose }: {
  sourceId: string; scriptId?: string; relPath: string; initial?: ScriptContent; mode: FileMode; onClose: () => void;
}) {
  const i18n = useI18n();
  const completed = useRef(false);
  const create = useCreateScript();
  const save = useSaveScriptContent();
  const remove = useDeleteScript();
  // Pin both bytes and version to the same snapshot even if another query refreshes.
  const [original] = useState(initial);
  const [path, setPath] = useState(relPath);
  const [content, setContent] = useState(initial?.content ?? '');
  const pending = create.isPending || save.isPending || remove.isPending;
  const dirty = mode !== 'delete' && (content !== (original?.content ?? '') || path !== relPath);
  const mutation = mode === 'create' ? create : mode === 'edit' ? save : remove;
  const close = () => {
    if (!pending && (!dirty || window.confirm(i18n.t('scripts.file.discard')))) onClose();
  };
  useEffect(() => {
    if (!dirty && !pending) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const unguard = guardNavigation(() => completed.current || (!pending && window.confirm(i18n.t('scripts.file.discard'))));
    window.addEventListener('beforeunload', preventLoss);
    return () => {
      window.removeEventListener('beforeunload', preventLoss);
      unguard();
    };
  }, [dirty, pending, i18n]);

  return <Modal open size={mode === 'delete' ? 'md' : 'xl'} title={i18n.t(`scripts.file.${mode}`)} description={mode === 'create' ? i18n.t('scripts.file.pathHint') : relPath} onClose={close}>
    {mode === 'delete' ? <div className="grid gap-4">
      <p className="text-body text-mute">{i18n.t('scripts.file.deleteHint')}</p>
      {mutation.isError ? <ErrorBanner message={errorMessage(mutation.error, i18n)} /> : null}
      <Button variant="danger" loading={pending} onClick={() => {
        if (!scriptId || !original || pending) return;
        remove.mutate({ id: scriptId, sourceId, input: { expectedHash: original.contentHash } }, { onSuccess: () => { completed.current = true; onClose(); navigate('/scripts'); } });
      }}>{i18n.t('scripts.file.deleteConfirm')}</Button>
    </div> : <form className="grid gap-4" onSubmit={(event) => {
      event.preventDefault();
      if (pending) return;
      if (mode === 'create') {
        create.mutate({ sourceId, input: { relPath: path, content } }, { onSuccess: (script) => { completed.current = true; onClose(); navigate(`/scripts/${encodeURIComponent(script.id)}`); } });
      } else if (scriptId && original) {
        save.mutate({ id: scriptId, input: { content, expectedHash: original.contentHash } }, { onSuccess: () => { completed.current = true; onClose(); } });
      }
    }}>
      {mode === 'create' ? <Field label={i18n.t('scripts.file.path')}>
        {({ id }) => <TextInput id={id} value={path} required placeholder="tools/example.sh" disabled={pending} onChange={event => setPath(event.target.value)} />}
      </Field> : null}
      <Field label={i18n.t('scripts.file.content')}>
        {({ id, describedBy }) => <BashEditor id={id} describedBy={describedBy} label={i18n.t('scripts.file.content')} value={content} readOnly={pending} onChange={setContent} />}
      </Field>
      {mutation.isError ? <ErrorBanner message={errorMessage(mutation.error, i18n)} /> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" loading={pending} disabled={mode === 'create' ? !path : !dirty}>{i18n.t('common.save')}</Button>
        <Button onClick={close} disabled={pending}>{i18n.t('common.close')}</Button>
        {dirty ? <span className="text-meta text-mute">{i18n.t('scripts.unsavedChanges')}</span> : null}
      </div>
    </form>}
  </Modal>;
}
