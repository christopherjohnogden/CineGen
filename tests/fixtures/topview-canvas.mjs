// Read-only live Seedance 2.5 Canvas contract, checked 2026-09-07.
export const canvasCapability = {
  model: 'seedance-2.5', displayName: 'Seedance 2.5', mediaType: 'video', taskType: 'video_edit',
  defaults: { duration: 30, resolution: 720, nativeAudio: true, aspectRatio: 'adaptive', omniReferenceTaskType: 'auto' },
  inputs: [
    { role: 'reference_image', min: 0, max: 16, mediaKinds: ['image'] },
    { role: 'reference_video', min: 0, max: 1, mediaKinds: ['video'] },
    { role: 'reference_audio', min: 0, max: 16, mediaKinds: ['audio'] },
  ],
  constraints: [{ type: 'require_any_roles', roles: ['reference_image', 'reference_video'] }],
  requiredParameters: [],
  parametersSchema: { additionalProperties: false, properties: {
    duration: { type: 'number', enum: [-1, ...Array.from({ length: 27 }, (_, i) => i + 4)] },
    resolution: { type: 'number', enum: [480, 720, 1080] },
    aspectRatio: { type: 'string', enum: ['adaptive', '16:9', '9:16'] },
    nativeAudio: { type: 'boolean' }, omniReferenceTaskType: { type: 'string', enum: ['auto', 'edit', 'extend'] },
  } },
};

export const canvasToolNames = [
  'list_topview_canvases', 'create_topview_canvas', 'get_topview_canvas_state',
  'get_topview_canvas_generation_capabilities', 'prepare_topview_canvas_media_upload',
  'create_topview_canvas_media_node', 'submit_topview_canvas_generation_task',
  'refresh_topview_canvas_generation_task', 'download_topview_canvas_nodes',
];

export function canvasFixture() {
  const calls = [];
  let nodes = 0;
  let successful = false;
  return {
    calls,
    complete() { successful = true; },
    async call(name, args) {
      calls.push({ name, args });
      let result;
      switch (name) {
        case 'list_topview_canvases': result = { canvases: [{ name: 'CineGen references', canvasId: 'canvas_fixture' }] }; break;
        case 'get_topview_canvas_state': result = { nodes: [{ x: 0, y: 0, height: 400 }] }; break;
        case 'get_topview_canvas_generation_capabilities': result = { capabilityVersion: 'sha256:fixture-v1', capabilities: [canvasCapability] }; break;
        case 'prepare_topview_canvas_media_upload': result = { uploadUrl: 'https://upload.topview.ai/fixture', objectKey: `refs/${args.fileName}`, mimeType: args.fileName.endsWith('.mp3') ? 'audio/mpeg' : args.fileName.endsWith('.mp4') ? 'video/mp4' : 'image/png', requiredHeaders: { 'x-fixture': 'required' } }; break;
        case 'create_topview_canvas_media_node': result = { nodeId: `node_reference_${++nodes}`, consistencyStatus: 'projected' }; break;
        case 'submit_topview_canvas_generation_task': result = { nodeId: 'node_output', taskId: 'provider_task', status: 'running' }; break;
        case 'refresh_topview_canvas_generation_task': result = successful ? { status: 'success', mediaRef: { objectKey: 'private/output.mp4' } } : { status: 'running' }; break;
        case 'download_topview_canvas_nodes': result = { downloadArtifacts: [{ nodeId: 'node_output', url: 'https://download.topview.ai/output.mp4?signature=fixture' }] }; break;
        default: throw new Error(`Unexpected tool: ${name}`);
      }
      return { content: [{ type: 'text', text: 'Canvas operation completed.' }], structuredContent: result };
    },
  };
}
