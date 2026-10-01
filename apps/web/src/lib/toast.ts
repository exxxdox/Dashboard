/**
 * The toast store.
 *
 * Deliberately not a React context. The rules worth testing are the lifetime
 * ones -- retire on a timer, hold while the pointer is on the row, carry on
 * from where it stopped when the pointer leaves, keep the stack bounded -- and
 * a plain module tests them with nothing but fake timers, no renderer and no
 * extra dependency. `components/Toaster.tsx` is the rendering half and holds no
 * state of its own.
 */

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export type Toast = {
  id: number;
  tone: ToastTone;
  message: string;
  /** Total lifetime; the progress bar draws itself from this. */
  ttl: number;
  /** The exit animation is playing and the row is still mounted. */
  leaving: boolean;
  /** Held open because the pointer is on it. */
  paused: boolean;
};

export type ToastOptions = {
  tone?: ToastTone;
  ttl?: number;
};

/** Long enough to read a sentence, short enough that it is not furniture. */
export const TOAST_TTL = 5200;

/** Matches `toast-out` in index.css: the row is dropped when it has played. */
export const TOAST_EXIT_MS = 260;

/** Past this the oldest is dropped. A stack is feedback, not a log. */
export const MAX_TOASTS = 4;

let nextId = 1;
let toasts: Toast[] = [];
const listeners = new Set<() => void>();

/** Retirement timer per id, with the moment it is due, so a pause can measure it. */
const timers = new Map<number, { deadline: number; handle: ReturnType<typeof setTimeout> }>();
/** Removal timer per id, running while the exit animation plays. */
const exits = new Map<number, ReturnType<typeof setTimeout>>();
/** What a paused toast has left to live. */
const remaining = new Map<number, number>();

function emit(): void {
  for (const listener of listeners) listener();
}

function replace(next: Toast[]): void {
  toasts = next;
  emit();
}

function patch(id: number, changes: Partial<Toast>): void {
  replace(toasts.map((toast) => (toast.id === id ? { ...toast, ...changes } : toast)));
}

function arm(id: number, delay: number): void {
  timers.set(id, {
    deadline: Date.now() + delay,
    handle: setTimeout(() => beginExit(id), delay),
  });
}

/** Drop every timer for a row that is leaving for a reason other than its own. */
function forget(id: number): void {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer.handle);
  const exit = exits.get(id);
  if (exit) clearTimeout(exit);
  timers.delete(id);
  exits.delete(id);
  remaining.delete(id);
}

function beginExit(id: number): void {
  const toast = toasts.find((item) => item.id === id);
  // Idempotent: the close button and the lifetime timer can both arrive, and a
  // second exit timer would remove the row twice.
  if (!toast || toast.leaving) return;

  const timer = timers.get(id);
  if (timer) clearTimeout(timer.handle);
  timers.delete(id);
  remaining.delete(id);

  patch(id, { leaving: true, paused: false });
  exits.set(
    id,
    setTimeout(() => {
      exits.delete(id);
      replace(toasts.filter((item) => item.id !== id));
    }, TOAST_EXIT_MS),
  );
}

/**
 * Show a message. Returns its id, which is what `dismissToast` wants back.
 *
 * A new row arrives at the bottom, so the one someone is already reading never
 * moves; when the stack is full it is the oldest that goes.
 */
export function pushToast(message: string, options: ToastOptions = {}): number {
  const ttl = options.ttl ?? TOAST_TTL;
  const toast: Toast = {
    id: nextId++,
    tone: options.tone ?? 'info',
    message,
    ttl,
    leaving: false,
    paused: false,
  };

  const next = [...toasts, toast];
  const overflow = next.length - MAX_TOASTS;
  if (overflow > 0) {
    for (const dropped of next.slice(0, overflow)) forget(dropped.id);
  }

  replace(next.slice(Math.max(0, overflow)));
  arm(toast.id, ttl);
  return toast.id;
}

/** Hold a row open. A no-op once it is on its way out. */
export function pauseToast(id: number): void {
  const timer = timers.get(id);
  if (!timer) return;

  clearTimeout(timer.handle);
  timers.delete(id);
  remaining.set(id, Math.max(0, timer.deadline - Date.now()));
  patch(id, { paused: true });
}

/** Give a held row the rest of the time it had left. */
export function resumeToast(id: number): void {
  const left = remaining.get(id);
  if (left === undefined) return;

  remaining.delete(id);
  patch(id, { paused: false });
  arm(id, left);
}

export function dismissToast(id: number): void {
  beginExit(id);
}

/** Throw the whole stack away -- a sign-out, or a test starting clean. */
export function clearToasts(): void {
  for (const toast of toasts) forget(toast.id);
  toasts = [];
  emit();
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The current stack.
 *
 * The reference only changes when the stack does, which is what
 * `useSyncExternalStore` requires to avoid an infinite render loop.
 */
export function getToasts(): readonly Toast[] {
  return toasts;
}
