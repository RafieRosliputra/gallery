import { fileURLToPath } from 'node:url';
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * SPA build served by Fastify at `/s` (SPEC § API). The adapter emits
 * `build/index.html` as the fallback; Fastify must serve it for every
 * unmatched `/s/*` GET so the client router can take over.
 */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html',
      precompress: false,
      strict: false
    }),
    paths: {
      base: '/s',
      relative: false
    },
    // Strict CSP without `unsafe-inline`: SvelteKit hashes the inline
    // bootstrap script it injects into the SPA fallback `index.html`.
    csp: {
      mode: 'hash',
      directives: {
        'default-src': ['self'],
        'script-src': ['self'],
        'style-src': ['self'],
        'font-src': ['self'],
        'img-src': ['self', 'data:', 'blob:', 'https://cdn.johorstudio.com'],
        'connect-src': ['self'],
        'worker-src': ['self'],
        'object-src': ['none'],
        'base-uri': ['self'],
        'form-action': ['self']
      }
    },
    alias: {
      '@gallery/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url))
    }
  }
};

export default config;
