import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';

import { App } from './App';
import { createExecutionQueryClient } from './lib/query-client';
import './styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Application root element was not found.');
}

const queryClient = createExecutionQueryClient();

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
