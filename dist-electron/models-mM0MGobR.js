const KIE_MODEL_REGISTRY = {
  "kie-runway": {
    id: "runway",
    nodeType: "kie-runway",
    name: "Runway Gen-4",
    category: "video",
    description: "Runway Gen-4 Turbo video",
    outputType: "video",
    provider: "kie",
    responseMapping: { path: "video_url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "imageUrl", portType: "image", label: "Image", required: false, falParam: "imageUrl", fieldType: "port" },
      { id: "duration", portType: "number", label: "Duration", required: false, falParam: "duration", fieldType: "select", default: "5", options: [
        { value: "5", label: "5s" },
        { value: "10", label: "10s" }
      ] },
      { id: "quality", portType: "text", label: "Quality", required: false, falParam: "quality", fieldType: "select", default: "720p", options: [
        { value: "720p", label: "720p" },
        { value: "1080p", label: "1080p" }
      ] },
      { id: "aspectRatio", portType: "text", label: "Aspect Ratio", required: false, falParam: "aspectRatio", fieldType: "select", default: "16:9", options: [
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" },
        { value: "1:1", label: "1:1" },
        { value: "4:3", label: "4:3" },
        { value: "3:4", label: "3:4" }
      ] }
    ]
  },
  "kie-veo3": {
    id: "veo",
    nodeType: "kie-veo3",
    name: "Veo 3.1",
    category: "video",
    description: "Google Veo 3.1 video",
    outputType: "video",
    provider: "kie",
    responseMapping: { path: "resultUrls.0" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "imageUrls", portType: "image", label: "Image", required: false, falParam: "imageUrls", fieldType: "port" },
      { id: "model", portType: "text", label: "Model", required: false, falParam: "model", fieldType: "select", default: "veo3_fast", options: [
        { value: "veo3_fast", label: "Fast" },
        { value: "veo3", label: "Quality" }
      ] },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: false, falParam: "aspect_ratio", fieldType: "select", default: "16:9", options: [
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" },
        { value: "Auto", label: "Auto" }
      ] }
    ]
  },
  "kie-flux2": {
    id: "flux-2/pro-text-to-image",
    nodeType: "kie-flux2",
    name: "Flux 2 Pro",
    category: "image",
    description: "Flux 2 Pro via kie.ai",
    outputType: "image",
    provider: "kie",
    responseMapping: { path: "resultUrls.0" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: false, falParam: "aspect_ratio", fieldType: "select", default: "16:9", options: [
        { value: "1:1", label: "1:1" },
        { value: "4:3", label: "4:3" },
        { value: "3:4", label: "3:4" },
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" }
      ] },
      { id: "resolution", portType: "text", label: "Resolution", required: false, falParam: "resolution", fieldType: "select", default: "1K", options: [
        { value: "1K", label: "1K" },
        { value: "2K", label: "2K" }
      ] }
    ]
  },
  "kie-4o-image": {
    id: "4o-image",
    nodeType: "kie-4o-image",
    name: "4o Image",
    category: "image",
    description: "GPT-4o image generation",
    outputType: "image",
    provider: "kie",
    responseMapping: { path: "resultUrls.0" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "filesUrl", portType: "image", label: "Reference Image", required: false, falParam: "filesUrl", fieldType: "port" },
      { id: "size", portType: "text", label: "Size", required: false, falParam: "size", fieldType: "select", default: "1:1", options: [
        { value: "1:1", label: "1:1" },
        { value: "3:2", label: "3:2" },
        { value: "2:3", label: "2:3" }
      ] }
    ]
  },
  "kie-wan": {
    id: "wan/2-6-flash-image-to-video",
    nodeType: "kie-wan",
    name: "Wan 2.6 Flash",
    category: "video",
    description: "Wan 2.6 Flash image-to-video",
    outputType: "video",
    provider: "kie",
    responseMapping: { path: "resultUrls.0" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "image_urls", portType: "image", label: "Image", required: true, falParam: "image_urls", fieldType: "port" },
      { id: "duration", portType: "number", label: "Duration", required: false, falParam: "duration", fieldType: "select", default: "5", options: [
        { value: "5", label: "5s" },
        { value: "10", label: "10s" },
        { value: "15", label: "15s" }
      ] },
      { id: "resolution", portType: "text", label: "Resolution", required: false, falParam: "resolution", fieldType: "select", default: "1080p", options: [
        { value: "720p", label: "720p" },
        { value: "1080p", label: "1080p" }
      ] },
      { id: "audio", portType: "number", label: "Audio", required: false, falParam: "audio", fieldType: "toggle", default: true }
    ]
  },
  "kie-kling3": {
    id: "kling-3.0/video",
    nodeType: "kie-kling3",
    name: "Kling 3.0",
    category: "video",
    description: "Kling 3.0 text/image-to-video",
    outputType: "video",
    provider: "kie",
    responseMapping: { path: "resultUrls.0" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "multi_prompt", portType: "multi_prompt", label: "Multi Prompt", required: false, falParam: "multi_prompt", fieldType: "port" },
      { id: "image_urls", portType: "image", label: "First Frame", required: false, falParam: "image_urls", fieldType: "port" },
      { id: "last_frame", portType: "image", label: "Last Frame", required: false, falParam: "image_urls", fieldType: "port" },
      { id: "kling_elements", portType: "image", label: "Element", required: false, falParam: "kling_elements", fieldType: "element-list", max: 5 },
      { id: "duration", portType: "number", label: "Duration", required: false, falParam: "duration", fieldType: "select", default: "5", options: [
        { value: "3", label: "3s" },
        { value: "5", label: "5s" },
        { value: "8", label: "8s" },
        { value: "10", label: "10s" },
        { value: "15", label: "15s" }
      ] },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: false, falParam: "aspect_ratio", fieldType: "select", default: "16:9", options: [
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" },
        { value: "1:1", label: "1:1" }
      ] },
      { id: "mode", portType: "text", label: "Mode", required: false, falParam: "mode", fieldType: "select", default: "pro", options: [
        { value: "std", label: "Standard" },
        { value: "pro", label: "Pro" }
      ] },
      { id: "sound", portType: "number", label: "Sound", required: false, falParam: "sound", fieldType: "toggle", default: true }
    ]
  },
  "kie-nano-banana-pro": {
    id: "nano-banana-pro",
    nodeType: "kie-nano-banana-pro",
    name: "Nano Banana Pro",
    category: "image",
    description: "Gemini 3 Pro image generation",
    outputType: "image",
    provider: "kie",
    responseMapping: { path: "resultUrls.0" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "image_input", portType: "image", label: "Image 1", required: false, falParam: "image_input", fieldType: "port" },
      { id: "extra_images", portType: "image", label: "Image", required: false, falParam: "image_input", fieldType: "element-list", max: 8 },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: false, falParam: "aspect_ratio", fieldType: "select", default: "1:1", options: [
        { value: "1:1", label: "1:1" },
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" },
        { value: "4:3", label: "4:3" },
        { value: "3:4", label: "3:4" }
      ] },
      { id: "resolution", portType: "text", label: "Resolution", required: false, falParam: "resolution", fieldType: "select", default: "1K", options: [
        { value: "1K", label: "1K" },
        { value: "2K", label: "2K" },
        { value: "4K", label: "4K" }
      ] }
    ]
  },
  "kie-nano-banana-2": {
    id: "nano-banana-2",
    nodeType: "kie-nano-banana-2",
    name: "Nano Banana 2",
    category: "image",
    description: "Gemini 3.1 Flash image generation",
    outputType: "image",
    provider: "kie",
    responseMapping: { path: "resultUrls.0" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "image_input", portType: "image", label: "Image 1", required: false, falParam: "image_input", fieldType: "port" },
      { id: "extra_images", portType: "image", label: "Image", required: false, falParam: "image_input", fieldType: "element-list", max: 14 },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: false, falParam: "aspect_ratio", fieldType: "select", default: "auto", options: [
        { value: "auto", label: "Auto" },
        { value: "1:1", label: "1:1" },
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" }
      ] },
      { id: "resolution", portType: "text", label: "Resolution", required: false, falParam: "resolution", fieldType: "select", default: "1K", options: [
        { value: "1K", label: "1K" },
        { value: "2K", label: "2K" },
        { value: "4K", label: "4K" }
      ] }
    ]
  },
  "kie-seedance2": {
    id: "bytedance/seedance-2-image-to-video",
    nodeType: "kie-seedance2",
    name: "Seedance 2",
    category: "video",
    description: "ByteDance Seedance 2.0 image-to-video",
    outputType: "video",
    provider: "kie",
    responseMapping: { path: "resultUrls.0" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "urls", portType: "image", label: "Image", required: false, falParam: "urls", fieldType: "port" },
      { id: "duration", portType: "number", label: "Duration", required: false, falParam: "duration", fieldType: "select", default: "5", options: [
        { value: "4", label: "4s" },
        { value: "5", label: "5s" },
        { value: "8", label: "8s" },
        { value: "12", label: "12s" },
        { value: "15", label: "15s" }
      ] },
      { id: "resolution", portType: "text", label: "Resolution", required: false, falParam: "resolution", fieldType: "select", default: "720p", options: [
        { value: "480p", label: "480p" },
        { value: "720p", label: "720p" }
      ] },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: false, falParam: "aspect_ratio", fieldType: "select", default: "16:9", options: [
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" },
        { value: "1:1", label: "1:1" },
        { value: "4:3", label: "4:3" },
        { value: "3:4", label: "3:4" }
      ] },
      { id: "generate_audio", portType: "number", label: "Audio", required: false, falParam: "generate_audio", fieldType: "toggle", default: false },
      { id: "fixed_lens", portType: "number", label: "Fixed Lens", required: false, falParam: "fixed_lens", fieldType: "toggle", default: false }
    ]
  },
  "kie-suno-music": {
    id: "suno-music",
    nodeType: "kie-suno-music",
    name: "Suno Music",
    category: "audio",
    description: "AI music generation via Suno",
    outputType: "audio",
    provider: "kie",
    responseMapping: { path: "data.0.audio_url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Lyrics / Description", required: true, falParam: "prompt", fieldType: "port" },
      { id: "style", portType: "text", label: "Style", required: false, falParam: "style", fieldType: "textarea" },
      { id: "title", portType: "text", label: "Title", required: false, falParam: "title", fieldType: "text" },
      { id: "model", portType: "text", label: "Model", required: false, falParam: "model", fieldType: "select", default: "V4", options: [
        { value: "V4", label: "V4" },
        { value: "V4_5", label: "V4.5" },
        { value: "V4_5PLUS", label: "V4.5+" },
        { value: "V4_5ALL", label: "V4.5 All" },
        { value: "V5", label: "V5" }
      ] },
      { id: "customMode", portType: "number", label: "Custom Mode", required: false, falParam: "customMode", fieldType: "toggle", default: true },
      { id: "instrumental", portType: "number", label: "Instrumental", required: false, falParam: "instrumental", fieldType: "toggle", default: false }
    ]
  }
};
const MODEL_REGISTRY = {
  "flux-dev": {
    id: "fal-ai/flux/dev",
    nodeType: "flux-dev",
    name: "FLUX Dev",
    category: "image",
    description: "High quality image generation",
    outputType: "image",
    responseMapping: { path: "images[0].url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "image_size", portType: "text", label: "Size", required: false, falParam: "image_size", fieldType: "select", default: "landscape_4_3", options: [
        { value: "square_hd", label: "1024x1024" },
        { value: "square", label: "512x512" },
        { value: "portrait_4_3", label: "Portrait 4:3" },
        { value: "portrait_16_9", label: "Portrait 16:9" },
        { value: "landscape_4_3", label: "Landscape 4:3" },
        { value: "landscape_16_9", label: "Landscape 16:9" }
      ] },
      { id: "seed", portType: "number", label: "Seed", required: false, falParam: "seed", fieldType: "number", default: -1 },
      { id: "guidance_scale", portType: "number", label: "Guidance", required: false, falParam: "guidance_scale", fieldType: "range", default: 3.5, min: 0, max: 20, step: 0.5 },
      { id: "num_inference_steps", portType: "number", label: "Steps", required: false, falParam: "num_inference_steps", fieldType: "range", default: 28, min: 1, max: 50, step: 1 }
    ]
  },
  "flux-2-max": {
    id: "fal-ai/flux-2/max",
    nodeType: "flux-2-max",
    name: "FLUX 2 Max",
    category: "image",
    description: "Latest FLUX model",
    outputType: "image",
    responseMapping: { path: "images[0].url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "image_size", portType: "text", label: "Size", required: false, falParam: "image_size", fieldType: "select", default: "landscape_4_3", options: [
        { value: "square_hd", label: "1024x1024" },
        { value: "square", label: "512x512" },
        { value: "portrait_4_3", label: "Portrait 4:3" },
        { value: "portrait_16_9", label: "Portrait 16:9" },
        { value: "landscape_4_3", label: "Landscape 4:3" },
        { value: "landscape_16_9", label: "Landscape 16:9" }
      ] },
      { id: "seed", portType: "number", label: "Seed", required: false, falParam: "seed", fieldType: "number", default: -1 },
      { id: "guidance_scale", portType: "number", label: "Guidance", required: false, falParam: "guidance_scale", fieldType: "range", default: 3.5, min: 0, max: 20, step: 0.5 }
    ]
  },
  "fast-sdxl": {
    id: "fal-ai/fast-sdxl",
    nodeType: "fast-sdxl",
    name: "Fast SDXL",
    category: "image",
    description: "Fast image generation",
    outputType: "image",
    responseMapping: { path: "images[0].url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "image_size", portType: "text", label: "Size", required: false, falParam: "image_size", fieldType: "select", default: "landscape_4_3", options: [
        { value: "square_hd", label: "1024x1024" },
        { value: "square", label: "512x512" },
        { value: "portrait_4_3", label: "Portrait 4:3" },
        { value: "landscape_4_3", label: "Landscape 4:3" }
      ] },
      { id: "seed", portType: "number", label: "Seed", required: false, falParam: "seed", fieldType: "number", default: -1 },
      { id: "guidance_scale", portType: "number", label: "Guidance", required: false, falParam: "guidance_scale", fieldType: "range", default: 7.5, min: 0, max: 20, step: 0.5 },
      { id: "num_inference_steps", portType: "number", label: "Steps", required: false, falParam: "num_inference_steps", fieldType: "range", default: 25, min: 1, max: 50, step: 1 }
    ]
  },
  "sd3-medium": {
    id: "fal-ai/stable-diffusion-v3-medium",
    nodeType: "sd3-medium",
    name: "SD3 Medium",
    category: "image",
    description: "Stable Diffusion 3 Medium",
    outputType: "image",
    responseMapping: { path: "images[0].url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "seed", portType: "number", label: "Seed", required: false, falParam: "seed", fieldType: "number", default: -1 },
      { id: "guidance_scale", portType: "number", label: "Guidance", required: false, falParam: "guidance_scale", fieldType: "range", default: 5, min: 0, max: 20, step: 0.5 },
      { id: "num_inference_steps", portType: "number", label: "Steps", required: false, falParam: "num_inference_steps", fieldType: "range", default: 28, min: 1, max: 50, step: 1 }
    ]
  },
  "flux-kontext": {
    id: "fal-ai/flux-kontext/text-to-image",
    nodeType: "flux-kontext",
    name: "Flux Kontext",
    category: "image-edit",
    description: "Image editing with text",
    outputType: "image",
    responseMapping: { path: "images[0].url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "Image", required: false, falParam: "image_url", fieldType: "port" },
      { id: "seed", portType: "number", label: "Seed", required: false, falParam: "seed", fieldType: "number", default: -1 }
    ]
  },
  "nano-banana-pro": {
    id: "fal-ai/nano-banana-pro",
    altId: "fal-ai/nano-banana-pro/edit",
    nodeType: "nano-banana-pro",
    name: "Nano Banana Pro",
    category: "image",
    description: "Image generation and editing",
    outputType: "image",
    responseMapping: { path: "images[0].url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "Image 1", required: false, falParam: "image_urls", fieldType: "port" },
      { id: "extra_images", portType: "image", label: "Image", required: false, falParam: "image_urls", fieldType: "element-list", max: 13 },
      { id: "resolution", portType: "text", label: "Resolution", required: false, falParam: "resolution", fieldType: "select", default: "1K", options: [
        { value: "1K", label: "1K" },
        { value: "2K", label: "2K" },
        { value: "4K", label: "4K" }
      ] },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: false, falParam: "aspect_ratio", fieldType: "select", default: "1:1", options: [
        { value: "1:1", label: "1:1" },
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" },
        { value: "4:3", label: "4:3" },
        { value: "3:4", label: "3:4" }
      ] },
      { id: "seed", portType: "number", label: "Seed", required: false, falParam: "seed", fieldType: "number", default: -1 }
    ]
  },
  "nano-banana-2": {
    id: "fal-ai/nano-banana-2",
    altId: "fal-ai/nano-banana-2/edit",
    nodeType: "nano-banana-2",
    name: "Nano Banana 2",
    category: "image",
    description: "Google Gemini 3.1 Flash",
    outputType: "image",
    responseMapping: { path: "images[0].url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "Image 1", required: false, falParam: "image_urls", fieldType: "port" },
      { id: "extra_images", portType: "image", label: "Image", required: false, falParam: "image_urls", fieldType: "element-list", max: 13 },
      { id: "resolution", portType: "text", label: "Resolution", required: false, falParam: "resolution", fieldType: "select", default: "1K", options: [
        { value: "0.5K", label: "0.5K" },
        { value: "1K", label: "1K" },
        { value: "2K", label: "2K" },
        { value: "4K", label: "4K" }
      ] },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: false, falParam: "aspect_ratio", fieldType: "select", default: "auto", options: [
        { value: "auto", label: "Auto" },
        { value: "1:1", label: "1:1" },
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" }
      ] },
      { id: "seed", portType: "number", label: "Seed", required: false, falParam: "seed", fieldType: "number", default: -1 }
    ]
  },
  "veo-3-1": {
    id: "fal-ai/veo3.1",
    nodeType: "veo-3-1",
    name: "Veo 3.1",
    category: "video",
    description: "Google Veo video generation",
    outputType: "video",
    responseMapping: { path: "video.url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "duration", portType: "text", label: "Duration", required: false, falParam: "duration", fieldType: "select", default: "8s", options: [
        { value: "4s", label: "4s" },
        { value: "6s", label: "6s" },
        { value: "8s", label: "8s" }
      ] },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: false, falParam: "aspect_ratio", fieldType: "select", default: "16:9", options: [
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" },
        { value: "1:1", label: "1:1" }
      ] },
      { id: "resolution", portType: "text", label: "Resolution", required: false, falParam: "resolution", fieldType: "select", default: "720p", options: [
        { value: "720p", label: "720p" },
        { value: "1080p", label: "1080p" }
      ] },
      { id: "generate_audio", portType: "number", label: "Generate Audio", required: false, falParam: "generate_audio", fieldType: "toggle", default: true }
    ]
  },
  "kling-3-text": {
    id: "fal-ai/kling-video/v3/pro/text-to-video",
    nodeType: "kling-3-text",
    name: "Kling 3",
    category: "video",
    description: "Kling 3.0 text-to-video",
    outputType: "video",
    responseMapping: { path: "video.url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "multi_prompt", portType: "multi_prompt", label: "Multi Prompt", required: false, falParam: "multi_prompt", fieldType: "port" },
      { id: "negative_prompt", portType: "text", label: "Negative Prompt", required: false, falParam: "negative_prompt", fieldType: "port" },
      { id: "elements", portType: "image", label: "Element", required: false, falParam: "elements", fieldType: "element-list", max: 5 },
      { id: "duration", portType: "number", label: "Duration", required: false, falParam: "duration", fieldType: "select", default: "5", options: [
        { value: "3", label: "3s" },
        { value: "5", label: "5s" },
        { value: "8", label: "8s" },
        { value: "10", label: "10s" },
        { value: "15", label: "15s" }
      ] },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: false, falParam: "aspect_ratio", fieldType: "select", default: "16:9", options: [
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" },
        { value: "1:1", label: "1:1" }
      ] },
      { id: "generate_audio", portType: "number", label: "Generate Audio", required: false, falParam: "generate_audio", fieldType: "toggle", default: true },
      { id: "cfg_scale", portType: "number", label: "CFG Scale", required: false, falParam: "cfg_scale", fieldType: "range", default: 0.5, min: 0, max: 1, step: 0.1 }
    ]
  },
  "kling-3-image": {
    id: "fal-ai/kling-video/v3/pro/image-to-video",
    nodeType: "kling-3-image",
    name: "Kling 3 Image to Video",
    category: "video",
    description: "Kling 3.0 image-to-video",
    outputType: "video",
    responseMapping: { path: "video.url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "multi_prompt", portType: "multi_prompt", label: "Multi Prompt", required: false, falParam: "multi_prompt", fieldType: "port" },
      { id: "start_image_url", portType: "image", label: "First Frame", required: true, falParam: "start_image_url", fieldType: "port" },
      { id: "end_image_url", portType: "image", label: "Last Frame", required: false, falParam: "end_image_url", fieldType: "port" },
      { id: "negative_prompt", portType: "text", label: "Negative Prompt", required: false, falParam: "negative_prompt", fieldType: "port" },
      { id: "elements", portType: "image", label: "Element", required: false, falParam: "elements", fieldType: "element-list", max: 5 },
      { id: "duration", portType: "number", label: "Duration", required: false, falParam: "duration", fieldType: "select", default: "5", options: [
        { value: "3", label: "3s" },
        { value: "5", label: "5s" },
        { value: "8", label: "8s" },
        { value: "10", label: "10s" },
        { value: "15", label: "15s" }
      ] },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: false, falParam: "aspect_ratio", fieldType: "select", default: "16:9", options: [
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" },
        { value: "1:1", label: "1:1" }
      ] },
      { id: "generate_audio", portType: "number", label: "Generate Audio", required: false, falParam: "generate_audio", fieldType: "toggle", default: true },
      { id: "cfg_scale", portType: "number", label: "CFG Scale", required: false, falParam: "cfg_scale", fieldType: "range", default: 0.5, min: 0, max: 1, step: 0.1 }
    ]
  },
  "kling-2-5-text": {
    id: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
    nodeType: "kling-2-5-text",
    name: "Kling Video",
    category: "video",
    description: "Kling 2.5 text-to-video",
    outputType: "video",
    responseMapping: { path: "video.url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "negative_prompt", portType: "text", label: "Negative Prompt", required: false, falParam: "negative_prompt", fieldType: "port" },
      { id: "duration", portType: "number", label: "Duration", required: false, falParam: "duration", fieldType: "select", default: "5", options: [
        { value: "5", label: "5s" },
        { value: "10", label: "10s" }
      ] },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: false, falParam: "aspect_ratio", fieldType: "select", default: "16:9", options: [
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" },
        { value: "1:1", label: "1:1" }
      ] },
      { id: "cfg_scale", portType: "number", label: "CFG Scale", required: false, falParam: "cfg_scale", fieldType: "range", default: 0.5, min: 0, max: 1, step: 0.1 }
    ]
  },
  "kling-2-5-image": {
    id: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
    nodeType: "kling-2-5-image",
    name: "Kling Image to Video",
    category: "video",
    description: "Kling 2.5 image-to-video",
    outputType: "video",
    responseMapping: { path: "video.url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "First Frame", required: true, falParam: "image_url", fieldType: "port" },
      { id: "negative_prompt", portType: "text", label: "Negative Prompt", required: false, falParam: "negative_prompt", fieldType: "port" },
      { id: "duration", portType: "number", label: "Duration", required: false, falParam: "duration", fieldType: "select", default: "5", options: [
        { value: "5", label: "5s" },
        { value: "10", label: "10s" }
      ] },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: false, falParam: "aspect_ratio", fieldType: "select", default: "16:9", options: [
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" },
        { value: "1:1", label: "1:1" }
      ] },
      { id: "cfg_scale", portType: "number", label: "CFG Scale", required: false, falParam: "cfg_scale", fieldType: "range", default: 0.5, min: 0, max: 1, step: 0.1 }
    ]
  },
  "kling-first-last": {
    id: "fal-ai/kling-video/v2.1/master/image-to-video",
    nodeType: "kling-first-last",
    name: "Kling First & Last Frame",
    category: "video",
    description: "Kling first + last frame",
    outputType: "video",
    responseMapping: { path: "video.url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "First Frame", required: true, falParam: "image_url", fieldType: "port" },
      { id: "tail_image_url", portType: "image", label: "Last Frame", required: false, falParam: "tail_image_url", fieldType: "port" },
      { id: "negative_prompt", portType: "text", label: "Negative Prompt", required: false, falParam: "negative_prompt", fieldType: "port" },
      { id: "duration", portType: "number", label: "Duration", required: false, falParam: "duration", fieldType: "select", default: "5", options: [
        { value: "5", label: "5s" },
        { value: "10", label: "10s" }
      ] },
      { id: "cfg_scale", portType: "number", label: "CFG Scale", required: false, falParam: "cfg_scale", fieldType: "range", default: 0.5, min: 0, max: 1, step: 0.1 }
    ]
  },
  "minimax-video": {
    id: "fal-ai/minimax/video-01-live",
    nodeType: "minimax-video",
    name: "MiniMax Video",
    category: "video",
    description: "MiniMax video generation",
    outputType: "video",
    responseMapping: { path: "video.url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" }
    ]
  },
  "wan-2-2": {
    id: "fal-ai/wan/v2.2-a14b/image-to-video",
    nodeType: "wan-2-2",
    name: "Wan 2.2",
    category: "video",
    description: "Image-to-video",
    outputType: "video",
    responseMapping: { path: "video.url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "Image", required: true, falParam: "image_url", fieldType: "port" },
      { id: "resolution", portType: "text", label: "Resolution", required: false, falParam: "resolution", fieldType: "select", default: "720p", options: [
        { value: "480p", label: "480p" },
        { value: "720p", label: "720p" }
      ] },
      { id: "num_frames", portType: "number", label: "Frames", required: false, falParam: "num_frames", fieldType: "range", default: 81, min: 17, max: 161, step: 4 }
    ]
  },
  "ltx-2-video": {
    id: "fal-ai/ltx-2/text-to-video",
    nodeType: "ltx-2-video",
    name: "LTX 2 Video",
    category: "video",
    description: "LTX text/image-to-video",
    outputType: "video",
    responseMapping: { path: "video.url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "Image", required: false, falParam: "image_url", fieldType: "port" },
      { id: "duration", portType: "number", label: "Duration", required: false, falParam: "duration", fieldType: "select", default: "6", options: [
        { value: "6", label: "6s" },
        { value: "8", label: "8s" },
        { value: "10", label: "10s" }
      ] },
      { id: "resolution", portType: "text", label: "Resolution", required: false, falParam: "resolution", fieldType: "select", default: "1080p", options: [
        { value: "1080p", label: "1080p" },
        { value: "1440p", label: "1440p" }
      ] }
    ]
  },
  "ltx-2-3-text": {
    id: "fal-ai/ltx-2.3/text-to-video",
    nodeType: "ltx-2-3-text",
    name: "LTX 2.3",
    category: "video",
    description: "LTX 2.3 text-to-video (Pro)",
    outputType: "video",
    responseMapping: { path: "video.url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "duration", portType: "number", label: "Duration", required: false, falParam: "duration", fieldType: "select", default: "6", options: [
        { value: "6", label: "6s" },
        { value: "8", label: "8s" },
        { value: "10", label: "10s" }
      ] },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: false, falParam: "aspect_ratio", fieldType: "select", default: "16:9", options: [
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" }
      ] },
      { id: "resolution", portType: "text", label: "Resolution", required: false, falParam: "resolution", fieldType: "select", default: "1080p", options: [
        { value: "1080p", label: "1080p" },
        { value: "1440p", label: "1440p" },
        { value: "2160p", label: "4K" }
      ] },
      { id: "fps", portType: "number", label: "FPS", required: false, falParam: "fps", fieldType: "select", default: "25", options: [
        { value: "24", label: "24" },
        { value: "25", label: "25" },
        { value: "48", label: "48" },
        { value: "50", label: "50" }
      ] },
      { id: "generate_audio", portType: "number", label: "Generate Audio", required: false, falParam: "generate_audio", fieldType: "toggle", default: true }
    ]
  },
  "ltx-2-3-text-fast": {
    id: "fal-ai/ltx-2.3/text-to-video/fast",
    nodeType: "ltx-2-3-text-fast",
    name: "LTX 2.3 Fast",
    category: "video",
    description: "LTX 2.3 text-to-video (Fast)",
    outputType: "video",
    responseMapping: { path: "video.url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "duration", portType: "number", label: "Duration", required: false, falParam: "duration", fieldType: "select", default: "6", options: [
        { value: "6", label: "6s" },
        { value: "8", label: "8s" },
        { value: "10", label: "10s" },
        { value: "12", label: "12s" },
        { value: "14", label: "14s" },
        { value: "16", label: "16s" },
        { value: "18", label: "18s" },
        { value: "20", label: "20s" }
      ] },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: false, falParam: "aspect_ratio", fieldType: "select", default: "16:9", options: [
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" }
      ] },
      { id: "resolution", portType: "text", label: "Resolution", required: false, falParam: "resolution", fieldType: "select", default: "1080p", options: [
        { value: "1080p", label: "1080p" },
        { value: "1440p", label: "1440p" },
        { value: "2160p", label: "4K" }
      ] },
      { id: "fps", portType: "number", label: "FPS", required: false, falParam: "fps", fieldType: "select", default: "25", options: [
        { value: "24", label: "24" },
        { value: "25", label: "25" },
        { value: "48", label: "48" },
        { value: "50", label: "50" }
      ] },
      { id: "generate_audio", portType: "number", label: "Generate Audio", required: false, falParam: "generate_audio", fieldType: "toggle", default: true }
    ]
  },
  "ltx-2-3-image": {
    id: "fal-ai/ltx-2.3/image-to-video",
    nodeType: "ltx-2-3-image",
    name: "LTX 2.3 Image to Video",
    category: "video",
    description: "LTX 2.3 image-to-video (Pro)",
    outputType: "video",
    responseMapping: { path: "video.url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "First Frame", required: true, falParam: "image_url", fieldType: "port" },
      { id: "end_image_url", portType: "image", label: "Last Frame", required: false, falParam: "end_image_url", fieldType: "port" },
      { id: "duration", portType: "number", label: "Duration", required: false, falParam: "duration", fieldType: "select", default: "6", options: [
        { value: "6", label: "6s" },
        { value: "8", label: "8s" },
        { value: "10", label: "10s" }
      ] },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: false, falParam: "aspect_ratio", fieldType: "select", default: "auto", options: [
        { value: "auto", label: "Auto" },
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" }
      ] },
      { id: "resolution", portType: "text", label: "Resolution", required: false, falParam: "resolution", fieldType: "select", default: "1080p", options: [
        { value: "1080p", label: "1080p" },
        { value: "1440p", label: "1440p" },
        { value: "2160p", label: "4K" }
      ] },
      { id: "fps", portType: "number", label: "FPS", required: false, falParam: "fps", fieldType: "select", default: "25", options: [
        { value: "24", label: "24" },
        { value: "25", label: "25" },
        { value: "48", label: "48" },
        { value: "50", label: "50" }
      ] },
      { id: "generate_audio", portType: "number", label: "Generate Audio", required: false, falParam: "generate_audio", fieldType: "toggle", default: true }
    ]
  },
  "ltx-2-3-image-fast": {
    id: "fal-ai/ltx-2.3/image-to-video/fast",
    nodeType: "ltx-2-3-image-fast",
    name: "LTX 2.3 Image to Video (Fast)",
    category: "video",
    description: "LTX 2.3 image-to-video (Fast)",
    outputType: "video",
    responseMapping: { path: "video.url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "First Frame", required: true, falParam: "image_url", fieldType: "port" },
      { id: "end_image_url", portType: "image", label: "Last Frame", required: false, falParam: "end_image_url", fieldType: "port" },
      { id: "duration", portType: "number", label: "Duration", required: false, falParam: "duration", fieldType: "select", default: "6", options: [
        { value: "6", label: "6s" },
        { value: "8", label: "8s" },
        { value: "10", label: "10s" }
      ] },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: false, falParam: "aspect_ratio", fieldType: "select", default: "auto", options: [
        { value: "auto", label: "Auto" },
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" }
      ] },
      { id: "resolution", portType: "text", label: "Resolution", required: false, falParam: "resolution", fieldType: "select", default: "1080p", options: [
        { value: "1080p", label: "1080p" },
        { value: "1440p", label: "1440p" },
        { value: "2160p", label: "4K" }
      ] },
      { id: "fps", portType: "number", label: "FPS", required: false, falParam: "fps", fieldType: "select", default: "25", options: [
        { value: "24", label: "24" },
        { value: "25", label: "25" },
        { value: "48", label: "48" },
        { value: "50", label: "50" }
      ] },
      { id: "generate_audio", portType: "number", label: "Generate Audio", required: false, falParam: "generate_audio", fieldType: "toggle", default: true }
    ]
  },
  "ltx-2-3-audio": {
    id: "fal-ai/ltx-2.3/audio-to-video",
    nodeType: "ltx-2-3-audio",
    name: "LTX 2.3 Audio to Video",
    category: "video",
    description: "LTX 2.3 audio-to-video",
    outputType: "video",
    responseMapping: { path: "video.url" },
    inputs: [
      { id: "audio_url", portType: "audio", label: "Audio", required: true, falParam: "audio_url", fieldType: "port" },
      { id: "image_url", portType: "image", label: "First Frame", required: false, falParam: "image_url", fieldType: "port" },
      { id: "prompt", portType: "text", label: "Prompt", required: false, falParam: "prompt", fieldType: "port" },
      { id: "guidance_scale", portType: "number", label: "Guidance", required: false, falParam: "guidance_scale", fieldType: "range", default: 5, min: 1, max: 50, step: 0.5 }
    ]
  },
  "ltx-2-3-extend": {
    id: "fal-ai/ltx-2.3/extend-video",
    nodeType: "ltx-2-3-extend",
    name: "LTX 2.3 Extend Video",
    category: "video",
    description: "LTX 2.3 video extension",
    outputType: "video",
    responseMapping: { path: "video.url" },
    inputs: [
      { id: "video_url", portType: "video", label: "Video", required: true, falParam: "video_url", fieldType: "port" },
      { id: "prompt", portType: "text", label: "Prompt", required: false, falParam: "prompt", fieldType: "port" },
      { id: "duration", portType: "number", label: "Extension (s)", required: false, falParam: "duration", fieldType: "range", default: 5, min: 1, max: 20, step: 1 },
      { id: "mode", portType: "text", label: "Mode", required: false, falParam: "mode", fieldType: "select", default: "end", options: [
        { value: "end", label: "Extend End" },
        { value: "start", label: "Extend Start" }
      ] },
      { id: "context", portType: "number", label: "Context (s)", required: false, falParam: "context", fieldType: "range", default: 3, min: 1, max: 20, step: 0.5 }
    ]
  },
  "ltx-2-3-retake": {
    id: "fal-ai/ltx-2.3/retake-video",
    nodeType: "ltx-2-3-retake",
    name: "LTX 2.3 Retake Video",
    category: "video",
    description: "LTX 2.3 video retake/variation",
    outputType: "video",
    responseMapping: { path: "video.url" },
    inputs: [
      { id: "video_url", portType: "video", label: "Video", required: true, falParam: "video_url", fieldType: "port" },
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "start_time", portType: "number", label: "Start (s)", required: false, falParam: "start_time", fieldType: "range", default: 0, min: 0, max: 20, step: 0.5 },
      { id: "duration", portType: "number", label: "Duration (s)", required: false, falParam: "duration", fieldType: "range", default: 5, min: 2, max: 20, step: 0.5 },
      { id: "retake_mode", portType: "text", label: "Retake Mode", required: false, falParam: "retake_mode", fieldType: "select", default: "replace_audio_and_video", options: [
        { value: "replace_audio_and_video", label: "Audio + Video" },
        { value: "replace_video", label: "Video Only" },
        { value: "replace_audio", label: "Audio Only" }
      ] }
    ]
  },
  "sora-2": {
    id: "fal-ai/sora-2/image-to-video/pro",
    nodeType: "sora-2",
    name: "Sora 2",
    category: "video",
    description: "OpenAI Sora image-to-video",
    outputType: "video",
    responseMapping: { path: "video.url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: true, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "Image", required: true, falParam: "image_url", fieldType: "port" },
      { id: "duration", portType: "number", label: "Duration", required: false, falParam: "duration", fieldType: "number", default: 4, min: 2, max: 20, step: 1 },
      { id: "resolution", portType: "text", label: "Resolution", required: false, falParam: "resolution", fieldType: "select", default: "720p", options: [
        { value: "720p", label: "720p" },
        { value: "1080p", label: "1080p" }
      ] }
    ]
  },
  "elevenlabs-music": {
    id: "fal-ai/elevenlabs/music",
    nodeType: "elevenlabs-music",
    name: "ElevenLabs Music",
    category: "audio",
    description: "AI music generation by ElevenLabs",
    outputType: "audio",
    responseMapping: { path: "audio.url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: false, falParam: "prompt", fieldType: "port" },
      { id: "composition_plan", portType: "composition_plan", label: "Composition Plan", required: false, falParam: "composition_plan", fieldType: "port" },
      { id: "music_length_ms", portType: "number", label: "Duration", required: false, falParam: "music_length_ms", fieldType: "select", default: "60000", options: [
        { value: "15000", label: "15s" },
        { value: "30000", label: "30s" },
        { value: "60000", label: "1m" },
        { value: "120000", label: "2m" },
        { value: "180000", label: "3m" },
        { value: "300000", label: "5m" }
      ] },
      { id: "force_instrumental", portType: "number", label: "Instrumental", required: false, falParam: "force_instrumental", fieldType: "toggle", default: false },
      { id: "respect_sections_durations", portType: "number", label: "Strict Durations", required: false, falParam: "respect_sections_durations", fieldType: "toggle", default: true },
      { id: "output_format", portType: "text", label: "Format", required: false, falParam: "output_format", fieldType: "select", default: "mp3_44100_128", options: [
        { value: "mp3_44100_128", label: "MP3 128k" },
        { value: "mp3_44100_192", label: "MP3 192k" }
      ] }
    ]
  },
  "elevenlabs-tts": {
    id: "fal-ai/elevenlabs/tts/eleven-v3",
    nodeType: "elevenlabs-tts",
    name: "ElevenLabs TTS",
    category: "audio",
    description: "Text-to-speech by ElevenLabs",
    outputType: "audio",
    responseMapping: { path: "audio.url" },
    inputs: [
      { id: "text", portType: "text", label: "Text", required: true, falParam: "text", fieldType: "port" },
      { id: "voice", portType: "text", label: "Voice", required: false, falParam: "voice", fieldType: "select", default: "Rachel", options: [
        { value: "Rachel", label: "Rachel" },
        { value: "Aria", label: "Aria" },
        { value: "Roger", label: "Roger" },
        { value: "Sarah", label: "Sarah" },
        { value: "Laura", label: "Laura" },
        { value: "Charlie", label: "Charlie" },
        { value: "George", label: "George" },
        { value: "Callum", label: "Callum" },
        { value: "River", label: "River" },
        { value: "Liam", label: "Liam" },
        { value: "Charlotte", label: "Charlotte" },
        { value: "Alice", label: "Alice" },
        { value: "Matilda", label: "Matilda" },
        { value: "Will", label: "Will" },
        { value: "Jessica", label: "Jessica" },
        { value: "Eric", label: "Eric" },
        { value: "Chris", label: "Chris" },
        { value: "Brian", label: "Brian" },
        { value: "Daniel", label: "Daniel" },
        { value: "Lily", label: "Lily" },
        { value: "Bill", label: "Bill" }
      ] },
      { id: "stability", portType: "number", label: "Stability", required: false, falParam: "stability", fieldType: "range", default: 0.5, min: 0, max: 1, step: 0.05 },
      { id: "apply_text_normalization", portType: "text", label: "Normalization", required: false, falParam: "apply_text_normalization", fieldType: "select", default: "auto", options: [
        { value: "auto", label: "Auto" },
        { value: "on", label: "On" },
        { value: "off", label: "Off" }
      ] }
    ]
  },
  "elevenlabs-voice-changer": {
    id: "fal-ai/elevenlabs/voice-changer",
    nodeType: "elevenlabs-voice-changer",
    name: "ElevenLabs Voice Changer",
    category: "audio",
    description: "Swap voices in audio",
    outputType: "audio",
    responseMapping: { path: "audio.url" },
    inputs: [
      { id: "audio_url", portType: "audio", label: "Audio", required: true, falParam: "audio_url", fieldType: "port" },
      { id: "voice", portType: "text", label: "Voice", required: false, falParam: "voice", fieldType: "select", default: "Rachel", options: [
        { value: "Rachel", label: "Rachel" },
        { value: "Aria", label: "Aria" },
        { value: "Roger", label: "Roger" },
        { value: "Sarah", label: "Sarah" },
        { value: "Laura", label: "Laura" },
        { value: "Charlie", label: "Charlie" },
        { value: "George", label: "George" },
        { value: "Callum", label: "Callum" },
        { value: "River", label: "River" },
        { value: "Liam", label: "Liam" },
        { value: "Charlotte", label: "Charlotte" },
        { value: "Alice", label: "Alice" },
        { value: "Matilda", label: "Matilda" },
        { value: "Will", label: "Will" },
        { value: "Jessica", label: "Jessica" },
        { value: "Eric", label: "Eric" },
        { value: "Chris", label: "Chris" },
        { value: "Brian", label: "Brian" },
        { value: "Daniel", label: "Daniel" },
        { value: "Lily", label: "Lily" },
        { value: "Bill", label: "Bill" }
      ] },
      { id: "remove_background_noise", portType: "number", label: "Remove Noise", required: false, falParam: "remove_background_noise", fieldType: "toggle", default: false },
      { id: "output_format", portType: "text", label: "Format", required: false, falParam: "output_format", fieldType: "select", default: "mp3_44100_128", options: [
        { value: "mp3_44100_128", label: "MP3 128k" },
        { value: "mp3_44100_192", label: "MP3 192k" }
      ] }
    ]
  },
  "elevenlabs-audio-isolation": {
    id: "fal-ai/elevenlabs/audio-isolation",
    nodeType: "elevenlabs-audio-isolation",
    name: "ElevenLabs Audio Isolation",
    category: "audio",
    description: "Isolate voice from background noise",
    outputType: "audio",
    responseMapping: { path: "audio.url" },
    inputs: [
      { id: "audio_url", portType: "audio", label: "Audio", required: true, falParam: "audio_url", fieldType: "port" }
    ]
  },
  "elevenlabs-speech-to-text": {
    id: "fal-ai/elevenlabs/speech-to-text",
    nodeType: "elevenlabs-speech-to-text",
    name: "ElevenLabs Speech to Text",
    category: "audio",
    description: "Transcribe audio to text",
    outputType: "text",
    responseMapping: { path: "text" },
    inputs: [
      { id: "audio_url", portType: "audio", label: "Audio", required: true, falParam: "audio_url", fieldType: "port" },
      { id: "tag_audio_events", portType: "number", label: "Tag Events", required: false, falParam: "tag_audio_events", fieldType: "toggle", default: true },
      { id: "diarize", portType: "number", label: "Diarize", required: false, falParam: "diarize", fieldType: "toggle", default: true }
    ]
  },
  "elevenlabs-dubbing": {
    id: "fal-ai/elevenlabs/dubbing",
    nodeType: "elevenlabs-dubbing",
    name: "ElevenLabs Dubbing",
    category: "audio",
    description: "Dub audio/video to another language",
    outputType: "video",
    responseMapping: { path: "video.url" },
    inputs: [
      { id: "audio_url", portType: "audio", label: "Audio", required: false, falParam: "audio_url", fieldType: "port" },
      { id: "video_url", portType: "video", label: "Video", required: false, falParam: "video_url", fieldType: "port" },
      { id: "target_lang", portType: "text", label: "Target Language", required: true, falParam: "target_lang", fieldType: "select", default: "es", options: [
        { value: "es", label: "Spanish" },
        { value: "fr", label: "French" },
        { value: "de", label: "German" },
        { value: "it", label: "Italian" },
        { value: "pt", label: "Portuguese" },
        { value: "ja", label: "Japanese" },
        { value: "ko", label: "Korean" },
        { value: "zh", label: "Chinese" },
        { value: "hi", label: "Hindi" },
        { value: "ar", label: "Arabic" },
        { value: "ru", label: "Russian" },
        { value: "pl", label: "Polish" },
        { value: "nl", label: "Dutch" },
        { value: "tr", label: "Turkish" },
        { value: "sv", label: "Swedish" }
      ] },
      { id: "highest_resolution", portType: "number", label: "High Resolution", required: false, falParam: "highest_resolution", fieldType: "toggle", default: true }
    ]
  }
};
const ALL_MODELS = { ...MODEL_REGISTRY, ...KIE_MODEL_REGISTRY };
export {
  ALL_MODELS,
  MODEL_REGISTRY
};
