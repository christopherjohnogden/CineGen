import type { Element } from '@/types/elements';
import type { ElevenLabsAudioRequest } from './types';
export function audioRequestFromNode(config: Record<string, unknown>, character?: Element, projectId?: string): ElevenLabsAudioRequest {
  return { requestId: String(config.audioRequestId || crypto.randomUUID()), projectId, kind: config.kind === 'sound' ? 'sound' : 'speech', text: String(config.text || ''), voiceId: String(config.voiceId || character?.voice?.voiceId || ''), direction: String(config.direction || ''), ...(config.durationSeconds ? { durationSeconds: Number(config.durationSeconds) } : {}) };
}
