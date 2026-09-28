import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
import { ApiError, createApi, createHttpTransport, type Transport } from './api/client';
import { ApiContext, DemoContext, type DemoControls } from './app/context';
import { createAppRouter } from './app/router';
import { ConfirmProvider, ToastProvider } from './components/ui/Overlays';

async function boot() {
  const rootEl = document.getElementById('root');
  if (!rootEl) return;

  let transport: Transport;
  let demo: DemoControls | null = null;
  let startNative: ((router: { navigate: (to: string) => unknown }) => void) | null = null;
  if (import.meta.env.MODE === 'demo') {
    const { createDemoBackend } = await import('./demo/backend');
    const backend = await createDemoBackend();
    transport = backend.transport;
    demo = { reset: () => backend.reset(), seededAt: backend.seededAt };
  } else if (import.meta.env.MODE === 'native') {
    // The iOS app (Capacitor): bearer token from the Keychain, API on the server – see src/web/native/.
    const native = await import('./native');
    transport = await native.prepareNative();
    startNative = native.startNative;
  } else {
    transport = createHttpTransport();
  }

  const api = createApi(transport);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: (count, err) => (err instanceof ApiError ? (err.status >= 500 || err.status === 0) && count < 2 : count < 1),
        refetchOnWindowFocus: true,
        staleTime: 10_000,
      },
      mutations: { retry: false },
    },
  });
  const router = createAppRouter(import.meta.env.MODE === 'demo' ? 'hash' : 'browser');

  createRoot(rootEl).render(
    <StrictMode>
      <ApiContext.Provider value={api}>
        <DemoContext.Provider value={demo}>
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <ConfirmProvider>
                <RouterProvider router={router} />
              </ConfirmProvider>
            </ToastProvider>
          </QueryClientProvider>
        </DemoContext.Provider>
      </ApiContext.Provider>
    </StrictMode>,
  );

  document.getElementById('boot')?.remove();
  startNative?.(router);

  if (import.meta.env.PROD && import.meta.env.MODE !== 'demo' && import.meta.env.MODE !== 'native' && 'serviceWorker' in navigator) {
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({
      immediate: true,
      // Installed apps (and door scanners) can stay open for days: look for a new version every hour.
      onRegisteredSW(_url, registration) {
        if (registration) window.setInterval(() => void registration.update().catch(() => {}), 60 * 60 * 1000);
      },
    });
  }
}

void boot();
