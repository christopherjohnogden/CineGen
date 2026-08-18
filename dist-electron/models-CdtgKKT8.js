const x = {
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
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "imageUrl", portType: "image", label: "Image", required: !1, falParam: "imageUrl", fieldType: "port" },
      { id: "duration", portType: "number", label: "Duration", required: !1, falParam: "duration", fieldType: "select", default: "5", options: [
        { value: "5", label: "5s" },
        { value: "10", label: "10s" }
      ] },
      { id: "quality", portType: "text", label: "Quality", required: !1, falParam: "quality", fieldType: "select", default: "720p", options: [
        { value: "720p", label: "720p" },
        { value: "1080p", label: "1080p" }
      ] },
      { id: "aspectRatio", portType: "text", label: "Aspect Ratio", required: !1, falParam: "aspectRatio", fieldType: "select", default: "16:9", options: [
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
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "imageUrls", portType: "image", label: "Image", required: !1, falParam: "imageUrls", fieldType: "port" },
      { id: "model", portType: "text", label: "Quality", required: !1, falParam: "model", fieldType: "select", default: "veo3_fast", options: [
        { value: "veo3_fast", label: "Fast" },
        { value: "veo3", label: "Quality" }
      ] },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: !1, falParam: "aspect_ratio", fieldType: "select", default: "16:9", options: [
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
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: !1, falParam: "aspect_ratio", fieldType: "select", default: "16:9", options: [
        { value: "1:1", label: "1:1" },
        { value: "4:3", label: "4:3" },
        { value: "3:4", label: "3:4" },
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" }
      ] },
      { id: "resolution", portType: "text", label: "Resolution", required: !1, falParam: "resolution", fieldType: "select", default: "1K", options: [
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
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "filesUrl", portType: "image", label: "Reference Image", required: !1, falParam: "filesUrl", fieldType: "port" },
      { id: "size", portType: "text", label: "Size", required: !1, falParam: "size", fieldType: "select", default: "1:1", options: [
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
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_urls", portType: "image", label: "Image", required: !0, falParam: "image_urls", fieldType: "port" },
      { id: "duration", portType: "number", label: "Duration", required: !1, falParam: "duration", fieldType: "select", default: "5", options: [
        { value: "5", label: "5s" },
        { value: "10", label: "10s" },
        { value: "15", label: "15s" }
      ] },
      { id: "resolution", portType: "text", label: "Resolution", required: !1, falParam: "resolution", fieldType: "select", default: "1080p", options: [
        { value: "720p", label: "720p" },
        { value: "1080p", label: "1080p" }
      ] },
      { id: "audio", portType: "number", label: "Audio", required: !1, falParam: "audio", fieldType: "toggle", default: !0 }
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
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "multi_prompt", portType: "multi_prompt", label: "Multi Prompt", required: !1, falParam: "multi_prompt", fieldType: "port" },
      { id: "image_urls", portType: "image", label: "First Frame", required: !1, falParam: "image_urls", fieldType: "port" },
      { id: "last_frame", portType: "image", label: "Last Frame", required: !1, falParam: "image_urls", fieldType: "port" },
      { id: "kling_elements", portType: "image", label: "Element", required: !1, falParam: "kling_elements", fieldType: "element-list", max: 5 },
      { id: "duration", portType: "number", label: "Duration", required: !1, falParam: "duration", fieldType: "select", default: "5", options: [
        { value: "3", label: "3s" },
        { value: "5", label: "5s" },
        { value: "8", label: "8s" },
        { value: "10", label: "10s" },
        { value: "15", label: "15s" }
      ] },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: !1, falParam: "aspect_ratio", fieldType: "select", default: "16:9", options: [
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" },
        { value: "1:1", label: "1:1" }
      ] },
      { id: "mode", portType: "text", label: "Quality", required: !1, falParam: "mode", fieldType: "select", default: "pro", options: [
        { value: "std", label: "Standard (720p)" },
        { value: "pro", label: "Pro (1080p)" },
        { value: "4K", label: "4K" }
      ] },
      { id: "sound", portType: "number", label: "Sound", required: !1, falParam: "sound", fieldType: "toggle", default: !0 }
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
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_input", portType: "image", label: "Image 1", required: !1, falParam: "image_input", fieldType: "port" },
      { id: "extra_images", portType: "image", label: "Image", required: !1, falParam: "image_input", fieldType: "element-list", max: 8 },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: !1, falParam: "aspect_ratio", fieldType: "select", default: "1:1", options: [
        { value: "1:1", label: "1:1" },
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" },
        { value: "4:3", label: "4:3" },
        { value: "3:4", label: "3:4" }
      ] },
      { id: "resolution", portType: "text", label: "Resolution", required: !1, falParam: "resolution", fieldType: "select", default: "1K", options: [
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
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_input", portType: "image", label: "Image 1", required: !1, falParam: "image_input", fieldType: "port" },
      { id: "extra_images", portType: "image", label: "Image", required: !1, falParam: "image_input", fieldType: "element-list", max: 14 },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: !1, falParam: "aspect_ratio", fieldType: "select", default: "auto", options: [
        { value: "auto", label: "Auto" },
        { value: "1:1", label: "1:1" },
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" }
      ] },
      { id: "resolution", portType: "text", label: "Resolution", required: !1, falParam: "resolution", fieldType: "select", default: "1K", options: [
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
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "urls", portType: "image", label: "Image", required: !1, falParam: "urls", fieldType: "port" },
      { id: "duration", portType: "number", label: "Duration", required: !1, falParam: "duration", fieldType: "select", default: "5", options: [
        { value: "4", label: "4s" },
        { value: "5", label: "5s" },
        { value: "8", label: "8s" },
        { value: "12", label: "12s" },
        { value: "15", label: "15s" }
      ] },
      { id: "resolution", portType: "text", label: "Resolution", required: !1, falParam: "resolution", fieldType: "select", default: "720p", options: [
        { value: "480p", label: "480p" },
        { value: "720p", label: "720p" }
      ] },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: !1, falParam: "aspect_ratio", fieldType: "select", default: "16:9", options: [
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" },
        { value: "1:1", label: "1:1" },
        { value: "4:3", label: "4:3" },
        { value: "3:4", label: "3:4" }
      ] },
      { id: "generate_audio", portType: "number", label: "Audio", required: !1, falParam: "generate_audio", fieldType: "toggle", default: !1 },
      { id: "fixed_lens", portType: "number", label: "Fixed Lens", required: !1, falParam: "fixed_lens", fieldType: "toggle", default: !1 }
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
      { id: "prompt", portType: "text", label: "Lyrics / Description", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "style", portType: "text", label: "Style", required: !1, falParam: "style", fieldType: "textarea" },
      { id: "title", portType: "text", label: "Title", required: !1, falParam: "title", fieldType: "text" },
      { id: "model", portType: "text", label: "Model", required: !1, falParam: "model", fieldType: "select", default: "V4", options: [
        { value: "V4", label: "V4" },
        { value: "V4_5", label: "V4.5" },
        { value: "V4_5PLUS", label: "V4.5+" },
        { value: "V4_5ALL", label: "V4.5 All" },
        { value: "V5", label: "V5" }
      ] },
      { id: "customMode", portType: "number", label: "Custom Mode", required: !1, falParam: "customMode", fieldType: "toggle", default: !0 },
      { id: "instrumental", portType: "number", label: "Instrumental", required: !1, falParam: "instrumental", fieldType: "toggle", default: !1 }
    ]
  }
}, h = /* @__PURE__ */ JSON.parse('[{"display_name":"3D Rigging","job_set_type":"3d_rigging","type":"3d","params":[{"name":"animation_action_id","type":"object","default":null,"required":false},{"name":"enable_animation","type":"boolean","default":false,"required":false},{"name":"enable_safety_checker","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"height_meters","type":"object","default":null,"required":false},{"name":"model_url","type":"string","default":null,"required":true}]},{"display_name":"Brain Activity","job_set_type":"brain_activity","type":"text","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Bytedance Image Upscale","job_set_type":"bytedance_image_upscale","type":"image","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"remove_bg","type":"boolean","default":false,"required":false},{"name":"resolution","type":"string","default":"4k","required":false,"enum":["2k","4k"]}]},{"display_name":"Bytedance Video Upscale","job_set_type":"bytedance_video_upscale","type":"video","params":[{"name":"duration","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"fps","type":"integer","default":24,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"model_version","type":"string","default":"standard","required":false,"enum":["standard","pro"]},{"name":"preset","type":"string","default":"common","required":false,"enum":["common","aigc","short_series","ugc","old_film"]},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1080p","2k","4k"]}]},{"display_name":"Cinematic Studio 2.5","job_set_type":"cinematic_studio_2_5","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"auto","required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"Cinematic Studio 3.0","job_set_type":"cinematic_studio_3_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"duration","type":"integer","default":5,"required":false},{"name":"enhance_prompt","type":"boolean","default":false,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","noir","drama","epic"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"multi_prompt","type":"array","default":null,"required":false},{"name":"multi_shot_mode","type":"string","default":"custom","required":false,"enum":["auto","custom"]},{"name":"multi_shots","type":"boolean","default":false,"required":false},{"name":"preset_id","type":"object","default":null,"required":false},{"name":"prompt","type":"string","default":"","required":false},{"name":"prompt_language","type":"string","default":"zh","required":false,"enum":["en","zh"]},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p","4k"]},{"name":"speedramp","type":"object","default":"auto","required":false}]},{"display_name":"Cinematic Studio Image","job_set_type":"cinematic_studio_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"camera_aperture_id","type":"object","default":null,"required":false},{"name":"camera_focal_length_id","type":"string","default":null,"required":true},{"name":"camera_lens_id","type":"string","default":null,"required":true},{"name":"camera_model_id","type":"string","default":null,"required":true},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"Cinematic Studio Soul Cast","job_set_type":"cinematic_studio_soul_cast","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","5:4","4:5","21:9","9:21"]},{"name":"budget","type":"integer","default":50,"required":false},{"name":"prompt","type":"object","default":null,"required":false}]},{"display_name":"Cinematic Studio Soul Location","job_set_type":"cinematic_studio_soul_location","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9","9:21"]},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Cinematic Studio Video","job_set_type":"cinematic_studio_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"duration","type":"string","default":5,"required":false,"enum":["5","10"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"slow_motion","type":"boolean","default":false,"required":false},{"name":"sound","type":"boolean","default":true,"required":false}]},{"display_name":"Cinematic Studio Video 3.5","job_set_type":"cinematic_studio_video_3_5","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"camera_aperture_id","type":"object","default":null,"required":false},{"name":"camera_focal_length_id","type":"object","default":null,"required":false},{"name":"camera_lens_id","type":"object","default":null,"required":false},{"name":"camera_model_id","type":"object","default":null,"required":false},{"name":"camera_style","type":"object","default":null,"required":false},{"name":"color_grading","type":"object","default":null,"required":false},{"name":"duration","type":"integer","default":15,"required":false},{"name":"enhance_prompt","type":"boolean","default":false,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","noir","drama","epic"]},{"name":"light_scheme","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"multi_prompt","type":"array","default":null,"required":false},{"name":"multi_shot_mode","type":"string","default":"custom","required":false,"enum":["auto","custom"]},{"name":"multi_shots","type":"boolean","default":false,"required":false},{"name":"prompt","type":"string","default":"","required":false},{"name":"prompt_language","type":"string","default":"zh","required":false,"enum":["en","zh"]},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"style_id","type":"object","default":null,"required":false},{"name":"style_prompt","type":"object","default":null,"required":false}]},{"display_name":"Cinema Studio 4.0","job_set_type":"cinematic_studio_video_4_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"bitrate_mode","type":"string","default":"standard","required":false,"enum":["standard","high"]},{"name":"camera_aperture_id","type":"object","default":null,"required":false},{"name":"camera_lens_id","type":"object","default":null,"required":false},{"name":"camera_model_id","type":"object","default":null,"required":false},{"name":"color_palette","type":"object","default":null,"required":false},{"name":"duration","type":"integer","default":5,"required":false},{"name":"enhance_prompt","type":"boolean","default":false,"required":false},{"name":"era_id","type":"object","default":null,"required":false},{"name":"extension_mode","type":"object","default":null,"required":false},{"name":"film_era","type":"null","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"genre","type":"null","default":null,"required":false},{"name":"genre_id","type":"object","default":null,"required":false},{"name":"height","type":"integer","default":null,"required":true},{"name":"light","type":"object","default":null,"required":false},{"name":"light_custom","type":"object","default":null,"required":false},{"name":"light_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["std","fast"]},{"name":"model","type":"string","default":"default","required":false,"enum":["default","video_edit","video_extension"]},{"name":"multi_prompt","type":"array","default":null,"required":false},{"name":"multi_shot_mode","type":"string","default":"custom","required":false,"enum":["auto","custom"]},{"name":"multi_shots","type":"boolean","default":false,"required":false},{"name":"pacing_id","type":"object","default":null,"required":false},{"name":"preset_id","type":"null","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"prompt_language","type":"string","default":"zh","required":false,"enum":["en","zh"]},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"speedramp","type":"object","default":"auto","required":false},{"name":"use_blur","type":"boolean","default":false,"required":false},{"name":"use_eye_mask","type":"boolean","default":false,"required":false},{"name":"use_transparency","type":"boolean","default":false,"required":false},{"name":"width","type":"integer","default":null,"required":true}]},{"display_name":"Cinematic Studio Video V2","job_set_type":"cinematic_studio_video_v2","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["1:1","16:9","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"cfg_scale","type":"number","default":0.5,"required":false},{"name":"duration","type":"integer","default":5,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","western","suspense","intimate","spectacle"]},{"name":"kling_element_ids","type":"array","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["pro","std"]},{"name":"multi_prompt","type":"array","default":null,"required":false},{"name":"multi_shot_mode","type":"string","default":"custom","required":false,"enum":["auto","custom"]},{"name":"multi_shots","type":"boolean","default":false,"required":false},{"name":"preset_id","type":"object","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sound","type":"string","default":"on","required":false,"enum":["on","off"]},{"name":"speedramp","type":"object","default":"auto","required":false}]},{"display_name":"Clipify","job_set_type":"clipify","type":"video","params":[{"name":"clip_aspect","type":"string","default":"9:16","required":false,"enum":["9:16","1:1","16:9"]},{"name":"clips_num","type":"integer","default":10,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"max_height","type":"integer","default":1080,"required":false},{"name":"segment_seconds","type":"integer","default":10,"required":false},{"name":"subtitle_case","type":"string","default":"as-is","required":false,"enum":["lower","upper","as-is"]},{"name":"subtitle_font","type":"string","default":"notosans","required":false},{"name":"subtitle_highlight_hex","type":"string","default":"#FFE84D","required":false},{"name":"subtitle_position","type":"string","default":"bottom","required":false,"enum":["bottom","center","top"]},{"name":"track_face_crop","type":"boolean","default":true,"required":false},{"name":"urls","type":"array","default":null,"required":true}]},{"display_name":"Draw To Video","job_set_type":"draw_to_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"duration","type":"object","default":null,"required":false},{"name":"enhancer","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"ref_image","type":"object","default":null,"required":false},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"sketch","type":"object","default":null,"required":true},{"name":"video","type":"object","default":null,"required":true}]},{"display_name":"dubbing","job_set_type":"dubbing","type":"video","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_video","type":"object","default":null,"required":true},{"name":"target_language","type":"string","default":null,"required":true,"enum":["eng","cmn","fra","hin","ita","jpn","kor","por","rus","tur","spa","deu","ara","pol","ind","fil","swe","fin"]}]},{"display_name":"Explainer Video","job_set_type":"explainer_video","type":"video","params":[{"name":"height","type":"integer","default":null,"required":true},{"name":"items","type":"array","default":null,"required":true},{"name":"subtitles","type":"object","default":null,"required":false},{"name":"width","type":"integer","default":null,"required":true}]},{"display_name":"FLUX.2","job_set_type":"flux_2","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"model","type":"string","default":"pro","required":false,"enum":["pro","flex","max"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k"]}]},{"display_name":"FLUX.2 Pro Outpaint","job_set_type":"flux_2_pro_outpaint","type":"image","params":[{"name":"expand_bottom","type":"integer","default":0,"required":false},{"name":"expand_left","type":"integer","default":0,"required":false},{"name":"expand_right","type":"integer","default":0,"required":false},{"name":"expand_top","type":"integer","default":0,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"FLUX 3 Video","job_set_type":"flux_3_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","2:1","16:9","4:3","1:1","3:4","9:16"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"Flux Kontext","job_set_type":"flux_kontext","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Gemini Omni Flash","job_set_type":"gemini_omni","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16"]},{"name":"duration","type":"integer","default":8,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false}]},{"display_name":"GPT Image 2","job_set_type":"gpt_image_2","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16","3:2","2:3"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"high","required":false,"enum":["low","medium","high"]},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"Grok Image","job_set_type":"grok_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","1:2","2:1","3:2","2:3","4:3","3:4","16:9","9:16"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["std","quality"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k"]}]},{"display_name":"Grok Video","job_set_type":"grok_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Grok Video 1.5","job_set_type":"grok_video_v15","type":"video","params":[{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]}]},{"display_name":"Happy Horse Video","job_set_type":"happy_horse_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1","4:3","3:4"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"Hunyuan 3D v3.1 Text to 3D","job_set_type":"hunyuan3d_v3_1_text_to_3d","type":"3d","params":[{"name":"enable_pbr","type":"boolean","default":false,"required":false},{"name":"face_count","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_type","type":"object","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Hunyuan3D v3 Image to 3D","job_set_type":"hunyuan3d_v3_image_to_3d","type":"3d","params":[{"name":"enable_pbr","type":"boolean","default":false,"required":false},{"name":"face_count","type":"integer","default":500000,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_type","type":"string","default":"Normal","required":false,"enum":["Normal","LowPoly","Geometry"]},{"name":"medias","type":"array","default":null,"required":true},{"name":"polygon_type","type":"string","default":"triangle","required":false,"enum":["triangle","quadrilateral"]}]},{"display_name":"Image Auto","job_set_type":"image_auto","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Image Background Remover","job_set_type":"image_background_remover","type":"image","params":[{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Image Decompose","job_set_type":"image_decompose","type":"image","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"mode","type":"string","default":"granular","required":false,"enum":["granular","standard"]}]},{"display_name":"Image to 3D","job_set_type":"image_to_3d","type":"3d","params":[{"name":"animation_action_id","type":"object","default":null,"required":false},{"name":"enable_animation","type":"boolean","default":false,"required":false},{"name":"enable_pbr","type":"object","default":null,"required":false},{"name":"enable_rigging","type":"boolean","default":false,"required":false},{"name":"enable_safety_checker","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"pose_mode","type":"object","default":null,"required":false},{"name":"rigging_height_meters","type":"object","default":null,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"should_remesh","type":"object","default":null,"required":false},{"name":"should_texture","type":"boolean","default":false,"required":false},{"name":"symmetry_mode","type":"object","default":null,"required":false},{"name":"target_polycount","type":"object","default":null,"required":false},{"name":"texture_image_url","type":"object","default":null,"required":false},{"name":"texture_prompt","type":"object","default":null,"required":false},{"name":"topology","type":"object","default":null,"required":false}]},{"display_name":"Inworld Text to Speech","job_set_type":"inworld_text_to_speech","type":"audio","params":[{"name":"prompt","type":"string","default":null,"required":true},{"name":"voice","type":"string","default":null,"required":true}]},{"display_name":"Kimodo","job_set_type":"kimodo","type":"3d","params":[{"name":"diffusion_steps","type":"integer","default":10,"required":false},{"name":"duration","type":"object","default":null,"required":false},{"name":"durations","type":"object","default":null,"required":false},{"name":"enhancer","type":"boolean","default":false,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"model_version","type":"string","default":"ardy-core","required":false,"enum":["ardy-core","ardy-core-h8"]},{"name":"prompt","type":"object","default":null,"required":false},{"name":"prompts","type":"object","default":null,"required":false},{"name":"seed","type":"integer","default":42,"required":false}]},{"display_name":"Kling O1 Image","job_set_type":"kling_omni_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","auto","16:9","9:16","4:3","3:4","3:2","2:3","21:9"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k"]}]},{"display_name":"Kling 2.6 Video","job_set_type":"kling2_6","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"string","default":5,"required":false,"enum":["5","10"]},{"name":"input_image","type":"object","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sound","type":"boolean","default":true,"required":false}]},{"display_name":"Kling v3.0","job_set_type":"kling3_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["pro","std","4k"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sound","type":"string","default":"on","required":false,"enum":["on","off"]}]},{"display_name":"Kling 3.0 Motion Control","job_set_type":"kling3_0_motion_control","type":"video","params":[{"name":"background_source","type":"string","default":"input_image","required":false,"enum":["input_image","input_video"]},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"mode","type":"string","default":"std","required":false,"enum":["std","pro"]}]},{"display_name":"Kling 3.0 Turbo","job_set_type":"kling3_0_turbo","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"LLM Generation","job_set_type":"llm_text","type":"video","params":[{"name":"input_images","type":"array","default":null,"required":false},{"name":"model","type":"string","default":null,"required":true},{"name":"reasoning_effort","type":"object","default":null,"required":false},{"name":"system_prompt","type":"string","default":"","required":false},{"name":"user_prompt","type":"string","default":"","required":false}]},{"display_name":"Marketing Studio Image","job_set_type":"marketing_studio_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"Marketing Studio Video","job_set_type":"marketing_studio_video","type":"video","params":[{"name":"ad_reference_id","type":"object","default":null,"required":false},{"name":"aspect_ratio","type":"string","default":"9:16","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"avatar_ids","type":"array","default":null,"required":false},{"name":"avatars","type":"array","default":null,"required":false},{"name":"duration","type":"integer","default":15,"required":false},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"hook_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"ugc","required":false},{"name":"product_ids","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"setting_id","type":"object","default":null,"required":false},{"name":"specific_mode","type":"string","default":"default","required":false,"enum":["default","web_product","from_storyboard"]},{"name":"storyboard_id","type":"object","default":null,"required":false},{"name":"web_product_ids","type":"array","default":null,"required":false},{"name":"web_product_type","type":"object","default":null,"required":false}]},{"display_name":"Meshy 5 Remesh","job_set_type":"meshy_v5_remesh","type":"3d","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"model_url","type":"string","default":null,"required":true},{"name":"origin_at","type":"object","default":null,"required":false},{"name":"resize_height","type":"object","default":null,"required":false},{"name":"target_polycount","type":"object","default":null,"required":false},{"name":"topology","type":"object","default":null,"required":false}]},{"display_name":"Meshy 6 Text to 3D","job_set_type":"meshy_v6_text_to_3d","type":"3d","params":[{"name":"animation_action_id","type":"object","default":null,"required":false},{"name":"enable_animation","type":"boolean","default":false,"required":false},{"name":"enable_pbr","type":"boolean","default":false,"required":false},{"name":"enable_prompt_expansion","type":"boolean","default":false,"required":false},{"name":"enable_rigging","type":"boolean","default":false,"required":false},{"name":"enable_safety_checker","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"mode","type":"string","default":"full","required":false},{"name":"model_type","type":"string","default":"standard","required":false},{"name":"pose_mode","type":"string","default":"","required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"rigging_height_meters","type":"object","default":null,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"should_remesh","type":"boolean","default":true,"required":false},{"name":"symmetry_mode","type":"string","default":"auto","required":false},{"name":"target_polycount","type":"integer","default":30000,"required":false},{"name":"texture_image_url","type":"object","default":null,"required":false},{"name":"texture_prompt","type":"object","default":null,"required":false},{"name":"topology","type":"string","default":"triangle","required":false}]},{"display_name":"MiniMax H3","job_set_type":"minimax_h3","type":"video","params":[{"name":"aigc_watermark","type":"boolean","default":false,"required":false},{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"duration","type":"integer","default":4,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"height","type":"integer","default":null,"required":true},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":"","required":false},{"name":"resolution","type":"string","default":"2K","required":false,"enum":["768P","2K"]},{"name":"width","type":"integer","default":null,"required":true}]},{"display_name":"Minimax Hailuo","job_set_type":"minimax_hailuo","type":"video","params":[{"name":"duration","type":"string","default":6,"required":false,"enum":["6","10"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"model","type":"string","default":"minimax-2.3","required":false,"enum":["minimax","minimax-fast","minimax-2.3","minimax-2.3-fast"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"768","required":false,"enum":["512","768","1080"]}]},{"display_name":"Mirelo Text to Audio","job_set_type":"mirelo_text_to_audio","type":"audio","params":[{"name":"duration","type":"number","default":null,"required":true},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"MS Image","job_set_type":"ms_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"avatars","type":"array","default":null,"required":false},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"brand_kit_id","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"product_ids","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"low","required":false,"enum":["low","medium","high"]},{"name":"resolution","type":"string","default":"1k","required":false},{"name":"style_id","type":"object","default":null,"required":false}]},{"display_name":"Multi-Image to 3D","job_set_type":"multi_image_to_3d","type":"3d","params":[{"name":"animation_action_id","type":"object","default":null,"required":false},{"name":"enable_animation","type":"boolean","default":false,"required":false},{"name":"enable_pbr","type":"object","default":null,"required":false},{"name":"enable_rigging","type":"boolean","default":false,"required":false},{"name":"enable_safety_checker","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"pose_mode","type":"object","default":null,"required":false},{"name":"rigging_height_meters","type":"object","default":null,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"should_remesh","type":"object","default":null,"required":false},{"name":"should_texture","type":"boolean","default":false,"required":false},{"name":"symmetry_mode","type":"object","default":null,"required":false},{"name":"target_polycount","type":"object","default":null,"required":false},{"name":"texture_image_url","type":"object","default":null,"required":false},{"name":"texture_prompt","type":"object","default":null,"required":false},{"name":"topology","type":"object","default":null,"required":false}]},{"display_name":"Nano Banana","job_set_type":"nano_banana","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2_ai_stylist","type":"image","params":[{"name":"background_preset_id","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_image","type":"object","default":null,"required":true},{"name":"outfit_preset_ids","type":"array","default":null,"required":false},{"name":"pose_preset_id","type":"object","default":null,"required":false},{"name":"user_outfit_ids","type":"array","default":null,"required":false}]},{"display_name":"Nano Banana 2 Lite","job_set_type":"nano_banana_2_lite","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false},{"name":"thinking","type":"string","default":"HIGH","required":false,"enum":["MINIMAL","HIGH"]}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2_relight","type":"image","params":[{"name":"brightness","type":"integer","default":null,"required":true},{"name":"color","type":"string","default":null,"required":true},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_image","type":"object","default":null,"required":true},{"name":"light_quality","type":"string","default":null,"required":true,"enum":["hard","sharp","soft"]},{"name":"light_source","type":"string","default":null,"required":true,"enum":["mdl","mdr","mul","mur","bml","fml","fmr","bmm","mml","mmr","fmm","bmr","mdm","mum","bdr","fdl","bur","ful","bdl","fdr","bul","fur","bdm","fdm","bum","fum"]},{"name":"remove_bg","type":"boolean","default":false,"required":false}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2_shots","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_images","type":"array","default":null,"required":true}]},{"display_name":"Nano Banana Pro","job_set_type":"nano_banana_2_skin_enhancer","type":"image","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_image","type":"object","default":null,"required":true},{"name":"preset_id","type":"string","default":null,"required":true},{"name":"remove_bg","type":"boolean","default":false,"required":false}]},{"display_name":"Nano Banana 2","job_set_type":"nano_banana_flash","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k","4k"]}]},{"display_name":"OpenAI Hazel","job_set_type":"openai_hazel","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","3:2","2:3","auto"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"medium","required":false,"enum":["low","medium","high"]}]},{"display_name":"Outpaint","job_set_type":"outpaint","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"21:9","required":false,"enum":["auto","1:1","3:2","2:3","4:3","3:4","4:5","5:4","9:16","16:9","21:9"]},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Qwen Audio 3.0 TTS Flash","job_set_type":"qwen_audio_tts","type":"audio","params":[{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"format","type":"string","default":"mp3","required":false,"enum":["wav","mp3","pcm","ogg_opus"]},{"name":"instruction","type":"object","default":null,"required":false},{"name":"language","type":"object","default":null,"required":false},{"name":"pitch_rate","type":"number","default":1,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sample_rate","type":"string","default":24000,"required":false,"enum":["8000","16000","22050","24000","44100","48000"]},{"name":"seed","type":"integer","default":0,"required":false},{"name":"speech_rate","type":"number","default":1,"required":false},{"name":"voice_id","type":"string","default":null,"required":true},{"name":"voice_type","type":"string","default":null,"required":true,"enum":["preset","element"]},{"name":"volume","type":"integer","default":50,"required":false}]},{"display_name":"Angles","job_set_type":"qwen_camera_control","type":"image","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"height","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"move_forward_level","type":"integer","default":0,"required":false},{"name":"remove_bg","type":"boolean","default":false,"required":false},{"name":"rotate_degree","type":"integer","default":0,"required":false},{"name":"vertical_angle","type":"integer","default":0,"required":false},{"name":"width","type":"object","default":null,"required":false}]},{"display_name":"Recraft V4.1","job_set_type":"recraft_v4_1","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","3:4","4:3","4:5","5:4","3:2","2:3","16:9","9:16","21:9"]},{"name":"background_color","type":"object","default":null,"required":false},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"colors","type":"array","default":null,"required":false},{"name":"model_type","type":"string","default":"standard","required":false,"enum":["standard","vector","utility","utility_vector"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"1k","required":false,"enum":["1k","2k"]}]},{"display_name":"Reframe","job_set_type":"reframe","type":"video","params":[{"name":"aspect_ratio","type":"string","default":null,"required":true,"enum":["21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"duration","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]}]},{"display_name":"3D Objects","job_set_type":"sam_3_3d","type":"3d","params":[{"name":"detection_threshold","type":"object","default":null,"required":false},{"name":"export_textured_glb","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"prompt","type":"string","default":"","required":false},{"name":"seed","type":"object","default":null,"required":false}]},{"display_name":"3D Body","job_set_type":"sam_3_3d_body","type":"3d","params":[{"name":"export_meshes","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"include_3d_keypoints","type":"boolean","default":true,"required":false},{"name":"include_mhr_params","type":"boolean","default":true,"required":false},{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Remove Background","job_set_type":"sam_3_video","type":"video","params":[{"name":"apply_mask","type":"boolean","default":true,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"frames_count","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":true},{"name":"prompt","type":"string","default":"","required":false}]},{"display_name":"Seed Audio 1.0","job_set_type":"seed_audio","type":"audio","params":[{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"expression_intensity","type":"integer","default":5,"required":false},{"name":"format","type":"string","default":"wav","required":false,"enum":["wav","mp3","pcm","ogg_opus"]},{"name":"loudness_rate","type":"integer","default":0,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"mood","type":"number","default":0,"required":false},{"name":"pitch_rate","type":"integer","default":0,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sample_rate","type":"string","default":24000,"required":false,"enum":["8000","16000","24000","32000","44100","48000"]},{"name":"speech_rate","type":"integer","default":0,"required":false},{"name":"voice_id","type":"object","default":null,"required":false},{"name":"voice_style","type":"object","default":null,"required":false},{"name":"voice_type","type":"object","default":null,"required":false},{"name":"voices","type":"array","default":null,"required":false}]},{"display_name":"Seedance 2.0","job_set_type":"seedance_2_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","16:9","9:16","4:3","3:4","1:1","21:9"]},{"name":"bitrate_mode","type":"string","default":"standard","required":false,"enum":["standard","high"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","noir","drama","epic"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["std","fast"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p","4k"]}]},{"display_name":"Seedance 2.0 Mini","job_set_type":"seedance_2_0_mini","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","16:9","9:16","4:3","3:4","1:1","21:9"]},{"name":"bitrate_mode","type":"string","default":"standard","required":false,"enum":["standard","high"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","noir","drama","epic"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p"]}]},{"display_name":"Seedance 2.5","job_set_type":"seedance_2_5","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"bitrate_mode","type":"string","default":"standard","required":false,"enum":["standard","high"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"enhance_prompt","type":"boolean","default":false,"required":false},{"name":"extension_mode","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"genre","type":"string","default":"auto","required":false,"enum":["auto","action","horror","comedy","noir","drama","epic"]},{"name":"height","type":"integer","default":null,"required":true},{"name":"medias","type":"array","default":null,"required":false},{"name":"mode","type":"string","default":"std","required":false,"enum":["std","fast"]},{"name":"model","type":"string","default":"default","required":false,"enum":["default","video_edit","video_extension"]},{"name":"multi_prompt","type":"array","default":null,"required":false},{"name":"multi_shot_mode","type":"string","default":"custom","required":false,"enum":["auto","custom"]},{"name":"multi_shots","type":"boolean","default":false,"required":false},{"name":"preset_id","type":"object","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"prompt_language","type":"string","default":"zh","required":false,"enum":["en","zh"]},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]},{"name":"speedramp","type":"object","default":"auto","required":false},{"name":"use_blur","type":"boolean","default":false,"required":false},{"name":"use_eye_mask","type":"boolean","default":false,"required":false},{"name":"use_transparency","type":"boolean","default":false,"required":false},{"name":"width","type":"integer","default":null,"required":true}]},{"display_name":"Seedance 1.5 Pro","job_set_type":"seedance1_5","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["auto","16:9","9:16","4:3","3:4","1:1","21:9"]},{"name":"duration","type":"string","default":4,"required":false,"enum":["4","8","12"]},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]}]},{"display_name":"Seedream 4.5","job_set_type":"seedream_v4_5","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["auto","1:1","4:3","16:9","3:2","21:9","3:4","9:16","2:3"]},{"name":"input_images","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"basic","required":false,"enum":["basic","high"]}]},{"display_name":"Seedream 5.0 Lite","job_set_type":"seedream_v5_lite","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16","21:9"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"basic","required":false,"enum":["basic","high"]}]},{"display_name":"Seedream 5.0 Pro","job_set_type":"seedream_v5_pro","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"]},{"name":"height","type":"object","default":null,"required":false},{"name":"is_inpaint","type":"boolean","default":false,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"remove_bg","type":"boolean","default":false,"required":false},{"name":"resolution","type":"string","default":"2k","required":false,"enum":["1k","1.5k","2k"]},{"name":"width","type":"object","default":null,"required":false}]},{"display_name":"Sonilo Music","job_set_type":"sonilo_music","type":"audio","params":[{"name":"duration","type":"number","default":null,"required":true},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Soul Cast","job_set_type":"soul_cast","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","5:4","4:5","21:9","9:21"]},{"name":"budget","type":"integer","default":50,"required":false},{"name":"prompt","type":"object","default":null,"required":false}]},{"display_name":"soul_cinema_studio","job_set_type":"soul_cinema_studio","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9"]},{"name":"custom_reference_id","type":"object","default":null,"required":false},{"name":"enhance_prompt","type":"boolean","default":false,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"2k","required":false,"enum":["1.5k","2k"]},{"name":"style_id","type":"object","default":null,"required":false}]},{"display_name":"Soul Cinematic","job_set_type":"soul_cinematic","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9"]},{"name":"custom_reference_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"2k","required":false,"enum":["1.5k","2k"]}]},{"display_name":"Soul Location","job_set_type":"soul_location","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9","9:21"]},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Sync Lipsync 3","job_set_type":"sync_so","type":"video","params":[{"name":"active_speaker_detection","type":"boolean","default":false,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_audio","type":"object","default":null,"required":true},{"name":"input_video","type":"object","default":null,"required":true},{"name":"occlusion_detection_enabled","type":"boolean","default":false,"required":false},{"name":"sync_mode","type":"string","default":"bounce","required":false,"enum":["bounce","loop","cut_off","silence","remap"]},{"name":"temperature","type":"number","default":0.5,"required":false}]},{"display_name":"Higgsfield Soul 2.0","job_set_type":"text2image_soul_v2","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","16:9","9:16","4:3","3:4","3:2","2:3"]},{"name":"custom_reference_id","type":"object","default":null,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"2k","required":false,"enum":["1.5k","2k"]},{"name":"seed","type":"object","default":null,"required":false}]},{"display_name":"Text to Speech V2","job_set_type":"text2speech_v2","type":"audio","params":[{"name":"batch_size","type":"integer","default":1,"required":false},{"name":"emotion","type":"object","default":null,"required":false},{"name":"format","type":"string","default":"mp3","required":false,"enum":["mp3","wav"]},{"name":"language_boost","type":"string","default":"auto","required":false,"enum":["auto","af","ar","bg","ca","cs","da","de","el","en","es","fa","fi","fil","fr","he","hi","hr","hu","id","it","ja","ko","ms","nl","nn","no","pl","pt","ro","ru","sk","sl","sv","ta","th","tr","uk","vi","yue","zh"]},{"name":"model","type":"string","default":null,"required":true,"enum":["elevenlabs","minimax","seed_speech","vibe_voice","cozy_voice"]},{"name":"pitch","type":"integer","default":0,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"sample_rate","type":"string","default":32000,"required":false,"enum":["8000","16000","22050","24000","32000","44100"]},{"name":"speed","type":"number","default":1,"required":false},{"name":"stability","type":"object","default":null,"required":false},{"name":"text_normalization","type":"boolean","default":false,"required":false},{"name":"voice_id","type":"string","default":null,"required":true},{"name":"voice_type","type":"string","default":null,"required":true,"enum":["preset","element"]},{"name":"volume","type":"number","default":1,"required":false}]},{"display_name":"Topaz","job_set_type":"topaz_image","type":"image","params":[{"name":"denoise","type":"number","default":0,"required":false},{"name":"face_enhancement","type":"boolean","default":false,"required":false},{"name":"face_enhancement_creativity","type":"number","default":0,"required":false},{"name":"face_enhancement_strength","type":"number","default":0,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_image","type":"object","default":null,"required":true},{"name":"model","type":"string","default":"Standard V2","required":false,"enum":["Standard V2","Low Resolution V2","CGI","High Fidelity V2","Text Refine"]},{"name":"output_height","type":"integer","default":null,"required":true},{"name":"output_width","type":"integer","default":null,"required":true},{"name":"sharpen","type":"number","default":0,"required":false}]},{"display_name":"Topaz","job_set_type":"topaz_image_generative","type":"image","params":[{"name":"autoprompt","type":"boolean","default":true,"required":false},{"name":"creativity","type":"integer","default":1,"required":false},{"name":"denoise","type":"number","default":0,"required":false},{"name":"face_enhancement","type":"boolean","default":false,"required":false},{"name":"face_enhancement_creativity","type":"number","default":0,"required":false},{"name":"face_enhancement_strength","type":"number","default":0,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_image","type":"object","default":null,"required":true},{"name":"model","type":"string","default":"Redefine","required":false,"enum":["Standard MAX","Redefine","Recovery","Recovery V2"]},{"name":"output_height","type":"integer","default":null,"required":true},{"name":"output_width","type":"integer","default":null,"required":true},{"name":"prompt","type":"string","default":"","required":false},{"name":"sharpen","type":"number","default":0,"required":false},{"name":"texture","type":"integer","default":1,"required":false}]},{"display_name":"Topaz","job_set_type":"topaz_video","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","21:9","16:9","4:3","1:1","3:4","9:16"]},{"name":"duration","type":"object","default":null,"required":false},{"name":"enhancement","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"frame_interpolation","type":"object","default":null,"required":false},{"name":"frame_rate","type":"number","default":30,"required":false},{"name":"frames_count","type":"object","default":null,"required":false},{"name":"input_height","type":"object","default":null,"required":false},{"name":"input_video","type":"object","default":null,"required":false},{"name":"input_video_size","type":"integer","default":0,"required":false},{"name":"input_width","type":"object","default":null,"required":false},{"name":"resolution","type":"string","default":"1080p","required":false,"enum":["1080p","2160p"]}]},{"display_name":"Text to 3D","job_set_type":"tripo_3d","type":"3d","params":[{"name":"auto_size","type":"boolean","default":false,"required":false},{"name":"face_limit","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"geometry_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"negative_prompt","type":"object","default":null,"required":false},{"name":"pbr","type":"boolean","default":true,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"seed","type":"object","default":null,"required":false},{"name":"texture","type":"boolean","default":true,"required":false},{"name":"texture_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]}]},{"display_name":"Tripo H3.1 Image to 3D","job_set_type":"tripo_h3_1_image_to_3d","type":"3d","params":[{"name":"auto_size","type":"boolean","default":false,"required":false},{"name":"face_limit","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"geometry_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"medias","type":"array","default":null,"required":true},{"name":"orientation","type":"string","default":"default","required":false,"enum":["default","align_image"]},{"name":"pbr","type":"boolean","default":true,"required":false},{"name":"quad","type":"boolean","default":false,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"texture","type":"boolean","default":true,"required":false},{"name":"texture_alignment","type":"string","default":"original_image","required":false,"enum":["original_image","geometry"]},{"name":"texture_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"texture_seed","type":"object","default":null,"required":false}]},{"display_name":"Tripo H3.1 Multiview to 3D","job_set_type":"tripo_h3_1_multiview_to_3d","type":"3d","params":[{"name":"auto_size","type":"boolean","default":false,"required":false},{"name":"face_limit","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"geometry_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"medias","type":"array","default":null,"required":true},{"name":"orientation","type":"string","default":"default","required":false,"enum":["default","align_image"]},{"name":"pbr","type":"boolean","default":true,"required":false},{"name":"quad","type":"boolean","default":false,"required":false},{"name":"seed","type":"object","default":null,"required":false},{"name":"texture","type":"boolean","default":true,"required":false},{"name":"texture_alignment","type":"string","default":"original_image","required":false,"enum":["original_image","geometry"]},{"name":"texture_quality","type":"string","default":"standard","required":false,"enum":["standard","detailed"]},{"name":"texture_seed","type":"object","default":null,"required":false}]},{"display_name":"Google Veo 3","job_set_type":"veo3","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16"]},{"name":"input_image","type":"object","default":null,"required":true},{"name":"model","type":"string","default":"veo-3-fast","required":false,"enum":["veo-3-preview","veo-3-fast"]},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Google Veo 3.1","job_set_type":"veo3_1","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16"]},{"name":"duration","type":"string","default":8,"required":false,"enum":["4","6","8"]},{"name":"input_image","type":"object","default":null,"required":false},{"name":"model","type":"string","default":"veo-3-1-fast","required":false,"enum":["veo-3-1-preview","veo-3-1-fast"]},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"basic","required":false,"enum":["basic","high","ultra"]}]},{"display_name":"Google Veo 3.1 Lite","job_set_type":"veo3_1_lite","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","auto"]},{"name":"duration","type":"string","default":8,"required":false,"enum":["4","6","8"]},{"name":"generate_audio","type":"boolean","default":false,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true}]},{"display_name":"Video Background Remover","job_set_type":"video_background_remover","type":"video","params":[{"name":"medias","type":"array","default":null,"required":true}]},{"display_name":"Video Deflicker","job_set_type":"video_deflicker","type":"video","params":[{"name":"duration","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_video","type":"object","default":null,"required":true}]},{"display_name":"Video Upscale","job_set_type":"video_upscale","type":"video","params":[{"name":"duration","type":"object","default":null,"required":false},{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_video","type":"object","default":null,"required":true}]},{"display_name":"voice_change","job_set_type":"voice_change","type":"video","params":[{"name":"folder_id","type":"object","default":null,"required":false},{"name":"input_video","type":"object","default":null,"required":true},{"name":"voice_id","type":"string","default":null,"required":true},{"name":"voice_type","type":"string","default":"preset","required":false,"enum":["preset","element"]}]},{"display_name":"Wan 2.6 Video","job_set_type":"wan2_6","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1"]},{"name":"duration","type":"string","default":5,"required":false,"enum":["5","10","15"]},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"quality","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"Wan 2.7","job_set_type":"wan2_7","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"16:9","required":false,"enum":["16:9","9:16","1:1","4:3","3:4"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["720p","1080p"]}]},{"display_name":"Wan 3.0","job_set_type":"wan3_0","type":"video","params":[{"name":"aspect_ratio","type":"string","default":"auto","required":false,"enum":["auto","16:9","9:16","1:1","4:3","3:4"]},{"name":"duration","type":"integer","default":5,"required":false},{"name":"enable_thinking","type":"boolean","default":false,"required":false},{"name":"generate_audio","type":"boolean","default":true,"required":false},{"name":"medias","type":"array","default":null,"required":false},{"name":"prompt","type":"string","default":null,"required":true},{"name":"resolution","type":"string","default":"720p","required":false,"enum":["480p","720p","1080p"]}]},{"display_name":"Z Image","job_set_type":"z_image","type":"image","params":[{"name":"aspect_ratio","type":"string","default":"1:1","required":false,"enum":["1:1","4:3","3:4","16:9","9:16"]},{"name":"prompt","type":"string","default":null,"required":true}]}]'), j = {
  models: h
}, k = j, S = k.models, M = {
  text2image_soul_v2: "hf-soul-v2",
  nano_banana_2: "hf-nano-banana-pro",
  gpt_image_2: "hf-gpt-image-2",
  seedance_2_0: "hf-seedance-2",
  kling3_0: "hf-kling-3",
  veo3_1: "hf-veo-3-1"
}, L = /* @__PURE__ */ new Set([
  "input_image",
  "ref_image",
  "sketch",
  "texture_image_url"
]), I = /* @__PURE__ */ new Set(["input_images"]), w = /* @__PURE__ */ new Set(["input_video", "video"]), R = /* @__PURE__ */ new Set(["input_audio"]);
function s(a) {
  return a.split(/[_-]+/).filter(Boolean).map((e) => e.charAt(0).toUpperCase() + e.slice(1)).join(" ");
}
function A(a) {
  return M[a] ?? `hf-${a.replaceAll("_", "-")}`;
}
function F(a) {
  return a === "3d" ? "model3d" : a;
}
function D(a, e) {
  let l, t, r = !1;
  if (L.has(e.name) ? (l = "image", t = a.type === "video" && e.name === "input_image" ? "start_image" : "image") : I.has(e.name) ? (l = "image", t = "image", r = !0) : w.has(e.name) ? (l = "video", t = "video") : R.has(e.name) ? (l = "audio", t = "audio") : e.name === "model_url" ? l = "model3d" : e.name === "urls" ? (l = "media", r = !0) : e.name === "medias" && (r = !0, a.type === "image" || a.type === "3d" ? (l = "image", t = "image") : a.type === "text" ? (l = "video", t = "video") : l = "media"), !!l)
    return {
      id: e.name,
      portType: l,
      label: s(e.name),
      required: e.required,
      falParam: e.name,
      fieldType: "port",
      schemaType: e.type,
      multiple: r,
      mediaRole: t,
      ...e.default !== void 0 ? { default: e.default } : {}
    };
}
function G(a, e) {
  var r;
  const l = D(a, e);
  if (l) return l;
  const t = {
    id: e.name,
    portType: "config",
    label: s(e.name),
    required: e.required,
    falParam: e.name,
    schemaType: e.type,
    ...e.default !== void 0 ? { default: e.default } : {}
  };
  return e.type === "string" ? (r = e.enum) != null && r.length ? {
    ...t,
    portType: "text",
    fieldType: "select",
    options: e.enum.map((i) => ({ value: i, label: i }))
  } : /(^|_)prompt$/.test(e.name) || e.name === "instruction" ? { ...t, portType: "text", fieldType: "port" } : { ...t, portType: "text", fieldType: "text" } : e.type === "integer" || e.type === "number" ? { ...t, portType: "number", fieldType: "number" } : e.type === "boolean" ? { ...t, fieldType: "toggle" } : {
    ...t,
    fieldType: "json",
    placeholder: e.type === "array" ? "[]" : e.type === "object" ? "{}" : "null"
  };
}
function E(a, e) {
  const l = (t, r, i, v, P = !1) => ({
    id: t,
    portType: i,
    label: r,
    required: !1,
    falParam: e.name,
    fieldType: "port",
    schemaType: e.type,
    mediaRole: v,
    multiple: P
  });
  return a.job_set_type === "text2image_soul_v2" && e.name === "medias" ? [l("image_url", "Reference Image", "image", "image")] : a.job_set_type === "nano_banana_2" && e.name === "input_images" ? [l("image_url", "Reference Images", "image", "image", !0)] : a.job_set_type === "gpt_image_2" && e.name === "medias" ? [l("image_url", "Reference Images", "image", "image", !0)] : a.job_set_type === "seedance_2_0" && e.name === "medias" ? [
    l("start_image_url", "First Frame", "image", "start_image"),
    l("end_image_url", "Last Frame", "image", "end_image"),
    l("image_references", "Image References", "image", "image", !0),
    l("video_references", "Video References", "video", "video", !0),
    l("audio_references", "Audio References", "audio", "audio", !0)
  ] : a.job_set_type === "kling3_0" && e.name === "medias" ? [
    l("start_image_url", "First Frame", "image", "start_image"),
    l("end_image_url", "Last Frame", "image", "end_image")
  ] : a.job_set_type === "veo3_1" && e.name === "input_image" ? [l("start_image_url", "First Frame", "image", "start_image")] : [];
}
function z(a = S) {
  const e = {};
  for (const l of a) {
    const t = A(l.job_set_type), r = F(l.type);
    if (e[t]) throw new Error(`Duplicate Higgsfield node type: ${t}`);
    e[t] = {
      id: l.job_set_type,
      nodeType: t,
      name: l.display_name,
      category: r,
      description: `Higgsfield ${l.type.toUpperCase()} model`,
      inputs: l.params.flatMap((i) => [
        G(l, i),
        ...E(l, i)
      ]),
      outputType: r,
      outputs: [{ id: r, portType: r, label: r === "model3d" ? "3D Model" : s(r) }],
      provider: "higgsfield",
      responseMapping: { path: r === "text" ? "text" : "output.url" }
    };
  }
  return e;
}
const V = z(), m = [
  { value: "standard", label: "Standard (720p)" },
  { value: "pro", label: "Pro (1080p)" },
  { value: "4k", label: "4K" }
], C = [
  { value: "pro", label: "Pro (up to 1080p)" },
  { value: "standard", label: "Standard (720p)" }
], f = [
  { value: "pro", label: "Pro" },
  { value: "fast", label: "Fast" }
];
function q(a) {
  return a === "kling-3-text" || a === "kling-3-image";
}
function K(a, e) {
  return `fal-ai/kling-video/v3/${e === "standard" || e === "4k" ? e : "pro"}/${a}`;
}
function N(a) {
  return q(a) || a === "sora-2" || a === "ltx-2-3-text" || a === "ltx-2-3-image";
}
function J(a, e, l) {
  const t = l.quality ?? "pro";
  return q(a) ? K(a === "kling-3-image" ? "image-to-video" : "text-to-video", t) : a === "sora-2" ? t === "standard" ? "fal-ai/sora-2/image-to-video" : "fal-ai/sora-2/image-to-video/pro" : a === "ltx-2-3-text" ? t === "fast" ? "fal-ai/ltx-2.3/text-to-video/fast" : "fal-ai/ltx-2.3/text-to-video" : a === "ltx-2-3-image" ? t === "fast" ? "fal-ai/ltx-2.3/image-to-video/fast" : "fal-ai/ltx-2.3/image-to-video" : l.hasImageInputs && e.altId ? e.altId : e.id;
}
function Y(a, e, l) {
  N(a) && delete l.quality, a === "sora-2" && !e.endsWith("/pro") && (l.resolution === "1080p" || l.resolution === "true_1080p") && (l.resolution = "720p");
}
const y = Array.from({ length: 13 }, (a, e) => {
  const l = String(e + 3);
  return { value: l, label: `${l}s` };
}), o = ["6", "8", "10"].map((a) => ({ value: a, label: `${a}s` })), b = ["6", "8", "10", "12", "14", "16", "18", "20"].map((a) => ({ value: a, label: `${a}s` })), p = [
  { value: "24", label: "24" },
  { value: "25", label: "25" },
  { value: "48", label: "48" },
  { value: "50", label: "50" }
], O = [{ value: "25", label: "25" }, { value: "50", label: "50" }], n = [
  { value: "1080p", label: "1080p" },
  { value: "1440p", label: "1440p" },
  { value: "2160p", label: "4K" }
], X = [{ value: "1080p", label: "1080p" }, { value: "1440p", label: "1440p" }, { value: "2160p", label: "4K" }], u = [
  { value: "square_hd", label: "1024x1024" },
  { value: "square", label: "512x512" },
  { value: "portrait_4_3", label: "Portrait 4:3" },
  { value: "portrait_16_9", label: "Portrait 16:9" },
  { value: "landscape_4_3", label: "Landscape 4:3" },
  { value: "landscape_16_9", label: "Landscape 16:9" }
], T = [
  { value: "auto", label: "Auto" },
  { value: "21:9", label: "21:9" },
  { value: "16:9", label: "16:9" },
  { value: "3:2", label: "3:2" },
  { value: "4:3", label: "4:3" },
  { value: "5:4", label: "5:4" },
  { value: "1:1", label: "1:1" },
  { value: "4:5", label: "4:5" },
  { value: "3:4", label: "3:4" },
  { value: "2:3", label: "2:3" },
  { value: "9:16", label: "9:16" }
], U = [
  ...T,
  { value: "4:1", label: "4:1" },
  { value: "1:4", label: "1:4" },
  { value: "8:1", label: "8:1" },
  { value: "1:8", label: "1:8" }
], d = [{ value: "png", label: "PNG" }, { value: "jpeg", label: "JPEG" }], g = [...d, { value: "webp", label: "WebP" }], _ = [
  { value: "mp3_44100_128", label: "MP3 128k" },
  { value: "mp3_44100_192", label: "MP3 192k" },
  { value: "mp3_44100_96", label: "MP3 96k" },
  { value: "mp3_44100_64", label: "MP3 64k" },
  { value: "mp3_44100_32", label: "MP3 32k" },
  { value: "pcm_44100", label: "PCM" }
], c = [{ value: "5", label: "5s" }, { value: "10", label: "10s" }], B = {
  "flux-dev": {
    id: "fal-ai/flux/dev",
    nodeType: "flux-dev",
    name: "FLUX Dev",
    category: "image",
    description: "High quality image generation",
    outputType: "image",
    responseMapping: { path: "images[0].url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_size", portType: "text", label: "Size", required: !1, falParam: "image_size", fieldType: "select", default: "landscape_4_3", options: u },
      { id: "num_images", portType: "number", label: "Num Images", required: !1, falParam: "num_images", fieldType: "number", default: 1, min: 1, max: 4, step: 1 },
      { id: "output_format", portType: "text", label: "Format", required: !1, falParam: "output_format", fieldType: "select", default: "jpeg", options: d },
      { id: "enable_safety_checker", portType: "number", label: "Safety Checker", required: !1, falParam: "enable_safety_checker", fieldType: "toggle", default: !0 },
      { id: "acceleration", portType: "text", label: "Acceleration", required: !1, falParam: "acceleration", fieldType: "select", default: "none", options: [
        { value: "none", label: "None" },
        { value: "regular", label: "Regular" },
        { value: "high", label: "High" }
      ] },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: -1 },
      { id: "guidance_scale", portType: "number", label: "Guidance", required: !1, falParam: "guidance_scale", fieldType: "range", default: 3.5, min: 0, max: 20, step: 0.5 },
      { id: "num_inference_steps", portType: "number", label: "Steps", required: !1, falParam: "num_inference_steps", fieldType: "range", default: 28, min: 1, max: 50, step: 1 }
    ]
  },
  "flux-2-max": {
    id: "fal-ai/flux-2-max",
    nodeType: "flux-2-max",
    name: "FLUX 2 Max",
    category: "image",
    description: "Latest FLUX model",
    outputType: "image",
    responseMapping: { path: "images[0].url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_size", portType: "text", label: "Size", required: !1, falParam: "image_size", fieldType: "select", default: "landscape_4_3", options: u },
      { id: "num_images", portType: "number", label: "Num Images", required: !1, falParam: "num_images", fieldType: "number", default: 1, min: 1, max: 4, step: 1 },
      { id: "output_format", portType: "text", label: "Format", required: !1, falParam: "output_format", fieldType: "select", default: "jpeg", options: d },
      { id: "enable_safety_checker", portType: "number", label: "Safety Checker", required: !1, falParam: "enable_safety_checker", fieldType: "toggle", default: !0 },
      { id: "safety_tolerance", portType: "text", label: "Safety Tolerance", required: !1, falParam: "safety_tolerance", fieldType: "select", default: "2", options: [
        { value: "1", label: "1 (strict)" },
        { value: "2", label: "2" },
        { value: "3", label: "3" },
        { value: "4", label: "4" },
        { value: "5", label: "5" },
        { value: "6", label: "6 (permissive)" }
      ] },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: -1 }
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
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "negative_prompt", portType: "text", label: "Negative Prompt", required: !1, falParam: "negative_prompt", fieldType: "port" },
      { id: "image_size", portType: "text", label: "Size", required: !1, falParam: "image_size", fieldType: "select", default: "landscape_4_3", options: u },
      { id: "num_images", portType: "number", label: "Num Images", required: !1, falParam: "num_images", fieldType: "number", default: 1, min: 1, max: 4, step: 1 },
      { id: "format", portType: "text", label: "Format", required: !1, falParam: "format", fieldType: "select", default: "jpeg", options: [
        { value: "jpeg", label: "JPEG" },
        { value: "png", label: "PNG" }
      ] },
      { id: "enable_safety_checker", portType: "number", label: "Safety Checker", required: !1, falParam: "enable_safety_checker", fieldType: "toggle", default: !0 },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: -1 },
      { id: "guidance_scale", portType: "number", label: "Guidance", required: !1, falParam: "guidance_scale", fieldType: "range", default: 7.5, min: 0, max: 20, step: 0.5 },
      { id: "num_inference_steps", portType: "number", label: "Steps", required: !1, falParam: "num_inference_steps", fieldType: "range", default: 25, min: 1, max: 50, step: 1 }
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
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "negative_prompt", portType: "text", label: "Negative Prompt", required: !1, falParam: "negative_prompt", fieldType: "port" },
      { id: "image_size", portType: "text", label: "Size", required: !1, falParam: "image_size", fieldType: "select", default: "landscape_4_3", options: u },
      { id: "num_images", portType: "number", label: "Num Images", required: !1, falParam: "num_images", fieldType: "number", default: 1, min: 1, max: 4, step: 1 },
      { id: "prompt_expansion", portType: "number", label: "Prompt Expansion", required: !1, falParam: "prompt_expansion", fieldType: "toggle", default: !1 },
      { id: "enable_safety_checker", portType: "number", label: "Safety Checker", required: !1, falParam: "enable_safety_checker", fieldType: "toggle", default: !0 },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: -1 },
      { id: "guidance_scale", portType: "number", label: "Guidance", required: !1, falParam: "guidance_scale", fieldType: "range", default: 5, min: 0, max: 20, step: 0.5 },
      { id: "num_inference_steps", portType: "number", label: "Steps", required: !1, falParam: "num_inference_steps", fieldType: "range", default: 28, min: 1, max: 50, step: 1 }
    ]
  },
  "flux-kontext": {
    id: "fal-ai/flux-kontext/text-to-image",
    altId: "fal-ai/flux-kontext/image-to-image",
    nodeType: "flux-kontext",
    name: "Flux Kontext",
    category: "image-edit",
    description: "FLUX Kontext text-to-image and image editing",
    outputType: "image",
    responseMapping: { path: "images[0].url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "Image", required: !1, falParam: "image_url", fieldType: "port" },
      { id: "image_size", portType: "text", label: "Size", required: !1, falParam: "image_size", fieldType: "select", default: "landscape_4_3", options: u },
      { id: "strength", portType: "number", label: "Strength", required: !1, falParam: "strength", fieldType: "range", default: 0.85, min: 0, max: 1, step: 0.05 },
      { id: "num_inference_steps", portType: "number", label: "Steps", required: !1, falParam: "num_inference_steps", fieldType: "range", default: 30, min: 1, max: 50, step: 1 },
      { id: "guidance_scale", portType: "number", label: "Guidance", required: !1, falParam: "guidance_scale", fieldType: "range", default: 2.5, min: 0, max: 20, step: 0.5 },
      { id: "num_images", portType: "number", label: "Num Images", required: !1, falParam: "num_images", fieldType: "number", default: 1, min: 1, max: 4, step: 1 },
      { id: "output_format", portType: "text", label: "Format", required: !1, falParam: "output_format", fieldType: "select", default: "png", options: d },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: -1 }
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
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "Image 1", required: !1, falParam: "image_urls", fieldType: "port" },
      { id: "extra_images", portType: "image", label: "Image", required: !1, falParam: "image_urls", fieldType: "element-list", max: 13 },
      { id: "resolution", portType: "text", label: "Resolution", required: !1, falParam: "resolution", fieldType: "select", default: "1K", options: [
        { value: "1K", label: "1K" },
        { value: "2K", label: "2K" },
        { value: "4K", label: "4K" }
      ] },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: !1, falParam: "aspect_ratio", fieldType: "select", default: "1:1", options: T.filter((a) => a.value !== "auto") },
      { id: "num_images", portType: "number", label: "Num Images", required: !1, falParam: "num_images", fieldType: "number", default: 1, min: 1, max: 4, step: 1 },
      { id: "output_format", portType: "text", label: "Format", required: !1, falParam: "output_format", fieldType: "select", default: "png", options: g },
      { id: "safety_tolerance", portType: "text", label: "Safety Tolerance", required: !1, falParam: "safety_tolerance", fieldType: "select", default: "4", options: [
        { value: "1", label: "1 (strict)" },
        { value: "2", label: "2" },
        { value: "3", label: "3" },
        { value: "4", label: "4" },
        { value: "5", label: "5" },
        { value: "6", label: "6 (permissive)" }
      ] },
      { id: "limit_generations", portType: "number", label: "Limit Generations", required: !1, falParam: "limit_generations", fieldType: "toggle", default: !0 },
      { id: "enable_web_search", portType: "number", label: "Web Search", required: !1, falParam: "enable_web_search", fieldType: "toggle", default: !1 }
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
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "Image 1", required: !1, falParam: "image_urls", fieldType: "port" },
      { id: "extra_images", portType: "image", label: "Image", required: !1, falParam: "image_urls", fieldType: "element-list", max: 13 },
      { id: "resolution", portType: "text", label: "Resolution", required: !1, falParam: "resolution", fieldType: "select", default: "1K", options: [
        { value: "0.5K", label: "0.5K" },
        { value: "1K", label: "1K" },
        { value: "2K", label: "2K" },
        { value: "4K", label: "4K" }
      ] },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: !1, falParam: "aspect_ratio", fieldType: "select", default: "auto", options: U },
      { id: "output_format", portType: "text", label: "Format", required: !1, falParam: "output_format", fieldType: "select", default: "png", options: g },
      { id: "num_images", portType: "number", label: "Num Images", required: !1, falParam: "num_images", fieldType: "number", default: 1, min: 1, max: 4, step: 1 },
      { id: "safety_tolerance", portType: "text", label: "Safety Tolerance", required: !1, falParam: "safety_tolerance", fieldType: "select", default: "4", options: [
        { value: "1", label: "1 (strict)" },
        { value: "2", label: "2" },
        { value: "3", label: "3" },
        { value: "4", label: "4" },
        { value: "5", label: "5" },
        { value: "6", label: "6 (permissive)" }
      ] },
      { id: "limit_generations", portType: "number", label: "Limit Generations", required: !1, falParam: "limit_generations", fieldType: "toggle", default: !0 },
      { id: "enable_web_search", portType: "number", label: "Web Search", required: !1, falParam: "enable_web_search", fieldType: "toggle", default: !1 },
      { id: "thinking_level", portType: "text", label: "Thinking Level", required: !1, falParam: "thinking_level", fieldType: "select", default: "minimal", options: [
        { value: "minimal", label: "Minimal" },
        { value: "high", label: "High" }
      ] }
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
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "negative_prompt", portType: "text", label: "Negative Prompt", required: !1, falParam: "negative_prompt", fieldType: "port" },
      { id: "duration", portType: "text", label: "Duration", required: !1, falParam: "duration", fieldType: "select", default: "8s", options: [
        { value: "4s", label: "4s" },
        { value: "6s", label: "6s" },
        { value: "8s", label: "8s" }
      ] },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: !1, falParam: "aspect_ratio", fieldType: "select", default: "16:9", options: [
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" }
      ] },
      { id: "resolution", portType: "text", label: "Resolution", required: !1, falParam: "resolution", fieldType: "select", default: "720p", options: [
        { value: "720p", label: "720p" },
        { value: "1080p", label: "1080p" },
        { value: "4k", label: "4K" }
      ] },
      { id: "generate_audio", portType: "number", label: "Generate Audio", required: !1, falParam: "generate_audio", fieldType: "toggle", default: !0 },
      { id: "auto_fix", portType: "number", label: "Auto Fix Prompt", required: !1, falParam: "auto_fix", fieldType: "toggle", default: !0 },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: -1 }
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
      { id: "prompt", portType: "text", label: "Prompt", required: !1, falParam: "prompt", fieldType: "port" },
      { id: "multi_prompt", portType: "multi_prompt", label: "Multi Prompt", required: !1, falParam: "multi_prompt", fieldType: "port" },
      { id: "negative_prompt", portType: "text", label: "Negative Prompt", required: !1, falParam: "negative_prompt", fieldType: "port" },
      { id: "duration", portType: "text", label: "Duration", required: !1, falParam: "duration", fieldType: "select", default: "5", options: y },
      { id: "quality", portType: "text", label: "Quality", required: !1, falParam: "quality", fieldType: "select", default: "pro", options: m },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: !1, falParam: "aspect_ratio", fieldType: "select", default: "16:9", options: [
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" },
        { value: "1:1", label: "1:1" }
      ] },
      { id: "shot_type", portType: "text", label: "Shot Type", required: !1, falParam: "shot_type", fieldType: "select", default: "customize", options: [
        { value: "customize", label: "Customize" },
        { value: "intelligent", label: "Intelligent" }
      ] },
      { id: "generate_audio", portType: "number", label: "Generate Audio", required: !1, falParam: "generate_audio", fieldType: "toggle", default: !0 },
      { id: "cfg_scale", portType: "number", label: "CFG Scale", required: !1, falParam: "cfg_scale", fieldType: "range", default: 0.5, min: 0, max: 1, step: 0.1 }
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
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "multi_prompt", portType: "multi_prompt", label: "Multi Prompt", required: !1, falParam: "multi_prompt", fieldType: "port" },
      { id: "start_image_url", portType: "image", label: "First Frame", required: !0, falParam: "start_image_url", fieldType: "port" },
      { id: "end_image_url", portType: "image", label: "Last Frame", required: !1, falParam: "end_image_url", fieldType: "port" },
      { id: "negative_prompt", portType: "text", label: "Negative Prompt", required: !1, falParam: "negative_prompt", fieldType: "port" },
      { id: "elements", portType: "image", label: "Element", required: !1, falParam: "elements", fieldType: "element-list", max: 5 },
      { id: "duration", portType: "text", label: "Duration", required: !1, falParam: "duration", fieldType: "select", default: "5", options: y },
      { id: "quality", portType: "text", label: "Quality", required: !1, falParam: "quality", fieldType: "select", default: "pro", options: m },
      { id: "shot_type", portType: "text", label: "Shot Type", required: !1, falParam: "shot_type", fieldType: "select", default: "customize", options: [
        { value: "customize", label: "Customize" },
        { value: "intelligent", label: "Intelligent" }
      ] },
      { id: "generate_audio", portType: "number", label: "Generate Audio", required: !1, falParam: "generate_audio", fieldType: "toggle", default: !0 },
      { id: "cfg_scale", portType: "number", label: "CFG Scale", required: !1, falParam: "cfg_scale", fieldType: "range", default: 0.5, min: 0, max: 1, step: 0.1 }
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
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "negative_prompt", portType: "text", label: "Negative Prompt", required: !1, falParam: "negative_prompt", fieldType: "port" },
      { id: "duration", portType: "text", label: "Duration", required: !1, falParam: "duration", fieldType: "select", default: "5", options: [
        { value: "5", label: "5s" },
        { value: "10", label: "10s" }
      ] },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: !1, falParam: "aspect_ratio", fieldType: "select", default: "16:9", options: [
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" },
        { value: "1:1", label: "1:1" }
      ] },
      { id: "cfg_scale", portType: "number", label: "CFG Scale", required: !1, falParam: "cfg_scale", fieldType: "range", default: 0.5, min: 0, max: 1, step: 0.1 }
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
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "First Frame", required: !0, falParam: "image_url", fieldType: "port" },
      { id: "tail_image_url", portType: "image", label: "Last Frame", required: !1, falParam: "tail_image_url", fieldType: "port" },
      { id: "negative_prompt", portType: "text", label: "Negative Prompt", required: !1, falParam: "negative_prompt", fieldType: "port" },
      { id: "duration", portType: "text", label: "Duration", required: !1, falParam: "duration", fieldType: "select", default: "5", options: c },
      { id: "cfg_scale", portType: "number", label: "CFG Scale", required: !1, falParam: "cfg_scale", fieldType: "range", default: 0.5, min: 0, max: 1, step: 0.1 }
    ]
  },
  "kling-first-last": {
    id: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
    nodeType: "kling-first-last",
    name: "Kling First & Last Frame",
    category: "video",
    description: "Kling first + last frame",
    outputType: "video",
    responseMapping: { path: "video.url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "First Frame", required: !0, falParam: "image_url", fieldType: "port" },
      { id: "tail_image_url", portType: "image", label: "Last Frame", required: !1, falParam: "tail_image_url", fieldType: "port" },
      { id: "negative_prompt", portType: "text", label: "Negative Prompt", required: !1, falParam: "negative_prompt", fieldType: "port" },
      { id: "duration", portType: "text", label: "Duration", required: !1, falParam: "duration", fieldType: "select", default: "5", options: c },
      { id: "cfg_scale", portType: "number", label: "CFG Scale", required: !1, falParam: "cfg_scale", fieldType: "range", default: 0.5, min: 0, max: 1, step: 0.1 }
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
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "prompt_optimizer", portType: "number", label: "Prompt Optimizer", required: !1, falParam: "prompt_optimizer", fieldType: "toggle", default: !0 }
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
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "Image", required: !0, falParam: "image_url", fieldType: "port" },
      { id: "end_image_url", portType: "image", label: "Last Frame", required: !1, falParam: "end_image_url", fieldType: "port" },
      { id: "negative_prompt", portType: "text", label: "Negative Prompt", required: !1, falParam: "negative_prompt", fieldType: "port" },
      { id: "resolution", portType: "text", label: "Resolution", required: !1, falParam: "resolution", fieldType: "select", default: "720p", options: [
        { value: "480p", label: "480p" },
        { value: "580p", label: "580p" },
        { value: "720p", label: "720p" }
      ] },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: !1, falParam: "aspect_ratio", fieldType: "select", default: "auto", options: [
        { value: "auto", label: "Auto" },
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" },
        { value: "1:1", label: "1:1" }
      ] },
      { id: "num_frames", portType: "number", label: "Frames", required: !1, falParam: "num_frames", fieldType: "range", default: 81, min: 17, max: 161, step: 4 },
      { id: "frames_per_second", portType: "number", label: "FPS", required: !1, falParam: "frames_per_second", fieldType: "range", default: 16, min: 4, max: 60, step: 1 },
      { id: "guidance_scale", portType: "number", label: "Guidance", required: !1, falParam: "guidance_scale", fieldType: "range", default: 3.5, min: 1, max: 10, step: 0.5 },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: -1 }
    ]
  },
  "seedance-2": {
    id: "bytedance/seedance-2.0/text-to-video",
    altId: "bytedance/seedance-2.0/image-to-video",
    nodeType: "seedance-2",
    name: "Seedance 2.0",
    category: "video",
    description: "ByteDance Seedance 2.0 text/image-to-video (fal.ai)",
    outputType: "video",
    responseMapping: { path: "video.url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "First Frame", required: !1, falParam: "image_url", fieldType: "port" },
      { id: "end_image_url", portType: "image", label: "Last Frame", required: !1, falParam: "end_image_url", fieldType: "port" },
      { id: "duration", portType: "text", label: "Duration", required: !1, falParam: "duration", fieldType: "select", default: "auto", options: [
        { value: "auto", label: "Auto" },
        { value: "4", label: "4s" },
        { value: "5", label: "5s" },
        { value: "6", label: "6s" },
        { value: "7", label: "7s" },
        { value: "8", label: "8s" },
        { value: "9", label: "9s" },
        { value: "10", label: "10s" },
        { value: "11", label: "11s" },
        { value: "12", label: "12s" },
        { value: "13", label: "13s" },
        { value: "14", label: "14s" },
        { value: "15", label: "15s" }
      ] },
      { id: "resolution", portType: "text", label: "Resolution", required: !1, falParam: "resolution", fieldType: "select", default: "720p", options: [
        { value: "480p", label: "480p" },
        { value: "720p", label: "720p" },
        { value: "1080p", label: "1080p" }
      ] },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: !1, falParam: "aspect_ratio", fieldType: "select", default: "auto", options: [
        { value: "auto", label: "Auto" },
        { value: "21:9", label: "21:9" },
        { value: "16:9", label: "16:9" },
        { value: "4:3", label: "4:3" },
        { value: "1:1", label: "1:1" },
        { value: "3:4", label: "3:4" },
        { value: "9:16", label: "9:16" }
      ] },
      { id: "generate_audio", portType: "number", label: "Generate Audio", required: !1, falParam: "generate_audio", fieldType: "toggle", default: !0 },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: -1 }
    ]
  },
  "seedance-2-reference": {
    id: "bytedance/seedance-2.0/reference-to-video",
    nodeType: "seedance-2-reference",
    name: "Seedance 2.0 Reference",
    category: "video",
    description: "Seedance 2.0 reference-to-video with multi-modal inputs",
    outputType: "video",
    responseMapping: { path: "video.url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "Reference Image 1", required: !1, falParam: "image_urls", fieldType: "port" },
      { id: "extra_images", portType: "image", label: "Image", required: !1, falParam: "image_urls", fieldType: "element-list", max: 8 },
      { id: "reference_video", portType: "video", label: "Reference Video", required: !1, falParam: "video_urls", fieldType: "port" },
      { id: "reference_audio", portType: "audio", label: "Reference Audio", required: !1, falParam: "audio_urls", fieldType: "port" },
      { id: "duration", portType: "text", label: "Duration", required: !1, falParam: "duration", fieldType: "select", default: "auto", options: [
        { value: "auto", label: "Auto" },
        { value: "4", label: "4s" },
        { value: "5", label: "5s" },
        { value: "6", label: "6s" },
        { value: "7", label: "7s" },
        { value: "8", label: "8s" },
        { value: "9", label: "9s" },
        { value: "10", label: "10s" },
        { value: "11", label: "11s" },
        { value: "12", label: "12s" },
        { value: "13", label: "13s" },
        { value: "14", label: "14s" },
        { value: "15", label: "15s" }
      ] },
      { id: "resolution", portType: "text", label: "Resolution", required: !1, falParam: "resolution", fieldType: "select", default: "720p", options: [
        { value: "480p", label: "480p" },
        { value: "720p", label: "720p" },
        { value: "1080p", label: "1080p" }
      ] },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: !1, falParam: "aspect_ratio", fieldType: "select", default: "auto", options: [
        { value: "auto", label: "Auto" },
        { value: "21:9", label: "21:9" },
        { value: "16:9", label: "16:9" },
        { value: "4:3", label: "4:3" },
        { value: "1:1", label: "1:1" },
        { value: "3:4", label: "3:4" },
        { value: "9:16", label: "9:16" }
      ] },
      { id: "generate_audio", portType: "number", label: "Generate Audio", required: !1, falParam: "generate_audio", fieldType: "toggle", default: !0 },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: -1 }
    ]
  },
  "ltx-2-video": {
    id: "fal-ai/ltx-2/text-to-video",
    altId: "fal-ai/ltx-2/image-to-video",
    nodeType: "ltx-2-video",
    name: "LTX 2 Video",
    category: "video",
    description: "LTX text/image-to-video",
    outputType: "video",
    responseMapping: { path: "video.url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "Image", required: !1, falParam: "image_url", fieldType: "port" },
      { id: "duration", portType: "number", label: "Duration", required: !1, falParam: "duration", fieldType: "select", default: "6", options: o },
      { id: "resolution", portType: "text", label: "Resolution", required: !1, falParam: "resolution", fieldType: "select", default: "1080p", options: X },
      { id: "fps", portType: "number", label: "FPS", required: !1, falParam: "fps", fieldType: "select", default: "25", options: O },
      { id: "generate_audio", portType: "number", label: "Generate Audio", required: !1, falParam: "generate_audio", fieldType: "toggle", default: !0 }
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
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "duration", portType: "number", label: "Duration", required: !1, falParam: "duration", fieldType: "select", default: "6", options: o },
      { id: "quality", portType: "text", label: "Quality", required: !1, falParam: "quality", fieldType: "select", default: "pro", options: f },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: !1, falParam: "aspect_ratio", fieldType: "select", default: "16:9", options: [
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" }
      ] },
      { id: "resolution", portType: "text", label: "Resolution", required: !1, falParam: "resolution", fieldType: "select", default: "1080p", options: n },
      { id: "fps", portType: "number", label: "FPS", required: !1, falParam: "fps", fieldType: "select", default: "25", options: p },
      { id: "generate_audio", portType: "number", label: "Generate Audio", required: !1, falParam: "generate_audio", fieldType: "toggle", default: !0 }
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
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "duration", portType: "number", label: "Duration", required: !1, falParam: "duration", fieldType: "select", default: "6", options: b },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: !1, falParam: "aspect_ratio", fieldType: "select", default: "16:9", options: [
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" }
      ] },
      { id: "resolution", portType: "text", label: "Resolution", required: !1, falParam: "resolution", fieldType: "select", default: "1080p", options: n },
      { id: "fps", portType: "number", label: "FPS", required: !1, falParam: "fps", fieldType: "select", default: "25", options: p },
      { id: "generate_audio", portType: "number", label: "Generate Audio", required: !1, falParam: "generate_audio", fieldType: "toggle", default: !0 }
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
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "First Frame", required: !0, falParam: "image_url", fieldType: "port" },
      { id: "end_image_url", portType: "image", label: "Last Frame", required: !1, falParam: "end_image_url", fieldType: "port" },
      { id: "duration", portType: "number", label: "Duration", required: !1, falParam: "duration", fieldType: "select", default: "6", options: o },
      { id: "quality", portType: "text", label: "Quality", required: !1, falParam: "quality", fieldType: "select", default: "pro", options: f },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: !1, falParam: "aspect_ratio", fieldType: "select", default: "auto", options: [
        { value: "auto", label: "Auto" },
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" }
      ] },
      { id: "resolution", portType: "text", label: "Resolution", required: !1, falParam: "resolution", fieldType: "select", default: "1080p", options: n },
      { id: "fps", portType: "number", label: "FPS", required: !1, falParam: "fps", fieldType: "select", default: "25", options: p },
      { id: "generate_audio", portType: "number", label: "Generate Audio", required: !1, falParam: "generate_audio", fieldType: "toggle", default: !0 }
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
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "First Frame", required: !0, falParam: "image_url", fieldType: "port" },
      { id: "end_image_url", portType: "image", label: "Last Frame", required: !1, falParam: "end_image_url", fieldType: "port" },
      { id: "duration", portType: "number", label: "Duration", required: !1, falParam: "duration", fieldType: "select", default: "6", options: b },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: !1, falParam: "aspect_ratio", fieldType: "select", default: "auto", options: [
        { value: "auto", label: "Auto" },
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" }
      ] },
      { id: "resolution", portType: "text", label: "Resolution", required: !1, falParam: "resolution", fieldType: "select", default: "1080p", options: n },
      { id: "fps", portType: "number", label: "FPS", required: !1, falParam: "fps", fieldType: "select", default: "25", options: p },
      { id: "generate_audio", portType: "number", label: "Generate Audio", required: !1, falParam: "generate_audio", fieldType: "toggle", default: !0 }
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
      { id: "audio_url", portType: "audio", label: "Audio", required: !0, falParam: "audio_url", fieldType: "port" },
      { id: "image_url", portType: "image", label: "First Frame", required: !1, falParam: "image_url", fieldType: "port" },
      { id: "prompt", portType: "text", label: "Prompt", required: !1, falParam: "prompt", fieldType: "port" },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: !1, falParam: "aspect_ratio", fieldType: "select", default: "auto", options: [
        { value: "auto", label: "Auto" },
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" }
      ] },
      { id: "guidance_scale", portType: "number", label: "Guidance", required: !1, falParam: "guidance_scale", fieldType: "range", default: 5, min: 1, max: 50, step: 0.5 }
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
      { id: "video_url", portType: "video", label: "Video", required: !0, falParam: "video_url", fieldType: "port" },
      { id: "prompt", portType: "text", label: "Prompt", required: !1, falParam: "prompt", fieldType: "port" },
      { id: "duration", portType: "number", label: "Extension (s)", required: !1, falParam: "duration", fieldType: "range", default: 5, min: 1, max: 20, step: 1 },
      { id: "mode", portType: "text", label: "Mode", required: !1, falParam: "mode", fieldType: "select", default: "end", options: [
        { value: "end", label: "Extend End" },
        { value: "start", label: "Extend Start" }
      ] },
      { id: "context", portType: "number", label: "Context (s)", required: !1, falParam: "context", fieldType: "range", default: 3, min: 1, max: 20, step: 0.5 }
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
      { id: "video_url", portType: "video", label: "Video", required: !0, falParam: "video_url", fieldType: "port" },
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "start_time", portType: "number", label: "Start (s)", required: !1, falParam: "start_time", fieldType: "range", default: 0, min: 0, max: 20, step: 0.5 },
      { id: "duration", portType: "number", label: "Duration (s)", required: !1, falParam: "duration", fieldType: "range", default: 5, min: 2, max: 20, step: 0.5 },
      { id: "retake_mode", portType: "text", label: "Retake Mode", required: !1, falParam: "retake_mode", fieldType: "select", default: "replace_audio_and_video", options: [
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
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "Image", required: !0, falParam: "image_url", fieldType: "port" },
      { id: "duration", portType: "number", label: "Duration", required: !1, falParam: "duration", fieldType: "select", default: "4", options: [
        { value: "4", label: "4s" },
        { value: "8", label: "8s" },
        { value: "12", label: "12s" },
        { value: "16", label: "16s" },
        { value: "20", label: "20s" }
      ] },
      { id: "quality", portType: "text", label: "Quality", required: !1, falParam: "quality", fieldType: "select", default: "pro", options: C },
      { id: "aspect_ratio", portType: "text", label: "Aspect Ratio", required: !1, falParam: "aspect_ratio", fieldType: "select", default: "auto", options: [
        { value: "auto", label: "Auto" },
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" }
      ] },
      { id: "resolution", portType: "text", label: "Resolution", required: !1, falParam: "resolution", fieldType: "select", default: "auto", options: [
        { value: "auto", label: "Auto" },
        { value: "720p", label: "720p" },
        { value: "1080p", label: "1080p" },
        { value: "true_1080p", label: "True 1080p" }
      ] },
      { id: "delete_video", portType: "number", label: "Delete After Gen", required: !1, falParam: "delete_video", fieldType: "toggle", default: !0 },
      { id: "detect_and_block_ip", portType: "number", label: "Block IP Content", required: !1, falParam: "detect_and_block_ip", fieldType: "toggle", default: !0 }
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
      { id: "prompt", portType: "text", label: "Prompt", required: !1, falParam: "prompt", fieldType: "port" },
      { id: "composition_plan", portType: "composition_plan", label: "Composition Plan", required: !1, falParam: "composition_plan", fieldType: "port" },
      { id: "music_length_ms", portType: "number", label: "Duration", required: !1, falParam: "music_length_ms", fieldType: "select", default: "60000", options: [
        { value: "15000", label: "15s" },
        { value: "30000", label: "30s" },
        { value: "60000", label: "1m" },
        { value: "120000", label: "2m" },
        { value: "180000", label: "3m" },
        { value: "300000", label: "5m" }
      ] },
      { id: "force_instrumental", portType: "number", label: "Instrumental", required: !1, falParam: "force_instrumental", fieldType: "toggle", default: !1 },
      { id: "respect_sections_durations", portType: "number", label: "Strict Durations", required: !1, falParam: "respect_sections_durations", fieldType: "toggle", default: !0 },
      { id: "output_format", portType: "text", label: "Format", required: !1, falParam: "output_format", fieldType: "select", default: "mp3_44100_128", options: _ }
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
      { id: "text", portType: "text", label: "Text", required: !0, falParam: "text", fieldType: "port" },
      { id: "voice", portType: "text", label: "Voice", required: !1, falParam: "voice", fieldType: "select", default: "Rachel", options: [
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
      { id: "stability", portType: "number", label: "Stability", required: !1, falParam: "stability", fieldType: "range", default: 0.5, min: 0, max: 1, step: 0.05 },
      { id: "apply_text_normalization", portType: "text", label: "Normalization", required: !1, falParam: "apply_text_normalization", fieldType: "select", default: "auto", options: [
        { value: "auto", label: "Auto" },
        { value: "on", label: "On" },
        { value: "off", label: "Off" }
      ] },
      { id: "timestamps", portType: "number", label: "Timestamps", required: !1, falParam: "timestamps", fieldType: "toggle", default: !1 },
      { id: "language_code", portType: "text", label: "Language Code", required: !1, falParam: "language_code", fieldType: "text", default: "" }
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
      { id: "audio_url", portType: "audio", label: "Audio", required: !0, falParam: "audio_url", fieldType: "port" },
      { id: "voice", portType: "text", label: "Voice", required: !1, falParam: "voice", fieldType: "select", default: "Rachel", options: [
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
      { id: "remove_background_noise", portType: "number", label: "Remove Noise", required: !1, falParam: "remove_background_noise", fieldType: "toggle", default: !1 },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: -1 },
      { id: "output_format", portType: "text", label: "Format", required: !1, falParam: "output_format", fieldType: "select", default: "mp3_44100_128", options: _ }
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
      { id: "audio_url", portType: "audio", label: "Audio", required: !1, falParam: "audio_url", fieldType: "port" },
      { id: "video_url", portType: "video", label: "Video", required: !1, falParam: "video_url", fieldType: "port" }
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
      { id: "audio_url", portType: "audio", label: "Audio", required: !0, falParam: "audio_url", fieldType: "port" },
      { id: "language_code", portType: "text", label: "Language Code", required: !1, falParam: "language_code", fieldType: "text", default: "" },
      { id: "tag_audio_events", portType: "number", label: "Tag Events", required: !1, falParam: "tag_audio_events", fieldType: "toggle", default: !0 },
      { id: "diarize", portType: "number", label: "Diarize", required: !1, falParam: "diarize", fieldType: "toggle", default: !0 }
    ]
  },
  wizper: {
    id: "fal-ai/wizper",
    nodeType: "wizper",
    name: "Wizper (Cloud)",
    category: "audio",
    description: "Cloud transcription with segment timestamps via fal.ai Wizper",
    outputType: "text",
    provider: "fal",
    responseMapping: { path: "text" },
    inputs: [
      { id: "audio_url", portType: "media", label: "Audio / Video", required: !0, falParam: "audio_url", fieldType: "port" },
      { id: "task", portType: "text", label: "Task", required: !1, falParam: "task", fieldType: "select", default: "transcribe", options: [
        { value: "transcribe", label: "Transcribe" },
        { value: "translate", label: "Translate to English" }
      ] },
      { id: "language", portType: "text", label: "Language", required: !1, falParam: "language", fieldType: "text", default: "" },
      { id: "chunk_level", portType: "text", label: "Timestamp Chunks", required: !1, falParam: "chunk_level", fieldType: "select", default: "segment", options: [
        { value: "segment", label: "Segment" },
        { value: "none", label: "None" }
      ] },
      { id: "max_segment_len", portType: "number", label: "Max Segment Length", required: !1, falParam: "max_segment_len", fieldType: "number", default: 29, min: 1 },
      { id: "merge_chunks", portType: "number", label: "Merge Chunks", required: !1, falParam: "merge_chunks", fieldType: "toggle", default: !0 },
      { id: "version", portType: "text", label: "Version", required: !1, falParam: "version", fieldType: "select", default: "3", options: [
        { value: "3", label: "v3 (latest)" },
        { value: "2", label: "v2" }
      ] }
    ]
  },
  "whisper-cloud": {
    id: "fal-ai/whisper",
    nodeType: "whisper-cloud",
    name: "Whisper (Cloud)",
    category: "audio",
    description: "Cloud transcription with optional word-level timestamps via fal.ai Whisper",
    outputType: "text",
    provider: "fal",
    responseMapping: { path: "text" },
    inputs: [
      { id: "audio_url", portType: "media", label: "Audio / Video", required: !0, falParam: "audio_url", fieldType: "port" },
      { id: "task", portType: "text", label: "Task", required: !1, falParam: "task", fieldType: "select", default: "transcribe", options: [
        { value: "transcribe", label: "Transcribe" },
        { value: "translate", label: "Translate to English" }
      ] },
      { id: "language", portType: "text", label: "Language", required: !1, falParam: "language", fieldType: "text", default: "" },
      { id: "chunk_level", portType: "text", label: "Timestamp Chunks", required: !1, falParam: "chunk_level", fieldType: "select", default: "word", options: [
        { value: "word", label: "Word" },
        { value: "segment", label: "Segment" },
        { value: "none", label: "None" }
      ] },
      { id: "diarize", portType: "number", label: "Speaker Diarization", required: !1, falParam: "diarize", fieldType: "toggle", default: !1 },
      { id: "batch_size", portType: "number", label: "Batch Size", required: !1, falParam: "batch_size", fieldType: "number", default: 64, min: 1 },
      { id: "num_speakers", portType: "number", label: "Num Speakers", required: !1, falParam: "num_speakers", fieldType: "number", min: 1 },
      { id: "prompt", portType: "text", label: "Prompt", required: !1, falParam: "prompt", fieldType: "text", default: "" },
      { id: "version", portType: "text", label: "Version", required: !1, falParam: "version", fieldType: "select", default: "3", options: [
        { value: "3", label: "v3" },
        { value: "2", label: "v2" }
      ] }
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
      { id: "audio_url", portType: "audio", label: "Audio", required: !1, falParam: "audio_url", fieldType: "port" },
      { id: "video_url", portType: "video", label: "Video", required: !1, falParam: "video_url", fieldType: "port" },
      { id: "source_lang", portType: "text", label: "Source Language", required: !1, falParam: "source_lang", fieldType: "text", default: "" },
      { id: "target_lang", portType: "text", label: "Target Language", required: !0, falParam: "target_lang", fieldType: "select", default: "es", options: [
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
      { id: "num_speakers", portType: "number", label: "Num Speakers", required: !1, falParam: "num_speakers", fieldType: "number", min: 1 },
      { id: "highest_resolution", portType: "number", label: "High Resolution", required: !1, falParam: "highest_resolution", fieldType: "toggle", default: !0 }
    ]
  },
  "layer-decompose-cloud": {
    id: "fal-ai/sam-3/image",
    nodeType: "layer-decompose-cloud",
    name: "Layer Decompose (Cloud)",
    category: "image-edit",
    description: "Auto-segment a flat design into separate layers with SAM 3 and rebuild a clean background plate",
    outputType: "image",
    provider: "fal",
    responseMapping: { path: "masks.0.url" },
    inputs: [
      { id: "image_url", portType: "image", label: "Image", required: !0, falParam: "image_url", fieldType: "port" },
      { id: "reconstruct_bg", portType: "number", label: "Reconstruct Background", required: !1, falParam: "reconstruct_bg", fieldType: "toggle", default: !0 },
      { id: "prompt", portType: "text", label: "Prompt", required: !1, falParam: "prompt", fieldType: "port" },
      { id: "return_multiple_masks", portType: "number", label: "Multiple Masks", required: !1, falParam: "return_multiple_masks", fieldType: "toggle", default: !0 },
      { id: "max_masks", portType: "number", label: "Max Layers", required: !1, falParam: "max_masks", fieldType: "range", default: 12, min: 1, max: 32, step: 1 },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: 42 }
    ]
  },
  "sam3-segment-cloud": {
    id: "fal-ai/sam-3/image",
    nodeType: "sam3-segment-cloud",
    name: "SAM 3 Segment (Cloud)",
    category: "image-edit",
    description: "Interactive cloud segmentation with prompt, click, and box tools plus edge cleanup",
    outputType: "image",
    provider: "fal",
    responseMapping: { path: "masks.0.url" },
    inputs: [
      { id: "image_url", portType: "image", label: "Image", required: !0, falParam: "image_url", fieldType: "port" },
      { id: "prompt", portType: "text", label: "Prompt", required: !1, falParam: "prompt", fieldType: "port" },
      { id: "apply_mask", portType: "number", label: "Apply Mask", required: !1, falParam: "apply_mask", fieldType: "toggle", default: !0 },
      { id: "return_multiple_masks", portType: "number", label: "Multiple Masks", required: !1, falParam: "return_multiple_masks", fieldType: "toggle", default: !1 },
      { id: "max_masks", portType: "number", label: "Max Masks", required: !1, falParam: "max_masks", fieldType: "range", default: 3, min: 1, max: 32, step: 1 }
    ]
  },
  "sam3-track-cloud": {
    id: "fal-ai/sam-3/video",
    nodeType: "sam3-track-cloud",
    name: "SAM 3 Track (Cloud)",
    category: "video",
    description: "Interactive cloud video segmentation with prompt, click, and box tracking",
    outputType: "video",
    provider: "fal",
    responseMapping: { path: "video.url" },
    inputs: [
      { id: "video_url", portType: "video", label: "Video", required: !0, falParam: "video_url", fieldType: "port" },
      { id: "prompt", portType: "text", label: "Prompt", required: !1, falParam: "prompt", fieldType: "port" },
      { id: "apply_mask", portType: "number", label: "Apply Mask", required: !1, falParam: "apply_mask", fieldType: "toggle", default: !0 },
      { id: "detection_threshold", portType: "number", label: "Detection Threshold", required: !1, falParam: "detection_threshold", fieldType: "range", default: 0.3, min: 0, max: 1, step: 0.05 }
    ]
  },
  "qwen-image-layered": {
    id: "fal-ai/qwen-image-layered",
    nodeType: "qwen-image-layered",
    name: "Qwen Image Layered",
    category: "image-edit",
    description: "Decompose image into RGBA layers via Qwen-Image-Layered",
    outputType: "image",
    provider: "fal",
    responseMapping: { path: "images.0.url" },
    inputs: [
      { id: "image_url", portType: "image", label: "Image", required: !0, falParam: "image_url", fieldType: "port" },
      { id: "prompt", portType: "text", label: "Caption", required: !1, falParam: "prompt", fieldType: "textarea", default: "" },
      { id: "negative_prompt", portType: "text", label: "Negative Prompt", required: !1, falParam: "negative_prompt", fieldType: "port" },
      { id: "num_layers", portType: "number", label: "Layers", required: !1, falParam: "num_layers", fieldType: "range", default: 4, min: 1, max: 10, step: 1 },
      { id: "num_inference_steps", portType: "number", label: "Steps", required: !1, falParam: "num_inference_steps", fieldType: "range", default: 28, min: 1, max: 50, step: 1 },
      { id: "guidance_scale", portType: "number", label: "Guidance", required: !1, falParam: "guidance_scale", fieldType: "range", default: 5, min: 1, max: 20, step: 0.5 },
      { id: "output_format", portType: "text", label: "Format", required: !1, falParam: "output_format", fieldType: "select", default: "png", options: d },
      { id: "enable_safety_checker", portType: "number", label: "Safety Checker", required: !1, falParam: "enable_safety_checker", fieldType: "toggle", default: !0 },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: -1 }
    ]
  },
  "fal-qwen-image-edit": {
    id: "fal-ai/qwen-image-edit-2511",
    nodeType: "fal-qwen-image-edit",
    name: "Qwen Image Edit (Cloud)",
    category: "image-edit",
    description: "Qwen-Image-Edit-2511 via fal.ai cloud",
    outputType: "image",
    provider: "fal",
    responseMapping: { path: "images.0.url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Edit Instruction", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "Image", required: !0, falParam: "image_urls", fieldType: "port" },
      { id: "negative_prompt", portType: "text", label: "Negative Prompt", required: !1, falParam: "negative_prompt", fieldType: "port" },
      { id: "image_size", portType: "text", label: "Size", required: !1, falParam: "image_size", fieldType: "select", default: "landscape_4_3", options: u },
      { id: "num_images", portType: "number", label: "Num Images", required: !1, falParam: "num_images", fieldType: "number", default: 1, min: 1, max: 4, step: 1 },
      { id: "num_inference_steps", portType: "number", label: "Steps", required: !1, falParam: "num_inference_steps", fieldType: "range", default: 28, min: 1, max: 50, step: 1 },
      { id: "guidance_scale", portType: "number", label: "Guidance", required: !1, falParam: "guidance_scale", fieldType: "range", default: 4.5, min: 1, max: 20, step: 0.5 },
      { id: "output_format", portType: "text", label: "Format", required: !1, falParam: "output_format", fieldType: "select", default: "png", options: d },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: -1 }
    ]
  }
}, H = {
  "ltx-local": {
    id: "ltx-local",
    nodeType: "ltx-local",
    name: "LTX 2.3 (Local)",
    category: "video",
    description: "LTX-2 distilled — runs on your Mac via MPS",
    outputType: "video",
    provider: "local",
    responseMapping: { path: "output_path" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "First Frame", required: !1, falParam: "image_url", fieldType: "port" },
      { id: "resolution", portType: "text", label: "Resolution", required: !1, falParam: "resolution", fieldType: "select", default: "896x512", options: [
        { value: "896x512", label: "16:9 — 896×512" },
        { value: "512x896", label: "9:16 — 512×896" },
        { value: "512x512", label: "1:1 — 512×512" },
        { value: "1280x704", label: "16:9 — 1280×704 HD" },
        { value: "704x1280", label: "9:16 — 704×1280 HD" },
        { value: "768x768", label: "1:1 — 768×768 Med" }
      ] },
      { id: "duration_secs", portType: "number", label: "Duration", required: !1, falParam: "duration_secs", fieldType: "select", default: "4", options: [
        { value: "2", label: "2s" },
        { value: "3", label: "3s" },
        { value: "4", label: "4s" },
        { value: "5", label: "5s" },
        { value: "6", label: "6s" },
        { value: "8", label: "8s" },
        { value: "10", label: "10s" },
        { value: "12", label: "12s" }
      ] },
      { id: "frame_rate", portType: "number", label: "FPS", required: !1, falParam: "frame_rate", fieldType: "select", default: "24", options: [
        { value: "24", label: "24fps — film" },
        { value: "25", label: "25fps — PAL" },
        { value: "30", label: "30fps — standard" },
        { value: "60", label: "60fps — smooth" },
        { value: "12", label: "12fps — slow-mo" }
      ] },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: 42 },
      { id: "enhance_prompt", portType: "number", label: "Enhance Prompt", required: !1, falParam: "enhance_prompt", fieldType: "toggle", default: !1 }
    ]
  },
  "qwen-edit-local": {
    id: "qwen-edit-local",
    nodeType: "qwen-edit-local",
    name: "Qwen Image Edit (Local)",
    category: "image-edit",
    description: "Qwen-Image-Edit-2511 — instruction-based image editing on your Mac via MPS",
    outputType: "image",
    provider: "local",
    responseMapping: { path: "output_path" },
    inputs: [
      { id: "prompt", portType: "text", label: "Edit Instruction", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "Image", required: !0, falParam: "image_url", fieldType: "port" },
      { id: "num_inference_steps", portType: "number", label: "Steps", required: !1, falParam: "num_inference_steps", fieldType: "range", default: 50, min: 10, max: 100, step: 1 },
      { id: "guidance_scale", portType: "number", label: "Guidance", required: !1, falParam: "guidance_scale", fieldType: "range", default: 1, min: 0.5, max: 5, step: 0.5 },
      { id: "true_cfg_scale", portType: "number", label: "True CFG", required: !1, falParam: "true_cfg_scale", fieldType: "range", default: 4, min: 1, max: 10, step: 0.5 },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: 42 }
    ]
  },
  "layer-decompose": {
    id: "layer-decompose",
    nodeType: "layer-decompose",
    name: "Layer Decompose (Local)",
    category: "image-edit",
    description: "Auto-extract text, objects, and graphics into separate layers and rebuild a clean plate locally",
    outputType: "image",
    provider: "local",
    responseMapping: { path: "output_path" },
    inputs: [
      { id: "image_url", portType: "image", label: "Image", required: !0, falParam: "image_url", fieldType: "port" },
      { id: "inpainter", portType: "text", label: "Inpainter", required: !1, falParam: "inpainter", fieldType: "select", default: "qwen-edit-local", options: [
        { value: "qwen-edit-local", label: "Qwen Edit (Local)" },
        { value: "qwen-edit-cloud", label: "Qwen Edit (Cloud)" },
        { value: "qwen-edit-runpod", label: "Qwen Edit (RunPod)" },
        { value: "lama", label: "LaMa (Fast)" }
      ] },
      { id: "reconstruct_bg", portType: "number", label: "Reconstruct Background", required: !1, falParam: "reconstruct_bg", fieldType: "toggle", default: !0 },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: 42 }
    ]
  },
  "sam3-segment": {
    id: "sam3-segment",
    nodeType: "sam3-segment",
    name: "SAM 3 Segment",
    category: "image-edit",
    description: "Interactive segmentation — click, draw, or describe to select elements",
    outputType: "image",
    provider: "local",
    responseMapping: { path: "output_path" },
    inputs: [
      { id: "image_url", portType: "image", label: "Image", required: !0, falParam: "image_url", fieldType: "port" }
    ]
  },
  "whisperx-local": {
    id: "whisperx-local",
    nodeType: "whisperx-local",
    name: "WhisperX (Local)",
    category: "audio",
    description: "Speech-to-text with timestamps and speaker diarization",
    outputType: "audio",
    provider: "local",
    responseMapping: { path: "output_text" },
    inputs: [
      { id: "audio_url", portType: "media", label: "Audio / Video", required: !0, falParam: "audio_url", fieldType: "port" },
      { id: "model", portType: "text", label: "Model", required: !1, falParam: "model", fieldType: "select", default: "base", options: [
        { value: "base", label: "Base (fastest)" },
        { value: "medium", label: "Medium (balanced)" },
        { value: "large-v3", label: "Large v3 (best)" }
      ] },
      { id: "language", portType: "text", label: "Language", required: !1, falParam: "language", fieldType: "text", default: "" },
      { id: "diarize", portType: "text", label: "Speaker Diarization", required: !1, falParam: "diarize", fieldType: "toggle", default: !0 }
    ]
  }
}, W = {
  "runpod-sdxl": {
    id: "runpod-sdxl",
    nodeType: "runpod-sdxl",
    name: "Stable Diffusion XL",
    category: "image",
    description: "SDXL text/image-to-image on RunPod",
    outputType: "image",
    provider: "runpod",
    runpodEndpointId: "2urujiktqqceer",
    responseMapping: { path: "output.image_url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "negative_prompt", portType: "text", label: "Negative Prompt", required: !1, falParam: "negative_prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "Image (img2img)", required: !1, falParam: "image_url", fieldType: "port" },
      { id: "width", portType: "number", label: "Width", required: !1, falParam: "width", fieldType: "select", default: "1024", options: [
        { value: "512", label: "512" },
        { value: "768", label: "768" },
        { value: "1024", label: "1024" },
        { value: "1280", label: "1280" }
      ] },
      { id: "height", portType: "number", label: "Height", required: !1, falParam: "height", fieldType: "select", default: "1024", options: [
        { value: "512", label: "512" },
        { value: "768", label: "768" },
        { value: "1024", label: "1024" },
        { value: "1280", label: "1280" }
      ] },
      { id: "scheduler", portType: "text", label: "Scheduler", required: !1, falParam: "scheduler", fieldType: "select", default: "DDIM", options: [
        { value: "DDIM", label: "DDIM" },
        { value: "K_EULER", label: "K Euler" },
        { value: "DPMSolverMultistep", label: "DPM Solver" },
        { value: "KLMS", label: "KLMS" },
        { value: "PNDM", label: "PNDM" }
      ] },
      { id: "num_inference_steps", portType: "number", label: "Steps", required: !1, falParam: "num_inference_steps", fieldType: "range", default: 25, min: 10, max: 100, step: 1 },
      { id: "guidance_scale", portType: "number", label: "Guidance", required: !1, falParam: "guidance_scale", fieldType: "range", default: 7.5, min: 1, max: 20, step: 0.5 },
      { id: "strength", portType: "number", label: "Strength (img2img)", required: !1, falParam: "strength", fieldType: "range", default: 0.3, min: 0, max: 1, step: 0.05 },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: -1 }
    ]
  },
  "runpod-ltx-video": {
    id: "runpod-ltx-video",
    nodeType: "runpod-ltx-video",
    name: "LTX Video",
    category: "video",
    description: "LTX-Video text/image-to-video on RunPod",
    outputType: "video",
    provider: "runpod",
    runpodEndpointId: "",
    responseMapping: { path: "output.video_url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "First Frame", required: !1, falParam: "image_url", fieldType: "port" },
      { id: "width", portType: "number", label: "Width", required: !1, falParam: "width", fieldType: "select", default: "768", options: [
        { value: "512", label: "512" },
        { value: "768", label: "768" },
        { value: "1024", label: "1024" }
      ] },
      { id: "height", portType: "number", label: "Height", required: !1, falParam: "height", fieldType: "select", default: "512", options: [
        { value: "512", label: "512" },
        { value: "768", label: "768" },
        { value: "1024", label: "1024" }
      ] },
      { id: "num_frames", portType: "number", label: "Frames", required: !1, falParam: "num_frames", fieldType: "select", default: "97", options: [
        { value: "25", label: "25f (~1s)" },
        { value: "49", label: "49f (~2s)" },
        { value: "97", label: "97f (~4s)" },
        { value: "129", label: "129f (~5s)" }
      ] },
      { id: "num_inference_steps", portType: "number", label: "Steps", required: !1, falParam: "num_inference_steps", fieldType: "range", default: 30, min: 10, max: 50, step: 1 },
      { id: "guidance_scale", portType: "number", label: "Guidance", required: !1, falParam: "guidance_scale", fieldType: "range", default: 3.5, min: 1, max: 10, step: 0.5 },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: -1 }
    ]
  },
  "runpod-wan-t2v": {
    id: "runpod-wan-t2v",
    nodeType: "runpod-wan-t2v",
    name: "Wan 2.1 T2V",
    category: "video",
    description: "Wan 2.1 text-to-video on RunPod",
    outputType: "video",
    provider: "runpod",
    runpodEndpointId: "",
    responseMapping: { path: "output.video_url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "negative_prompt", portType: "text", label: "Negative Prompt", required: !1, falParam: "negative_prompt", fieldType: "port" },
      { id: "resolution", portType: "text", label: "Resolution", required: !1, falParam: "resolution", fieldType: "select", default: "480p", options: [
        { value: "480p", label: "480p" },
        { value: "720p", label: "720p" }
      ] },
      { id: "num_frames", portType: "number", label: "Frames", required: !1, falParam: "num_frames", fieldType: "select", default: "81", options: [
        { value: "33", label: "33f (~2s)" },
        { value: "49", label: "49f (~3s)" },
        { value: "81", label: "81f (~5s)" }
      ] },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: -1 }
    ]
  },
  "runpod-wan-i2v": {
    id: "runpod-wan-i2v",
    nodeType: "runpod-wan-i2v",
    name: "Wan 2.1 I2V",
    category: "video",
    description: "Wan 2.1 image-to-video on RunPod",
    outputType: "video",
    provider: "runpod",
    runpodEndpointId: "",
    responseMapping: { path: "output.video_url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "Image", required: !0, falParam: "image_url", fieldType: "port" },
      { id: "negative_prompt", portType: "text", label: "Negative Prompt", required: !1, falParam: "negative_prompt", fieldType: "port" },
      { id: "resolution", portType: "text", label: "Resolution", required: !1, falParam: "resolution", fieldType: "select", default: "480p", options: [
        { value: "480p", label: "480p" },
        { value: "720p", label: "720p" }
      ] },
      { id: "num_frames", portType: "number", label: "Frames", required: !1, falParam: "num_frames", fieldType: "select", default: "81", options: [
        { value: "33", label: "33f (~2s)" },
        { value: "49", label: "49f (~3s)" },
        { value: "81", label: "81f (~5s)" }
      ] },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: -1 }
    ]
  },
  "runpod-qwen-image-edit": {
    id: "runpod-qwen-image-edit",
    nodeType: "runpod-qwen-image-edit",
    name: "Qwen Image Edit",
    category: "image-edit",
    description: "Qwen2.5-VL instruction-based image editing on RunPod",
    outputType: "image",
    provider: "runpod",
    runpodEndpointId: "qwen_image_edit_2511_v1.1",
    responseMapping: { path: "output.image_url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Edit Instruction", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "Image", required: !0, falParam: "image_url", fieldType: "port" }
    ]
  },
  "runpod-flux-dev": {
    id: "runpod-flux-dev",
    nodeType: "runpod-flux-dev",
    name: "FLUX Dev",
    category: "image",
    description: "FLUX.1 Dev image generation on RunPod",
    outputType: "image",
    provider: "runpod",
    runpodEndpointId: "",
    responseMapping: { path: "output.images[0].url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "width", portType: "number", label: "Width", required: !1, falParam: "width", fieldType: "select", default: "1024", options: [
        { value: "512", label: "512" },
        { value: "768", label: "768" },
        { value: "1024", label: "1024" },
        { value: "1280", label: "1280" }
      ] },
      { id: "height", portType: "number", label: "Height", required: !1, falParam: "height", fieldType: "select", default: "1024", options: [
        { value: "512", label: "512" },
        { value: "768", label: "768" },
        { value: "1024", label: "1024" },
        { value: "1280", label: "1280" }
      ] },
      { id: "num_inference_steps", portType: "number", label: "Steps", required: !1, falParam: "num_inference_steps", fieldType: "range", default: 28, min: 1, max: 50, step: 1 },
      { id: "guidance_scale", portType: "number", label: "Guidance", required: !1, falParam: "guidance_scale", fieldType: "range", default: 3.5, min: 1, max: 20, step: 0.5 },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: -1 }
    ]
  },
  "runpod-qwen-image": {
    id: "runpod-qwen-image",
    nodeType: "runpod-qwen-image",
    name: "Qwen Image",
    category: "image",
    description: "Qwen-Image text-to-image generation on RunPod",
    outputType: "image",
    provider: "runpod",
    runpodEndpointId: "",
    responseMapping: { path: "output.image_url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "width", portType: "number", label: "Width", required: !1, falParam: "width", fieldType: "select", default: "1024", options: [
        { value: "512", label: "512" },
        { value: "768", label: "768" },
        { value: "1024", label: "1024" },
        { value: "1280", label: "1280" }
      ] },
      { id: "height", portType: "number", label: "Height", required: !1, falParam: "height", fieldType: "select", default: "1024", options: [
        { value: "512", label: "512" },
        { value: "768", label: "768" },
        { value: "1024", label: "1024" },
        { value: "1280", label: "1280" }
      ] },
      { id: "num_inference_steps", portType: "number", label: "Steps", required: !1, falParam: "num_inference_steps", fieldType: "range", default: 50, min: 10, max: 100, step: 1 },
      { id: "guidance_scale", portType: "number", label: "Guidance", required: !1, falParam: "guidance_scale", fieldType: "range", default: 1, min: 0.5, max: 5, step: 0.5 },
      { id: "true_cfg_scale", portType: "number", label: "True CFG", required: !1, falParam: "true_cfg_scale", fieldType: "range", default: 4, min: 1, max: 10, step: 0.5 },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: -1 }
    ]
  }
}, Q = {
  "pod-sdxl": {
    id: "pod-sdxl",
    nodeType: "pod-sdxl",
    name: "SDXL (Pod)",
    category: "image",
    description: "Stable Diffusion XL on your CineGen pod",
    outputType: "image",
    provider: "pod",
    podRoute: "sdxl",
    responseMapping: { path: "output.image_url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "negative_prompt", portType: "text", label: "Negative Prompt", required: !1, falParam: "negative_prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "Image (img2img)", required: !1, falParam: "image_url", fieldType: "port" },
      { id: "width", portType: "number", label: "Width", required: !1, falParam: "width", fieldType: "select", default: "1024", options: [
        { value: "512", label: "512" },
        { value: "768", label: "768" },
        { value: "1024", label: "1024" },
        { value: "1280", label: "1280" }
      ] },
      { id: "height", portType: "number", label: "Height", required: !1, falParam: "height", fieldType: "select", default: "1024", options: [
        { value: "512", label: "512" },
        { value: "768", label: "768" },
        { value: "1024", label: "1024" },
        { value: "1280", label: "1280" }
      ] },
      { id: "scheduler", portType: "text", label: "Scheduler", required: !1, falParam: "scheduler", fieldType: "select", default: "DDIM", options: [
        { value: "DDIM", label: "DDIM" },
        { value: "K_EULER", label: "K Euler" },
        { value: "DPMSolverMultistep", label: "DPM Solver" },
        { value: "KLMS", label: "KLMS" },
        { value: "PNDM", label: "PNDM" }
      ] },
      { id: "num_inference_steps", portType: "number", label: "Steps", required: !1, falParam: "num_inference_steps", fieldType: "range", default: 25, min: 10, max: 100, step: 1 },
      { id: "guidance_scale", portType: "number", label: "Guidance", required: !1, falParam: "guidance_scale", fieldType: "range", default: 7.5, min: 1, max: 20, step: 0.5 },
      { id: "strength", portType: "number", label: "Strength (img2img)", required: !1, falParam: "strength", fieldType: "range", default: 0.3, min: 0, max: 1, step: 0.05 },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: -1 }
    ]
  },
  "pod-flux": {
    id: "pod-flux",
    nodeType: "pod-flux",
    name: "FLUX Dev (Pod)",
    category: "image",
    description: "FLUX.1 Dev on your CineGen pod",
    outputType: "image",
    provider: "pod",
    podRoute: "flux",
    responseMapping: { path: "output.image_url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "width", portType: "number", label: "Width", required: !1, falParam: "width", fieldType: "select", default: "1024", options: [
        { value: "512", label: "512" },
        { value: "768", label: "768" },
        { value: "1024", label: "1024" },
        { value: "1280", label: "1280" }
      ] },
      { id: "height", portType: "number", label: "Height", required: !1, falParam: "height", fieldType: "select", default: "1024", options: [
        { value: "512", label: "512" },
        { value: "768", label: "768" },
        { value: "1024", label: "1024" },
        { value: "1280", label: "1280" }
      ] },
      { id: "num_inference_steps", portType: "number", label: "Steps", required: !1, falParam: "num_inference_steps", fieldType: "range", default: 28, min: 1, max: 50, step: 1 },
      { id: "guidance_scale", portType: "number", label: "Guidance", required: !1, falParam: "guidance_scale", fieldType: "range", default: 3.5, min: 1, max: 20, step: 0.5 },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: -1 }
    ]
  },
  "pod-qwen-edit": {
    id: "pod-qwen-edit",
    nodeType: "pod-qwen-edit",
    name: "Qwen Image Edit (Pod)",
    category: "image-edit",
    description: "Qwen2.5-VL instruction image editing on your pod",
    outputType: "image",
    provider: "pod",
    podRoute: "qwen-edit",
    responseMapping: { path: "output.image_url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Edit Instruction", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "Image", required: !0, falParam: "image_url", fieldType: "port" }
    ]
  },
  "pod-ltx": {
    id: "pod-ltx",
    nodeType: "pod-ltx",
    name: "LTX Video 2.3 (Pod)",
    category: "video",
    description: "LTX Video 2.3 on your CineGen pod",
    outputType: "video",
    provider: "pod",
    podRoute: "ltx",
    responseMapping: { path: "output.video_url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "First Frame", required: !1, falParam: "image_url", fieldType: "port" },
      { id: "width", portType: "number", label: "Width", required: !1, falParam: "width", fieldType: "select", default: "768", options: [
        { value: "512", label: "512" },
        { value: "768", label: "768" },
        { value: "1024", label: "1024" }
      ] },
      { id: "height", portType: "number", label: "Height", required: !1, falParam: "height", fieldType: "select", default: "512", options: [
        { value: "512", label: "512" },
        { value: "768", label: "768" },
        { value: "1024", label: "1024" }
      ] },
      { id: "num_frames", portType: "number", label: "Frames", required: !1, falParam: "num_frames", fieldType: "select", default: "97", options: [
        { value: "25", label: "25f (~1s)" },
        { value: "49", label: "49f (~2s)" },
        { value: "97", label: "97f (~4s)" },
        { value: "129", label: "129f (~5s)" }
      ] },
      { id: "num_inference_steps", portType: "number", label: "Steps", required: !1, falParam: "num_inference_steps", fieldType: "range", default: 30, min: 10, max: 50, step: 1 },
      { id: "guidance_scale", portType: "number", label: "Guidance", required: !1, falParam: "guidance_scale", fieldType: "range", default: 3.5, min: 1, max: 10, step: 0.5 },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: -1 }
    ]
  },
  "pod-wan-t2v": {
    id: "pod-wan-t2v",
    nodeType: "pod-wan-t2v",
    name: "Wan 2.1 T2V (Pod)",
    category: "video",
    description: "Wan 2.1 text-to-video on your CineGen pod",
    outputType: "video",
    provider: "pod",
    podRoute: "wan-t2v",
    responseMapping: { path: "output.video_url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "negative_prompt", portType: "text", label: "Negative Prompt", required: !1, falParam: "negative_prompt", fieldType: "port" },
      { id: "resolution", portType: "text", label: "Resolution", required: !1, falParam: "resolution", fieldType: "select", default: "480p", options: [
        { value: "480p", label: "480p" },
        { value: "720p", label: "720p" }
      ] },
      { id: "num_frames", portType: "number", label: "Frames", required: !1, falParam: "num_frames", fieldType: "select", default: "81", options: [
        { value: "33", label: "33f (~2s)" },
        { value: "49", label: "49f (~3s)" },
        { value: "81", label: "81f (~5s)" }
      ] },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: -1 }
    ]
  },
  "pod-wan-i2v": {
    id: "pod-wan-i2v",
    nodeType: "pod-wan-i2v",
    name: "Wan 2.1 I2V (Pod)",
    category: "video",
    description: "Wan 2.1 image-to-video on your CineGen pod",
    outputType: "video",
    provider: "pod",
    podRoute: "wan-i2v",
    responseMapping: { path: "output.video_url" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "image_url", portType: "image", label: "Image", required: !0, falParam: "image_url", fieldType: "port" },
      { id: "negative_prompt", portType: "text", label: "Negative Prompt", required: !1, falParam: "negative_prompt", fieldType: "port" },
      { id: "resolution", portType: "text", label: "Resolution", required: !1, falParam: "resolution", fieldType: "select", default: "480p", options: [
        { value: "480p", label: "480p" },
        { value: "720p", label: "720p" }
      ] },
      { id: "num_frames", portType: "number", label: "Frames", required: !1, falParam: "num_frames", fieldType: "select", default: "81", options: [
        { value: "33", label: "33f (~2s)" },
        { value: "49", label: "49f (~3s)" },
        { value: "81", label: "81f (~5s)" }
      ] },
      { id: "seed", portType: "number", label: "Seed", required: !1, falParam: "seed", fieldType: "number", default: -1 }
    ]
  },
  "openrouter-llm": {
    id: "openrouter/router",
    nodeType: "openrouter-llm",
    name: "LLM (OpenRouter)",
    category: "text",
    description: "Run any LLM via OpenRouter",
    outputType: "text",
    provider: "fal",
    responseMapping: { path: "output" },
    inputs: [
      { id: "prompt", portType: "text", label: "Prompt", required: !0, falParam: "prompt", fieldType: "port" },
      { id: "system_prompt", portType: "text", label: "System Prompt", required: !1, falParam: "system_prompt", fieldType: "textarea", default: "" },
      { id: "model", portType: "text", label: "Model", required: !0, falParam: "model", fieldType: "select", default: "google/gemini-2.5-flash", options: [
        { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
        { value: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
        { value: "anthropic/claude-opus-4.6", label: "Claude Opus 4.6" },
        { value: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
        { value: "openai/gpt-4.1", label: "GPT-4.1" },
        { value: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
        { value: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick" }
      ] },
      { id: "temperature", portType: "number", label: "Temperature", required: !1, falParam: "temperature", fieldType: "range", default: 1, min: 0, max: 2, step: 0.1 },
      { id: "max_tokens", portType: "number", label: "Max Tokens", required: !1, falParam: "max_tokens", fieldType: "number", default: 1024, min: 1, max: 128e3, step: 1 },
      { id: "reasoning", portType: "number", label: "Reasoning", required: !1, falParam: "reasoning", fieldType: "toggle", default: !1 }
    ]
  }
}, $ = { ...B, ...x, ...H, ...W, ...Q, ...V };
export {
  $ as ALL_MODELS,
  m as KLING_V3_QUALITY_OPTS,
  H as LOCAL_MODEL_REGISTRY,
  f as LTX23_QUALITY_OPTS,
  B as MODEL_REGISTRY,
  Q as POD_MODEL_REGISTRY,
  W as RUNPOD_MODEL_REGISTRY,
  C as SORA2_QUALITY_OPTS,
  q as isKlingV3NodeType,
  K as resolveKlingV3ModelId,
  J as resolveVideoModelEndpoint,
  Y as sanitizeVideoInputsForEndpoint,
  N as usesEndpointQualityRouting
};
