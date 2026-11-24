// Bundle the Worker for miniflare tests the same way wrangler does for deploy.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  outfile: 'dist/index.mjs',
  sourcemap: false,
  logLevel: 'warning',
});
