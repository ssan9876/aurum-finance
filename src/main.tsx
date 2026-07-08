import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SettingsProvider } from '@/state/settings';
import { initApi } from '@/data/api';
import { ServerLogin } from '@/components/layout/ServerLogin';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

async function bootstrap() {
  // Pick the storage backend (Electron IPC → self-hosted server → browser)
  // before rendering, so every component sees a ready `api`.
  const status = await initApi();
  const root = ReactDOM.createRoot(document.getElementById('root')!);

  if (status.needsAuth) {
    root.render(
      <React.StrictMode>
        <ServerLogin />
      </React.StrictMode>
    );
    return;
  }

  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <SettingsProvider>
          <TooltipProvider delayDuration={250}>
            {/* HashRouter keeps deep links working under file:// in the packaged app */}
            <HashRouter>
              <App />
            </HashRouter>
          </TooltipProvider>
        </SettingsProvider>
      </QueryClientProvider>
    </React.StrictMode>
  );
}

bootstrap();
