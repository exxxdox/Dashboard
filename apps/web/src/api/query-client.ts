import { MutationCache, QueryClient } from '@tanstack/react-query';

import { globalLookup, globalTranslate, type MessageKey } from '../lib/i18n';
import type { Outcome } from '../lib/outcome';
import { pushToast } from '../lib/toast';
import { ApiError, errorMessage } from './client';

/**
 * What a mutation announces when it lands.
 *
 * Declared on the query client rather than in each hook's `onSuccess` because
 * the alternative is a toast call repeated in twenty places, and the ones added
 * later are exactly the ones that get forgotten.
 *
 * `success` is optional on purpose: a mutation without one is one whose result
 * the page already shows, and a toast for it would be noise. Failures are the
 * other way round -- they are announced whether or not the page also renders a
 * banner, because a banner sits inside the panel or the dialog the person may
 * already have left.
 */
declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      success?: MessageKey;
      /**
       * A background write that repeats on its own -- the run form's debounced
       * draft save is the only one. It is silent by design: a toast per failed
       * keystroke-batch would be worse than the failure.
       */
      quiet?: boolean;
    };
  }
}

/**
 * Say how an operation turned out.
 *
 * The one place that maps an outcome onto a toast, so the declarative path
 * below and a mutation reporting a result both end up in the same stack with
 * the same rules. `lib/outcome.ts` decides the words and the tone; this decides
 * only that they are a toast.
 */
export function report(outcome: Outcome): void {
  pushToast(outcome.message, { tone: outcome.tone, detail: outcome.detail });
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (_data, _variables, _context, mutation) => {
        const key = mutation.meta?.success;
        if (key) report({ message: globalTranslate(key), tone: 'success' });
      },
      onError: (error, _variables, _context, mutation) => {
        if (mutation.meta?.quiet) return;
        // The server's own words, through this client's dictionary where the
        // server named a key for them. Nothing is paraphrased here.
        pushToast(errorMessage(error, { lookup: globalLookup }), { tone: 'error' });
      },
    }),
    defaultOptions: {
      queries: {
        // A dashboard over a local API: refocus refetching would fight the live stream.
        refetchOnWindowFocus: false,
        staleTime: 15_000,
        retry: (failureCount, error) => {
          // Client errors are the server's answer; asking again will not change it.
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
          return failureCount < 2;
        },
      },
    },
  });
}
