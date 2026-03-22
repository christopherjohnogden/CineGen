import { ipcMain, dialog, shell, BrowserWindow } from 'electron';

export function registerFileSystemHandlers(): void {
  ipcMain.handle('dialog:show-save', async (_event, options?: {
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;

    const result = await dialog.showSaveDialog(win, {
      defaultPath: options?.defaultPath,
      filters: options?.filters,
    });

    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle('dialog:show-open', async (_event, options?: {
    filters?: { name: string; extensions: string[] }[];
    properties?: Array<'openFile' | 'openDirectory' | 'multiSelections'>;
  }) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      filters: options?.filters,
      properties: options?.properties as Array<'openFile' | 'openDirectory' | 'multiSelections'> ?? ['openFile'],
    });

    if (result.canceled) return null;
    // Return array when multiSelections is enabled, otherwise single path for backward compat
    if (options?.properties?.includes('multiSelections')) {
      return result.filePaths;
    }
    return result.filePaths[0];
  });

  ipcMain.handle('shell:open-path', async (_event, filePath: string) => {
    return await shell.openPath(filePath);
  });
}
