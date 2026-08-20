/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Plugin to copy static files (e.g., splash.html) to dist-electron
function copyElectronStaticFiles() {
  return {
    name: 'copy-electron-static',
    writeBundle() {
      const staticFiles = ['splash.html', 'splash-bg.png', 'Outfit-Variable.woff2'];
      for (const file of staticFiles) {
        const src = path.resolve(__dirname, `electron/${file}`);
        const dest = path.resolve(__dirname, `dist-electron/${file}`);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
        }
      }
    },
  };
}

// Plugin to force-rebuild preload as CJS after vite-plugin-electron writes ESM
// (vite-plugin-electron forces ESM when package.json has "type": "module")
function forcePreloadCJS() {
  return {
    name: 'force-preload-cjs',
    writeBundle() {
      const preloadPath = path.resolve(__dirname, 'dist-electron/preload.js');
      if (!fs.existsSync(preloadPath)) return;
      const content = fs.readFileSync(preloadPath, 'utf-8');
      if (!content.startsWith('import ')) return; // already CJS
      execFileSync('npx', [
        'esbuild', 'electron/preload.ts',
        '--bundle', '--platform=node', '--format=cjs',
        '--external:electron',
        `--outfile=dist-electron/preload.js`,
      ], { cwd: __dirname, stdio: 'pipe' });
    },
  };
}

const isTest = !!process.env.VITEST;

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron', 'better-sqlite3', 'ffmpeg-static', 'ffprobe-static'],
            },
          },
          resolve: {
            alias: {
              '@': path.resolve(__dirname, 'src'),
            },
          },
          plugins: [copyElectronStaticFiles()],
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart({ reload }) {
          reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: {
              entry: 'electron/preload.ts',
              formats: ['cjs'],
            },
            rollupOptions: {
              external: ['electron'],
              output: {
                format: 'cjs',
                entryFileNames: 'preload.js',
              },
            },
          },
          plugins: [forcePreloadCJS()],
        },
      },
      {
        entry: 'electron/workers/media-worker.ts',
        vite: {
          build: {
            outDir: 'dist-electron/workers',
            rollupOptions: {
              external: ['electron', 'better-sqlite3', 'ffmpeg-static', 'ffprobe-static'],
            },
          },
        },
      },
    ]),
    ...(isTest ? [] : [renderer()]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  base: './',
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    environmentMatchGlobs: [
      ['tests/electron/**', 'node'],
    ],
  },
});
