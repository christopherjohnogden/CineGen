import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root:fileURLToPath(new URL('.',import.meta.url)),
  plugins:[react()],
  resolve:{alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},dedupe:['react','react-dom']},
  build:{outDir:'dist',emptyOutDir:true},
  define:{'import.meta.env.VITE_CINEGEN_UPLOAD_ORIGIN':JSON.stringify('https://cinegen-api.christopherjohnogden.workers.dev')},
});
