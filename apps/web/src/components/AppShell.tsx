import type { ReactNode } from 'react';

import { Nav, ServerStamp } from './Nav';
import { href, type Route } from '../lib/router';
import { useT } from '../lib/i18n';

/**
 * Fixed rail plus a scrolling work area.
 *
 * The rail collapses to a strip below `lg` so a laptop half-screen still leaves
 * the terminal a usable width.
 */
export function AppShell({ route, children }: { route: Route; children: ReactNode }) {
  const t = useT();

  return (
    <div className="bg-base flex min-h-screen">
      <aside className="border-line bg-base/80 sticky top-0 hidden h-screen w-[272px] shrink-0 flex-col border-r backdrop-blur-xl lg:flex">
        <a
          href={href('/')}
          className="focus-ring flex h-24 items-center gap-3.5 px-5"
          aria-label={t('nav.home')}
        >
          {/* The wordmark is the one piece of furniture in the rail: it is sized
              to read as the product's name, not as another nav label. */}
          <span className="bg-accent shadow-glow h-9 w-1.5 shrink-0 rounded-full" aria-hidden />
          <span className="mono text-brand font-semibold tracking-tight">
            <span className="text-mute">script</span>
            <span className="text-ink">dashboard</span>
          </span>
        </a>

        <Nav active={route.name} />
        <div className="mt-auto">
          <ServerStamp />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Below lg the rail becomes a horizontal strip; the tool is still usable. */}
        <div className="border-line bg-base/85 sticky top-0 z-20 border-b backdrop-blur-xl lg:hidden">
          <div className="flex h-16 items-center gap-1 overflow-x-auto px-4">
            <span className="mono text-ink text-brand mr-3 shrink-0 font-semibold">dashboard</span>
            <Nav active={route.name} />
          </div>
        </div>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

/** Standard page frame: consistent gutters and a max width that aids scanning. */
export function PageBody({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'px-5 py-7 sm:px-8' : 'mx-auto w-full max-w-[1320px] px-5 py-7 sm:px-8'}>
      {children}
    </div>
  );
}
