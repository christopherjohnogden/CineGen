export function useElectron() {
  const api = window.electronAPI;
  if (!api) throw new Error('Not running in Electron');
  return api;
}
