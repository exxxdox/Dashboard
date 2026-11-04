import { useCallback, useEffect, useState } from 'react';
import { UNAUTHORIZED_EVENT } from '../api/client';
import { Editor } from './components/Editor';
import { useAdminData } from './hooks/useAdminData';
import { hashForPage, pageFromHash, PAGES, type PageKey } from './navigation';
import { DashboardPage } from './pages/DashboardPage';
import { CapabilitiesPage } from './pages/CapabilitiesPage';
import { OllamaPage } from './pages/OllamaPage';
import { SettingsPage } from './pages/SettingsPage';
import { useRelayT } from './i18n';
import type { EditorState, ResourceName } from './types';
import './styles.css';

export function ModelRelayPage() {
  const t = useRelayT();
  const [page, setPage] = useState<PageKey>(() => pageFromHash(window.location.hash));
  const [editor, setEditor] = useState<EditorState>(null);
  useEffect(() => {
    const sync = () => setPage(pageFromHash(window.location.hash));
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const unauthorized = useCallback(() => window.dispatchEvent(new Event(UNAUTHORIZED_EVENT)), []);
  const data = useAdminData(unauthorized);
  const navigate = useCallback((next: PageKey) => {
    window.location.hash = hashForPage(next);
    setPage(next);
  }, []);
  const openEditor = useCallback((resource: ResourceName, id?: string) => setEditor({ resource, id }), []);

  return (
    <div className="model-relay min-w-0 p-5 sm:p-8">
      <nav className="page-nav mb-6 flex flex-wrap gap-2" aria-label="Model Relay">
        {PAGES.map((item) => <a key={item.key} href={hashForPage(item.key)} className={item.key === page ? 'active' : undefined} aria-current={item.key === page ? 'page' : undefined}>{t(item.label)}</a>)}
      </nav>
      {page === 'dashboard' && <DashboardPage data={data} onNavigate={navigate} />}
      {page === 'ollama' && <OllamaPage data={data} onOpenEditor={openEditor} />}
      {page === 'capabilities' && <CapabilitiesPage data={data} onOpenEditor={openEditor} />}
      {page === 'settings' && <SettingsPage data={data} />}
      {editor && <Editor key={`${editor.resource}-${editor.id ?? 'new'}`} editor={editor} capabilities={data.capabilities} endpoints={data.endpoints} deployments={data.deployments} routes={data.routes} discoveredModels={data.discoveredModels} refreshingModels={data.refreshingModels} onRefreshModels={data.refreshModelList} api={data.api} onClose={() => setEditor(null)} onSaved={async () => { setEditor(null); data.setMessage(t('配置已保存')); await data.refresh(); }} />}
    </div>
  );
}
