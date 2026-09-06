import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
await build({
  entryPoints: ['src/index.ts'], outfile: 'dist/worker.js', bundle: true,
  format: 'esm', platform: 'browser', target: 'es2022', minify: true,
  external: ['cloudflare:workers', 'node:*'],
  alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
});
