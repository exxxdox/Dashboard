import { afterEach, expect, test, vi } from 'vitest';
import { ApiError } from './client';
import { createQueryClient, report } from './query-client';
import { setActiveLocale, translate } from '../lib/i18n';
import { clearToasts, getToasts } from '../lib/toast';

afterEach(() => {
  clearToasts();
  setActiveLocale('en');
});

// Exercise the real mutation cache: page-level hook mocks cannot prove feedback reaches users.
test.each(['en', 'zh'] as const)('announces a successful mutation in %s', async (locale) => {
  setActiveLocale(locale);
  const client = createQueryClient();
  try {
    const mutation = client.getMutationCache().build(client, {
      mutationFn: async () => 'saved',
      meta: { success: 'toast.signedIn' },
    });
    await expect(mutation.execute(undefined)).resolves.toBe('saved');
    expect(getToasts()).toEqual([
      expect.objectContaining({ tone: 'success', message: translate(locale, 'toast.signedIn') }),
    ]);
  } finally {
    client.clear();
  }
});

test('does not add a success toast when the page owns the result', async () => {
  const client = createQueryClient();
  try {
    await client.getMutationCache().build(client, { mutationFn: async () => 'done' }).execute(undefined);
    expect(getToasts()).toEqual([]);
  } finally {
    client.clear();
  }
});

test.each([false, true])('reports mutation failures unless quiet=%s', async (quiet) => {
  const client = createQueryClient();
  const error = new Error('Cannot save target');
  try {
    const mutation = client.getMutationCache().build(client, {
      mutationFn: async () => { throw error; },
      meta: { quiet },
    });
    await expect(mutation.execute(undefined)).rejects.toBe(error);
    expect(getToasts()).toEqual(quiet ? [] : [
      expect.objectContaining({ tone: 'error', message: error.message }),
    ]);
  } finally {
    client.clear();
  }
});

test('translates server errors using the active language', async () => {
  setActiveLocale('zh');
  const client = createQueryClient();
  const error = new ApiError(0, 'network_error', 'Network unavailable', undefined, { key: 'common.networkError' });
  try {
    const mutation = client.getMutationCache().build(client, { mutationFn: async () => { throw error; } });
    await expect(mutation.execute(undefined)).rejects.toBe(error);
    expect(getToasts()[0]).toMatchObject({ tone: 'error', message: translate('zh', 'common.networkError') });
  } finally {
    client.clear();
  }
});

test.each([
  { error: new ApiError(401, 'unauthorized', 'Sign in'), attempts: 1 },
  { error: new ApiError(409, 'conflict', 'Cancel first'), attempts: 1 },
  { error: new ApiError(503, 'unavailable', 'Try later'), attempts: 3 },
  { error: new Error('Connection dropped'), attempts: 3 },
])('bounds retries for $error.message', async ({ error, attempts }) => {
  const client = createQueryClient();
  const queryFn = vi.fn().mockRejectedValue(error);
  try {
    await expect(client.fetchQuery({ queryKey: ['test'], queryFn, retryDelay: 0 })).rejects.toBe(error);
    expect(queryFn).toHaveBeenCalledTimes(attempts);
  } finally {
    client.clear();
  }
});

test('keeps action result detail and tone in its notification', () => {
  report({ message: 'Host checked', tone: 'warning', detail: 'setsid is unavailable' });
  expect(getToasts()).toEqual([
    expect.objectContaining({ message: 'Host checked', tone: 'warning', detail: 'setsid is unavailable' }),
  ]);
});
