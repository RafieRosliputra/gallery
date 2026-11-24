// The app is a static SPA served by Fastify under `/s` (SPEC § API).
// Disabling SSR keeps every route on the client, so adapter-static only has
// to emit `index.html` as the fallback.
export const ssr = false;
export const prerender = false;
export const trailingSlash = 'never';

import { ensureMocks } from '$lib/mocks';

export async function load() {
  await ensureMocks();
  return {};
}
