import { useEffect } from 'react';
import { AppShell, PageBody } from './components/AppShell';
import { PageHeader } from './components/PageHeader';
import { EmptyState } from './components/Feedback';
import { Button } from './components/Button';
import { useRoute, navigate } from './lib/router';
import { OverviewPage } from './pages/OverviewPage';
import { ScriptsPage } from './pages/ScriptsPage';
import { RunsPage } from './pages/RunsPage';
import { RunDetailPage } from './pages/RunDetailPage';
import { TargetsPage } from './pages/TargetsPage';
import { SourcesPage } from './pages/SourcesPage';
import { DnsPage } from './pages/DnsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SignInPage } from './pages/SignInPage';
import { useAuthStatus } from './api/queries';
import { UNAUTHORIZED_EVENT } from './api/client';
import { useT } from './lib/i18n';

export function App() {
  const route = useRoute();
  const auth = useAuthStatus();
  const { refetch } = auth;

  // A session can expire while the tab sits open, and the client reports that as
  // an event rather than per-call handling: without this the UI would keep
  // showing a page whose every request now fails.
  useEffect(() => {
    const onUnauthorized = (): void => {
      void refetch();
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [refetch]);

  // Nothing is rendered until the server has said whether a sign-in is wanted:
  // guessing would either flash the app for a signed-out visitor or flash the
  // login form on every reload of an open deployment.
  if (auth.isPending) return null;
  if (auth.data?.required && !auth.data.signedIn) return <SignInPage />;

  return (
    <AppShell route={route}>
      <RouteView route={route} />
    </AppShell>
  );
}

function RouteView({ route }: { route: ReturnType<typeof useRoute> }) {
  const t = useT();

  switch (route.name) {
    case 'overview':
      return <OverviewPage />;
    case 'scripts':
      return <ScriptsPage scriptId={route.scriptId} />;
    case 'runs':
      return route.executionId === null ? (
        <RunsPage route={route} />
      ) : (
        <RunDetailPage executionId={route.executionId} />
      );
    case 'targets':
      return <TargetsPage />;
    case 'sources':
      return <SourcesPage />;
    case 'dns':
      return <DnsPage search={route.search} />;
    case 'settings':
      return <SettingsPage />;
    case 'notFound':
      return (
        <PageBody>
          <PageHeader
            eyebrow="404"
            title={t('common.noSuchPage')}
            description={t('common.noSuchPageDescription', { path: route.path })}
          />
          <div className="mt-5">
            <EmptyState
              title={t('common.notFoundTitle')}
              description={t('common.notFoundDescription')}
              action={
                <Button variant="primary" onClick={() => navigate('/')}>
                  {t('common.backToOverview')}
                </Button>
              }
            />
          </div>
        </PageBody>
      );
  }
}
