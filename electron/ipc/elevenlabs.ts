import { ipcMain, shell } from 'electron';
const METHODS = new Set(['authCancel', 'authLogin', 'authStatus', 'accountStatus', 'connect', 'disconnect', 'voices', 'generate', 'job', 'design', 'saveVoice']);
export function registerElevenLabsHandlers() {
  ipcMain.handle('elevenlabs:request', async (_event, method: string, params: unknown, token: string) => {
    if (!METHODS.has(method) || typeof token !== 'string' || !token || token.length > 12000) throw new Error('Invalid ElevenLabs request.');
    const response = await fetch(`https://cinegen-api.christopherjohnogden.workers.dev/api/rpc/elevenlabs/${method}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-cinegen-id-token': token, 'x-cinegen-origin': 'https://cinegen-film.vercel.app' }, body: JSON.stringify({ args: params === undefined ? [] : [params] }), signal: AbortSignal.timeout(240000) });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error?.message || 'ElevenLabs could not complete this request.');
    if (method === 'authLogin') {
      const url = new URL(data.result.authorizationUrl);
      if (url.origin !== 'https://cinegen-api.christopherjohnogden.workers.dev' || url.pathname !== '/api/elevenlabs/oauth/start') throw new Error('Invalid ElevenLabs sign-in address.');
      await shell.openExternal(url.href);
    }
    return data.result;
  });
}
