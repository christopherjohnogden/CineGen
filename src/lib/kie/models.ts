import type { ModelDefinition } from '@/types/workflow';

export const KIE_MODEL_REGISTRY: Record<string, ModelDefinition> = {
  'kie-runway': {
    id: 'runway', nodeType: 'kie-runway', name: 'Runway Gen-4',
    category: 'video', description: 'Runway Gen-4 Turbo video', outputType: 'video',
    provider: 'kie',
    responseMapping: { path: 'video_url' },
    inputs: [
      { id: 'prompt', portType: 'text', label: 'Prompt', required: true, falParam: 'prompt', fieldType: 'port' },
      { id: 'imageUrl', portType: 'image', label: 'Image', required: false, falParam: 'imageUrl', fieldType: 'port' },
      { id: 'duration', portType: 'number', label: 'Duration', required: false, falParam: 'duration', fieldType: 'select', default: '5', options: [
        { value: '5', label: '5s' }, { value: '10', label: '10s' },
      ]},
      { id: 'quality', portType: 'text', label: 'Quality', required: false, falParam: 'quality', fieldType: 'select', default: '720p', options: [
        { value: '720p', label: '720p' }, { value: '1080p', label: '1080p' },
      ]},
      { id: 'aspectRatio', portType: 'text', label: 'Aspect Ratio', required: false, falParam: 'aspectRatio', fieldType: 'select', default: '16:9', options: [
        { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' }, { value: '4:3', label: '4:3' }, { value: '3:4', label: '3:4' },
      ]},
    ],
  },
  'kie-veo3': {
    id: 'veo', nodeType: 'kie-veo3', name: 'Veo 3.1',
    category: 'video', description: 'Google Veo 3.1 video', outputType: 'video',
    provider: 'kie',
    responseMapping: { path: 'resultUrls.0' },
    inputs: [
      { id: 'prompt', portType: 'text', label: 'Prompt', required: true, falParam: 'prompt', fieldType: 'port' },
      { id: 'imageUrls', portType: 'image', label: 'Image', required: false, falParam: 'imageUrls', fieldType: 'port' },
      { id: 'model', portType: 'text', label: 'Model', required: false, falParam: 'model', fieldType: 'select', default: 'veo3_fast', options: [
        { value: 'veo3_fast', label: 'Fast' }, { value: 'veo3', label: 'Quality' },
      ]},
      { id: 'aspect_ratio', portType: 'text', label: 'Aspect Ratio', required: false, falParam: 'aspect_ratio', fieldType: 'select', default: '16:9', options: [
        { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: 'Auto', label: 'Auto' },
      ]},
    ],
  },
  'kie-flux2': {
    id: 'flux-2/pro-text-to-image', nodeType: 'kie-flux2', name: 'Flux 2 Pro',
    category: 'image', description: 'Flux 2 Pro via kie.ai', outputType: 'image',
    provider: 'kie',
    responseMapping: { path: 'resultUrls.0' },
    inputs: [
      { id: 'prompt', portType: 'text', label: 'Prompt', required: true, falParam: 'prompt', fieldType: 'port' },
      { id: 'aspect_ratio', portType: 'text', label: 'Aspect Ratio', required: false, falParam: 'aspect_ratio', fieldType: 'select', default: '16:9', options: [
        { value: '1:1', label: '1:1' }, { value: '4:3', label: '4:3' }, { value: '3:4', label: '3:4' }, { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' },
      ]},
      { id: 'resolution', portType: 'text', label: 'Resolution', required: false, falParam: 'resolution', fieldType: 'select', default: '1K', options: [
        { value: '1K', label: '1K' }, { value: '2K', label: '2K' },
      ]},
    ],
  },
  'kie-4o-image': {
    id: '4o-image', nodeType: 'kie-4o-image', name: '4o Image',
    category: 'image', description: 'GPT-4o image generation', outputType: 'image',
    provider: 'kie',
    responseMapping: { path: 'resultUrls.0' },
    inputs: [
      { id: 'prompt', portType: 'text', label: 'Prompt', required: true, falParam: 'prompt', fieldType: 'port' },
      { id: 'filesUrl', portType: 'image', label: 'Reference Image', required: false, falParam: 'filesUrl', fieldType: 'port' },
      { id: 'size', portType: 'text', label: 'Size', required: false, falParam: 'size', fieldType: 'select', default: '1:1', options: [
        { value: '1:1', label: '1:1' }, { value: '3:2', label: '3:2' }, { value: '2:3', label: '2:3' },
      ]},
    ],
  },
  'kie-wan': {
    id: 'wan/2-6-flash-image-to-video', nodeType: 'kie-wan', name: 'Wan 2.6 Flash',
    category: 'video', description: 'Wan 2.6 Flash image-to-video', outputType: 'video',
    provider: 'kie',
    responseMapping: { path: 'resultUrls.0' },
    inputs: [
      { id: 'prompt', portType: 'text', label: 'Prompt', required: true, falParam: 'prompt', fieldType: 'port' },
      { id: 'image_urls', portType: 'image', label: 'Image', required: true, falParam: 'image_urls', fieldType: 'port' },
      { id: 'duration', portType: 'number', label: 'Duration', required: false, falParam: 'duration', fieldType: 'select', default: '5', options: [
        { value: '5', label: '5s' }, { value: '10', label: '10s' }, { value: '15', label: '15s' },
      ]},
      { id: 'resolution', portType: 'text', label: 'Resolution', required: false, falParam: 'resolution', fieldType: 'select', default: '1080p', options: [
        { value: '720p', label: '720p' }, { value: '1080p', label: '1080p' },
      ]},
      { id: 'audio', portType: 'number', label: 'Audio', required: false, falParam: 'audio', fieldType: 'toggle', default: true },
    ],
  },
  'kie-kling3': {
    id: 'kling-3.0/video', nodeType: 'kie-kling3', name: 'Kling 3.0',
    category: 'video', description: 'Kling 3.0 text/image-to-video', outputType: 'video',
    provider: 'kie',
    responseMapping: { path: 'resultUrls.0' },
    inputs: [
      { id: 'prompt', portType: 'text', label: 'Prompt', required: true, falParam: 'prompt', fieldType: 'port' },
      { id: 'multi_prompt', portType: 'multi_prompt', label: 'Multi Prompt', required: false, falParam: 'multi_prompt', fieldType: 'port' },
      { id: 'image_urls', portType: 'image', label: 'First Frame', required: false, falParam: 'image_urls', fieldType: 'port' },
      { id: 'last_frame', portType: 'image', label: 'Last Frame', required: false, falParam: 'image_urls', fieldType: 'port' },
      { id: 'kling_elements', portType: 'image', label: 'Element', required: false, falParam: 'kling_elements', fieldType: 'element-list', max: 5 },
      { id: 'duration', portType: 'number', label: 'Duration', required: false, falParam: 'duration', fieldType: 'select', default: '5', options: [
        { value: '3', label: '3s' }, { value: '5', label: '5s' }, { value: '8', label: '8s' }, { value: '10', label: '10s' }, { value: '15', label: '15s' },
      ]},
      { id: 'aspect_ratio', portType: 'text', label: 'Aspect Ratio', required: false, falParam: 'aspect_ratio', fieldType: 'select', default: '16:9', options: [
        { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' },
      ]},
      { id: 'mode', portType: 'text', label: 'Mode', required: false, falParam: 'mode', fieldType: 'select', default: 'pro', options: [
        { value: 'std', label: 'Standard' }, { value: 'pro', label: 'Pro' },
      ]},
      { id: 'sound', portType: 'number', label: 'Sound', required: false, falParam: 'sound', fieldType: 'toggle', default: true },
    ],
  },
  'kie-nano-banana-pro': {
    id: 'nano-banana-pro', nodeType: 'kie-nano-banana-pro', name: 'Nano Banana Pro',
    category: 'image', description: 'Gemini 3 Pro image generation', outputType: 'image',
    provider: 'kie',
    responseMapping: { path: 'resultUrls.0' },
    inputs: [
      { id: 'prompt', portType: 'text', label: 'Prompt', required: true, falParam: 'prompt', fieldType: 'port' },
      { id: 'image_input', portType: 'image', label: 'Image 1', required: false, falParam: 'image_input', fieldType: 'port' },
      { id: 'extra_images', portType: 'image', label: 'Image', required: false, falParam: 'image_input', fieldType: 'element-list', max: 8 },
      { id: 'aspect_ratio', portType: 'text', label: 'Aspect Ratio', required: false, falParam: 'aspect_ratio', fieldType: 'select', default: '1:1', options: [
        { value: '1:1', label: '1:1' }, { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '4:3', label: '4:3' }, { value: '3:4', label: '3:4' },
      ]},
      { id: 'resolution', portType: 'text', label: 'Resolution', required: false, falParam: 'resolution', fieldType: 'select', default: '1K', options: [
        { value: '1K', label: '1K' }, { value: '2K', label: '2K' }, { value: '4K', label: '4K' },
      ]},
    ],
  },
  'kie-nano-banana-2': {
    id: 'nano-banana-2', nodeType: 'kie-nano-banana-2', name: 'Nano Banana 2',
    category: 'image', description: 'Gemini 3.1 Flash image generation', outputType: 'image',
    provider: 'kie',
    responseMapping: { path: 'resultUrls.0' },
    inputs: [
      { id: 'prompt', portType: 'text', label: 'Prompt', required: true, falParam: 'prompt', fieldType: 'port' },
      { id: 'image_input', portType: 'image', label: 'Image 1', required: false, falParam: 'image_input', fieldType: 'port' },
      { id: 'extra_images', portType: 'image', label: 'Image', required: false, falParam: 'image_input', fieldType: 'element-list', max: 14 },
      { id: 'aspect_ratio', portType: 'text', label: 'Aspect Ratio', required: false, falParam: 'aspect_ratio', fieldType: 'select', default: 'auto', options: [
        { value: 'auto', label: 'Auto' }, { value: '1:1', label: '1:1' }, { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' },
      ]},
      { id: 'resolution', portType: 'text', label: 'Resolution', required: false, falParam: 'resolution', fieldType: 'select', default: '1K', options: [
        { value: '1K', label: '1K' }, { value: '2K', label: '2K' }, { value: '4K', label: '4K' },
      ]},
    ],
  },
  'kie-seedance2': {
    id: 'bytedance/seedance-2-image-to-video', nodeType: 'kie-seedance2', name: 'Seedance 2',
    category: 'video', description: 'ByteDance Seedance 2.0 image-to-video', outputType: 'video',
    provider: 'kie',
    responseMapping: { path: 'resultUrls.0' },
    inputs: [
      { id: 'prompt', portType: 'text', label: 'Prompt', required: true, falParam: 'prompt', fieldType: 'port' },
      { id: 'urls', portType: 'image', label: 'Image', required: false, falParam: 'urls', fieldType: 'port' },
      { id: 'duration', portType: 'number', label: 'Duration', required: false, falParam: 'duration', fieldType: 'select', default: '5', options: [
        { value: '4', label: '4s' }, { value: '5', label: '5s' }, { value: '8', label: '8s' }, { value: '12', label: '12s' }, { value: '15', label: '15s' },
      ]},
      { id: 'resolution', portType: 'text', label: 'Resolution', required: false, falParam: 'resolution', fieldType: 'select', default: '720p', options: [
        { value: '480p', label: '480p' }, { value: '720p', label: '720p' },
      ]},
      { id: 'aspect_ratio', portType: 'text', label: 'Aspect Ratio', required: false, falParam: 'aspect_ratio', fieldType: 'select', default: '16:9', options: [
        { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' }, { value: '4:3', label: '4:3' }, { value: '3:4', label: '3:4' },
      ]},
      { id: 'generate_audio', portType: 'number', label: 'Audio', required: false, falParam: 'generate_audio', fieldType: 'toggle', default: false },
      { id: 'fixed_lens', portType: 'number', label: 'Fixed Lens', required: false, falParam: 'fixed_lens', fieldType: 'toggle', default: false },
    ],
  },
  'kie-suno-music': {
    id: 'suno-music', nodeType: 'kie-suno-music', name: 'Suno Music',
    category: 'audio', description: 'AI music generation via Suno', outputType: 'audio',
    provider: 'kie',
    responseMapping: { path: 'data.0.audio_url' },
    inputs: [
      { id: 'prompt', portType: 'text', label: 'Lyrics / Description', required: true, falParam: 'prompt', fieldType: 'port' },
      { id: 'style', portType: 'text', label: 'Style', required: false, falParam: 'style', fieldType: 'textarea' },
      { id: 'title', portType: 'text', label: 'Title', required: false, falParam: 'title', fieldType: 'text' },
      { id: 'model', portType: 'text', label: 'Model', required: false, falParam: 'model', fieldType: 'select', default: 'V4', options: [
        { value: 'V4', label: 'V4' }, { value: 'V4_5', label: 'V4.5' }, { value: 'V4_5PLUS', label: 'V4.5+' }, { value: 'V4_5ALL', label: 'V4.5 All' }, { value: 'V5', label: 'V5' },
      ]},
      { id: 'customMode', portType: 'number', label: 'Custom Mode', required: false, falParam: 'customMode', fieldType: 'toggle', default: true },
      { id: 'instrumental', portType: 'number', label: 'Instrumental', required: false, falParam: 'instrumental', fieldType: 'toggle', default: false },
    ],
  },
};
