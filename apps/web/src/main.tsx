import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { App } from './App';
import { createQueryClient } from './api/query-client';
import { LocaleProvider } from './lib/i18n';

// The cache and its mutation feedback are one object, so they are built
// together -- see `api/query-client.ts`.
const queryClient = createQueryClient();

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
