import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_TOASTS,
  TOAST_EXIT_MS,
  TOAST_TTL,
  TOAST_TTL_DETAIL,
  clearToasts,
  dismissToast,
  getToasts,
  pauseToast,
  pushToast,
  resumeToast,
  subscribeToasts,
} from './toast';

beforeEach(() => {
  vi.useFakeTimers();
  clearToasts();
});

afterEach(() => {
  clearToasts();
  vi.useRealTimers();
});

describe('pushToast', () => {
  it('shows a row and retires it on its own', () => {
    pushToast('saved', { tone: 'success' });
    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0]?.tone).toBe('success');

    // A millisecond short of its life it is still a toast, not a departing one.
    vi.advanceTimersByTime(TOAST_TTL - 1);
    expect(getToasts()[0]?.leaving).toBe(false);

    vi.advanceTimersByTime(1);
    expect(getToasts()[0]?.leaving).toBe(true);

    // The row outlives its timer only long enough for the exit to play.
    vi.advanceTimersByTime(TOAST_EXIT_MS - 1);
    expect(getToasts()).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(getToasts()).toHaveLength(0);
  });

  it('gives a row carrying a result the longer read', () => {
    pushToast('updated', { detail: 'example.com → 2001:db8::1' });

    vi.advanceTimersByTime(TOAST_TTL);
    expect(getToasts()[0]?.leaving).toBe(false);

    vi.advanceTimersByTime(TOAST_TTL_DETAIL - TOAST_TTL);
    expect(getToasts()[0]?.leaving).toBe(true);
  });

  it('lets a caller override the lifetime either way', () => {
    pushToast('sticky', { detail: 'a result', ttl: 1000 });

    vi.advanceTimersByTime(1000);
    expect(getToasts()[0]?.leaving).toBe(true);
  });

  it('keeps the stack bounded, dropping the oldest', () => {
    for (let index = 0; index < MAX_TOASTS + 2; index += 1) pushToast(`message ${index}`);

    const listed = getToasts();
    expect(listed).toHaveLength(MAX_TOASTS);
    expect(listed[0]?.message).toBe('message 2');
    expect(listed[listed.length - 1]?.message).toBe(`message ${MAX_TOASTS + 1}`);
  });

  it('notifies subscribers with a new reference only', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToasts(listener);

    const before = getToasts();
    expect(getToasts()).toBe(before);

    pushToast('one');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getToasts()).not.toBe(before);

    unsubscribe();
    pushToast('two');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('pause and resume', () => {
  it('holds a row under the pointer and carries on from where it stopped', () => {
    pushToast('saved');
    const id = getToasts()[0]?.id ?? 0;

    vi.advanceTimersByTime(TOAST_TTL - 1000);
    pauseToast(id);
    expect(getToasts()[0]?.paused).toBe(true);

    // However long the pointer rests there, nothing is lost.
    vi.advanceTimersByTime(TOAST_TTL * 10);
    expect(getToasts()[0]?.leaving).toBe(false);

    resumeToast(id);
    expect(getToasts()[0]?.paused).toBe(false);

    // The second it had left is the second it gets back.
    vi.advanceTimersByTime(999);
    expect(getToasts()[0]?.leaving).toBe(false);
    vi.advanceTimersByTime(1);
    expect(getToasts()[0]?.leaving).toBe(true);
  });

  it('ignores a pause on a row that is already leaving', () => {
    pushToast('saved');
    const id = getToasts()[0]?.id ?? 0;

    dismissToast(id);
    pauseToast(id);
    expect(getToasts()[0]?.paused).toBe(false);

    vi.advanceTimersByTime(TOAST_EXIT_MS);
    expect(getToasts()).toHaveLength(0);
  });
});

describe('dismissToast', () => {
  it('removes only the row it was given', () => {
    const first = pushToast('one');
    pushToast('two');

    dismissToast(first);
    vi.advanceTimersByTime(TOAST_EXIT_MS);

    expect(getToasts().map((toast) => toast.message)).toEqual(['two']);
  });

  it('survives being called twice, which the close button and the timer both do', () => {
    const id = pushToast('one');

    dismissToast(id);
    dismissToast(id);
    vi.advanceTimersByTime(TOAST_EXIT_MS);

    expect(getToasts()).toHaveLength(0);
    // A second exit timer would have thrown on a row that is already gone.
    expect(() => vi.advanceTimersByTime(TOAST_EXIT_MS)).not.toThrow();
  });
});
