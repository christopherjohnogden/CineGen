import { ipcMain } from 'electron';
export function registerPromptHandlers() {
  ipcMain.handle('prompts:rewrite', async (_event, params: unknown, token: string) => {
    if (typeof token !== 'string' || !token || token.length > 12000) throw new Error('Sign in to CineGen to edit prompts with AI.');
    const response = await fetch('https://cinegen-api.christopherjohnogden.workers.dev/api/rpc/prompts/rewrite', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-cinegen-id-token': token, 'x-cinegen-origin': 'https://cinegen-film.vercel.app' },
      body: JSON.stringify({ args: [params] }), signal: AbortSignal.timeout(240000),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error?.message || 'The AI editor could not connect. Try again to recover this rewrite.');
    return data.result;
  });
}
