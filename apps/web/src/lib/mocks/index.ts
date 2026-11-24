import { base } from '$app/paths';

let started: Promise<void> | undefined;

/**
 * Starts MSW only in builds made with `VITE_MOCKS=1` (CI screenshots/e2e).
 * The import is dynamic so production builds drop the MSW chunk entirely.
 */
export function ensureMocks(): Promise<void> {
  if (import.meta.env.VITE_MOCKS !== '1') return Promise.resolve();
  started ??= (async () => {
    const { worker } = await import('./browser');
    await worker.start({
      onUnhandledRequest: 'bypass',
      serviceWorker: {
        url: `${base}/mockServiceWorker.js`,
        options: { scope: `${base}/` }
      }
    });
  })();
  return started;
}
