import { app } from 'electron';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

function resolvePackagedPath(modulePath: string): string {
  if (app.isPackaged) {
    return modulePath.replace('app.asar', 'app.asar.unpacked');
  }
  return modulePath;
}

export function getFfmpegPath(): string {
  const p = require('ffmpeg-static') as string;
  return resolvePackagedPath(p);
}

export function getFfprobePath(): string {
  const p = require('ffprobe-static').path as string;
  return resolvePackagedPath(p);
}

export function getFpcalcPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'vendor', 'fpcalc');
  }
  // In dev, compiled to dist-electron/main.js (flat bundle).
  // Go up one level to project root, then into vendor/fpcalc/.
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(thisDir, '..', 'vendor', 'fpcalc', 'fpcalc');
}
