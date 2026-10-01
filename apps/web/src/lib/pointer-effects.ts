import { useEffect } from 'react';

/**
 * Pointer-driven light, from one listener.
 *
 * Two effects share this: the ambient aura that trails the cursor across the
 * page, and the per-element highlight on anything carrying `data-glow`. Both
 * are written as CSS custom properties -- the aura reads `--pointer-x/-y` from
 * the root, an element reads `--mx`/`--my` from itself -- so neither needs a
 * React render. A moving pointer must not re-render the app.
 *
 * Delegated rather than per-component because there is no per-component work to
 * do: `closest('[data-glow]')` finds the surface under the pointer, and only
 * the element being left has its properties cleared.
 */
export function usePointerEffects(): void {
  useEffect(() => {
    // No `(hover: hover)` guard. It reads like the careful thing to do and is
    // the opposite: a browser that reports no hover -- a headless one, a
    // hybrid that calls its primary input a touch screen -- would silently lose
    // the effect, and the cost it guards against is small. A touch screen only
    // raises `pointermove` while a finger is dragging, and this throttles to
    // one write per frame either way.
    const root = document.documentElement;
    let frame = 0;
    /** The element currently holding `--mx`/`--my`, so only one is ever lit. */
    let lit: HTMLElement | null = null;

    const apply = (x: number, y: number, host: HTMLElement | null): void => {
      frame = 0;
      root.style.setProperty('--pointer-x', `${x}px`);
      root.style.setProperty('--pointer-y', `${y}px`);

      if (host !== lit) {
        lit?.style.removeProperty('--mx');
        lit?.style.removeProperty('--my');
        lit = host;
      }

      if (host) {
        // Measured per frame rather than cached: a scroll, a resize or a panel
        // opening all move the box, and a stale rect puts the light off-centre.
        const box = host.getBoundingClientRect();
        host.style.setProperty('--mx', `${x - box.left}px`);
        host.style.setProperty('--my', `${y - box.top}px`);
      }
    };

    const onMove = (event: PointerEvent): void => {
      // One write per frame, not one per event: a high-polling mouse fires
      // several times between two paints.
      if (frame !== 0) return;
      const { clientX, clientY } = event;
      const host =
        event.target instanceof Element ? event.target.closest<HTMLElement>('[data-glow]') : null;
      frame = requestAnimationFrame(() => apply(clientX, clientY, host));
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame !== 0) cancelAnimationFrame(frame);
      lit?.style.removeProperty('--mx');
      lit?.style.removeProperty('--my');
    };
  }, []);
}
