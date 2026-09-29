import { Activity, FileCode, FolderTree, Globe, Server, Settings, Terminal } from 'lucide-react';

import { cn } from '../lib/cn';
import { href, type Route } from '../lib/router';
import { useAuthStatus, useHealth, useLogout } from '../api/queries';
import { useT, type MessageKey } from '../lib/i18n';

export type NavItem = {
  route: Route['name'];
  /** A key rather than a string: the label belongs to the reader's language. */
  label: MessageKey;
  path: string;
  icon: typeof Activity;
};

export const NAV_ITEMS: NavItem[] = [
  { route: 'overview', label: 'nav.overview', path: '/', icon: Activity },
  { route: 'scripts', label: 'nav.scripts', path: '/scripts', icon: FileCode },
  { route: 'runs', label: 'nav.runs', path: '/runs', icon: Terminal },
  { route: 'targets', label: 'nav.targets', path: '/targets', icon: Server },
  { route: 'sources', label: 'nav.sources', path: '/sources', icon: FolderTree },
  // Appended rather than inserted: nothing else on the rail moves for it.
  { route: 'dns', label: 'nav.dns', path: '/dns', icon: Globe },
  { route: 'settings', label: 'nav.settings', path: '/settings', icon: Settings },
];

export function Nav({ active }: { active: Route['name'] }) {
  const t = useT();

  return (
    <nav aria-label={t('nav.main')} className="flex flex-col gap-1 px-3">
      {NAV_ITEMS.map((item) => {
        const isActive = item.route === active;
        const Icon = item.icon;
        return (
          <a
            key={item.route}
            href={href(item.path)}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'focus-ring group text-body relative flex h-11 items-center gap-3 rounded-lg px-3',
              'transition-colors duration-150 ease-out',
              isActive ? 'bg-accent-soft text-ink' : 'text-mute hover:bg-panel-2 hover:text-ink',
            )}
          >
            {/* The active mark repeats the run rail's language at nav scale. */}
            <span
              aria-hidden
              className={cn(
                'absolute top-2 bottom-2 -left-3 w-[2px] rounded-full transition-colors duration-150',
                isActive ? 'bg-accent' : 'bg-transparent',
              )}
            />
            <Icon
              className={cn(
                'size-[18px] shrink-0 transition-colors duration-150',
                isActive ? 'text-accent' : 'text-faint group-hover:text-mute',
              )}
              aria-hidden
            />
            {t(item.label)}
          </a>
        );
      })}
    </nav>
  );
}

/** Build identity lives at the foot of the rail: which server am I talking to. */
export function ServerStamp() {
  const t = useT();
  const health = useHealth();
  const auth = useAuthStatus();
  const logout = useLogout();

  return (
    <div className="border-line border-t px-5 py-4">
      {health.isPending ? (
        <p className="label">{t('nav.connecting')}</p>
      ) : health.isError ? (
        <p className="text-danger text-meta flex items-center gap-2">
          <span className="bg-danger size-1.5 shrink-0 rounded-full" aria-hidden />
          {t('nav.apiUnreachable')}
        </p>
      ) : (
        <div className="grid gap-1.5">
          <p className="label">{t('nav.server')}</p>
          <p className="mono text-mute text-meta">
            v{health.data.version} · schema {health.data.schemaVersion}
          </p>
          {/* Only where there is a session to end: on an open deployment a sign
              out button would be a lie about what it does. */}
          {auth.data?.required && auth.data.signedIn ? (
            <button
              type="button"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              className="focus-ring text-mute hover:text-ink text-meta w-fit rounded-lg underline underline-offset-2 transition-colors duration-150 ease-out"
            >
              {t('nav.signOut')}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
