import { useSyncExternalStore, type CSSProperties } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';

import { cn } from '../lib/cn';
import { useT } from '../lib/i18n';
import {
  dismissToast,
  getToasts,
  pauseToast,
  resumeToast,
  subscribeToasts,
  type Toast,
  type ToastTone,
} from '../lib/toast';

const TONE_ICON: Record<ToastTone, typeof Info> = {
  success: CircleCheck,
  error: CircleAlert,
  warning: TriangleAlert,
  info: Info,
};

/**
 * The feedback layer.
 *
 * Mounted once, at the bottom of the app, fixed over everything: a message
 * about an action has to be readable no matter which page the action was taken
 * on, and no matter whether it happened inside a dialog that has since closed.
 *
 * Every lifetime rule -- the timer, the hold under the pointer, the bounded
 * stack -- lives in `lib/toast.ts`. This file draws the stack and forwards the
 * two pointer events that pause and resume it.
 */
export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  const t = useT();

  return (
    // `polite` because a toast is a confirmation, not an interruption. An error
    // overrides it per-row with `alert`, which is the one case that is urgent.
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} dismissLabel={t('toast.dismiss')} />
      ))}
    </div>
  );
}

function ToastRow({ toast, dismissLabel }: { toast: Toast; dismissLabel: string }) {
  const Icon = TONE_ICON[toast.tone];

  return (
    <div
      className="toast"
      data-tone={toast.tone}
      data-paused={toast.paused}
      data-leaving={toast.leaving}
      role={toast.tone === 'error' ? 'alert' : 'status'}
      // The bar is drawn by CSS; how long it runs for is the store's business.
      style={{ '--toast-ttl': `${toast.ttl}ms` } as CSSProperties}
      // Pointer rather than mouse events: a stylus and a touch screen both press
      // a row, and a touch press should hold it just as a hover does.
      onPointerEnter={() => pauseToast(toast.id)}
      onPointerLeave={() => resumeToast(toast.id)}
    >
      <Icon className="toast-icon" aria-hidden />
      <div className="toast-body">
        <p className="toast-text">{toast.message}</p>
        {toast.detail === undefined ? null : <p className="toast-detail">{toast.detail}</p>}
      </div>
      <button
        type="button"
        className={cn('toast-close', 'focus-ring')}
        aria-label={dismissLabel}
        title={dismissLabel}
        onClick={() => dismissToast(toast.id)}
      >
        <X className="size-3.5" aria-hidden />
      </button>
      <span className="toast-timer" aria-hidden />
    </div>
  );
}
