import type { ReactNode } from 'react';

import { Nav, ServerStamp } from './Nav';
import { Wordmark } from './Wordmark';
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
    // No background of its own: the atmosphere and the pointer light are fixed
    // layers painted behind everything, and an opaque panel here would cover
    // both. The rail and the mobile strip stay translucent for the same reason.
    <div className="flex min-h-screen">
      <aside className="border-line bg-base/80 sticky top-0 hidden h-screen w-[272px] shrink-0 flex-col border-r backdrop-blur-xl lg:flex">
        <a
          href={href('/')}
          className="focus-ring flex h-24 items-center px-5"
          aria-label={t('nav.home')}
        >
          {/* The wordmark is the one piece of furniture in the rail: it is sized
              to read as the product's name, not as another nav label. */}
          <Wordmark />
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
            {/* The mark alone: the strip is for navigation, and the word would
                cost a nav item's worth of width to say what the mark already
                says. */}
            <Wordmark className="mr-3 [&>span:last-child]:hidden" />
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
