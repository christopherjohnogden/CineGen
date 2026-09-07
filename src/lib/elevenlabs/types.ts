export interface ElevenLabsVoice { id: string; name: string; description?: string; previewUrl?: string }
export interface ElevenLabsAudioRequest {
  requestId: string;
  projectId?: string;
  kind: 'speech' | 'sound';
  text: string;
  voiceId?: string;
  direction?: string;
  durationSeconds?: number;
}
export interface ElevenLabsAudioResult {
  requestId: string;
  status: 'generating' | 'saving' | 'complete' | 'error';
  url?: string;
  assetId: string;
  error?: string;
}
export interface ElevenLabsPreview { id: string; url: string }
