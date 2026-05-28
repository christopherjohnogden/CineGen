import { ipcMain } from 'electron';
import { detectAllCliProviders } from './cli-llm-shared.js';

export function registerCliLlmDetectHandlers(): void {
  ipcMain.handle('llm:cli-detect', async () => {
    const providers = await detectAllCliProviders();
    return { providers };
  });
}
