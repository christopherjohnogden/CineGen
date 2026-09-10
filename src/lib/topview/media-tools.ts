import { topviewMediaToolUnavailable as unavailable, buildTopviewMediaToolRequest as buildRequest } from './media-tool-request.mjs';
import type { ModelDefinition } from '@/types/workflow';

export const TOPVIEW_MEDIA_TOOL_NAMES = ['Avatar 4', 'Avatar 4 Fast', 'Video Lip Sync', 'Image Upscale', 'Video Upscale'] as const;
export type TopviewMediaTool = typeof TOPVIEW_MEDIA_TOOL_NAMES[number];
type Media = { value: string; role?: string; fileId?: string };

export function isTopviewMediaTool(value: unknown): value is TopviewMediaTool {
  return TOPVIEW_MEDIA_TOOL_NAMES.includes(value as TopviewMediaTool);
}

export function topviewMediaToolUnavailable(model: TopviewMediaTool, tools?: string[], apiKey = false): string | undefined {
  return unavailable(model, tools, apiKey);
}

/** Separate models, appended to the catalog: never a post-generation side effect. */
export function topviewMediaToolDefinitions(tools?: string[], apiKey = false): ModelDefinition[] {
  return TOPVIEW_MEDIA_TOOL_NAMES.map(name => {
    const image = name === 'Image Upscale';
    const videoInput = name === 'Video Lip Sync' || name === 'Video Upscale';
    const avatar = name.startsWith('Avatar');
    const audio = avatar || name === 'Video Lip Sync';
    return {
      id: `topview/${image ? 'image' : 'video'}/${name}`,
      nodeType: `topview-${image ? 'image' : 'video'}-${name.toLowerCase().replaceAll(' ', '-')}`,
      name, category: image ? 'image-edit' : 'video', outputType: image ? 'image' : 'video', provider: 'topview',
      description: avatar ? 'Create a talking video from one character image and one audio file. Optional motion direction.'
        : name === 'Video Lip Sync' ? 'Sync one existing video to one audio file. Runs only when selected.'
        : 'Optional Topview upscaling. Currently unavailable through the connected integration.',
      unavailableReason: topviewMediaToolUnavailable(name, tools, apiKey),
      responseMapping: { path: 'url' },
      inputs: [
        { id: 'prompt', portType: 'text', label: avatar ? 'Motion direction (optional)' : 'Notes (optional)', required: false, falParam: 'prompt', fieldType: 'port', description: avatar ? 'Expressions and movement, up to 600 characters. Dialogue comes from the audio.' : 'Notes are kept in CineGen.' },
        { id: 'image_url', portType: 'media', label: videoInput ? 'Source video' : 'Source image', required: false, falParam: 'reference_images', fieldType: 'element-list', multiple: true, max: 1, maxItems: 1, mediaRole: 'image', description: `Choose exactly one ${videoInput ? 'video' : 'image'}.` },
        ...(audio ? [{ id: 'audio_references', portType: 'audio' as const, label: 'Dialogue audio', required: false, falParam: 'audio_urls', fieldType: 'port' as const, multiple: true, maxItems: 1, mediaRole: 'audio' as const, description: 'One audio file, including an ElevenLabs output.' }] : []),
      ],
    };
  });
}

export function buildTopviewMediaToolRequest(model: TopviewMediaTool, prompt: string, media: Media[], boardId?: string): { taskType: 'avatar_video' | 'lip_sync'; request: Record<string, unknown> } {
  return buildRequest(model, prompt, media, boardId) as { taskType: 'avatar_video' | 'lip_sync'; request: Record<string, unknown> };
}
