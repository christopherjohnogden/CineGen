import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { buildMcpViewer } from '../scripts/build-mcp-viewer.mjs';
await buildMcpViewer();
await build({
  entryPoints: ['src/index.ts'], outfile: 'dist/worker.js', bundle: true,
  format: 'esm', platform: 'browser', target: 'es2022', minify: true,
  external: ['cloudflare:workers', 'node:*'],
  alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
});
