import { build } from '../node_modules/esbuild/lib/main.js';
import { fileURLToPath } from 'node:url';
await build({entryPoints:[fileURLToPath(new URL('src/index.ts',import.meta.url))],outfile:fileURLToPath(new URL('dist/worker.js',import.meta.url)),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,external:['cloudflare:workers','node:*'],alias:{'@':fileURLToPath(new URL('../src',import.meta.url))}});
