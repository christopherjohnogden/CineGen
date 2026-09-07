import type { ElevenLabsAudioRequest, ElevenLabsAudioResult, ElevenLabsPreview, ElevenLabsVoice } from './types';
const BACKEND = 'https://cinegen-api.christopherjohnogden.workers.dev';
export async function elevenLabsRpc<T>(method: string, params?: unknown): Promise<T> {
  const { waitForCloudAuth } = await import('@/lib/cloud/firebase');
  const user = await waitForCloudAuth();
  if (!user) throw new Error('Sign in to CineGen to connect ElevenLabs and save audio.');
  if (window.electronAPI?.elevenlabs) return await window.electronAPI.elevenlabs.request(method, params, await user.getIdToken()) as T;
  // Both the web app and the Mac app use the same encrypted account connection.
  const response = await fetch(`${BACKEND}/api/rpc/elevenlabs/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-cinegen-id-token': await user.getIdToken(), 'x-cinegen-origin': 'https://cinegen-film.vercel.app' },
    body: JSON.stringify({ args: params === undefined ? [] : [params] }), signal: AbortSignal.timeout(method === 'generate' || method === 'design' ? 240000 : 60000),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error?.message || 'ElevenLabs could not complete this request.');
  return data.result as T;
}
export const elevenLabs = {
  status: () => elevenLabsRpc<{ connected: boolean; connection?: 'mcp' | 'api-key' }>('accountStatus'),
  authLogin: () => elevenLabsRpc<{ attempt: string; authorizationUrl: string }>('authLogin'),
  authCancel: (attempt: string) => elevenLabsRpc('authCancel', { attempt }),
  authStatus: (attempt: string) => elevenLabsRpc<{ connected: boolean; error?: string }>('authStatus', { attempt }),
  connect: (secret: string) => elevenLabsRpc<{ connected: boolean }>('connect', { secret }),
  disconnect: () => elevenLabsRpc('disconnect'),
  voices: (search = '', cursor?: string) => elevenLabsRpc<{ voices: ElevenLabsVoice[]; cursor?: string }>('voices', { search, cursor }),
  generate: (params: ElevenLabsAudioRequest) => elevenLabsRpc<ElevenLabsAudioResult>('generate', params),
  job: (requestId: string) => elevenLabsRpc<ElevenLabsAudioResult>('job', { requestId }),
  design: (description: string, text?: string, language?: string) => elevenLabsRpc<{ previews: ElevenLabsPreview[]; text: string }>('design', { description, text, language }),
  saveVoice: (id: string, name: string, description: string, viewStateId?: string) => elevenLabsRpc<ElevenLabsVoice>('saveVoice', { id, name, description, viewStateId }),
};
