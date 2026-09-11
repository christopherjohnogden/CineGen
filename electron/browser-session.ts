import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function configureBrowserSession(): void {
  if (app.isPackaged) return;
  // Development and the installed app can run together. Chromium cannot safely
  // share their cookie/localStorage databases, even though project files and
  // provider settings still belong in the same CineGen userData directory.
  const sessionPath = path.join(app.getPath('userData'), 'dev-browser-session');
  mkdirSync(sessionPath, { recursive: true });
  app.setPath('sessionData', sessionPath);
}
