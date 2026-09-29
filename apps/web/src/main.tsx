import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { App } from './App';
import { ApiError } from './api/client';
import { LocaleProvider } from './lib/i18n';

const queryClient = new QueryClient({
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

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Outside the app rather than inside a page: the language is read by the
          sign-in screen too, which renders before any route exists. */}
      <LocaleProvider>
        <App />
      </LocaleProvider>
    </QueryClientProvider>
  </StrictMode>,
);
