import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertClipEditVideo, clipVideoFrameSize, isTopviewClipEdit, topviewClipEditRequest } from '@/lib/topview/clip-edit';
import { topviewVideoSubmitRoute } from '@/lib/topview/reference-capabilities';
import { queryTopviewCanvasAudio, submitTopviewCanvasAudio } from '@/lib/topview/canvas-audio';
import { buildTopviewModelRegistry } from '@/lib/topview/model-catalog';
import { canvasFixture, clipVideoFixture } from '../../fixtures/topview-canvas.mjs';

const references = [{ value: 'https://media.example/clip.mp4', role: 'video' }, { value: 'https://media.example/character.png', role: 'image' }, { value: 'https://media.example/voice.wav', role: 'audio' }];
const params = { model: 'Seedance 2.5', videoMode: 'edit', prompt: 'Replace the player with the character.', resolution: '1080p', durationSec: 5, aspectRatio: '9:16', generateAudio: true };
afterEach(() => vi.unstubAllGlobals());

describe('explicit Topview Clip Edit', () => {
  it('selects the verified Canvas route without audio, independently of legacy/API capabilities', () => {
    const request = topviewClipEditRequest(params, references.slice(0, 1));
    expect(request).toMatchObject({ omniReferenceTaskType: 'edit', duration: -1, aspectRatio: 'adaptive', resolution: 1080 });
    expect(topviewVideoSubmitRoute({}, request, true, true)).toBe('canvas-mcp');
    expect(() => topviewVideoSubmitRoute({}, request, true, false)).toThrow(/Reconnect Topview/);
    expect(isTopviewClipEdit({ video_mode: 'auto' })).toBe(false);
    expect(isTopviewClipEdit({ params: { video_mode: 'edit' } })).toBe(true);
    expect(topviewVideoSubmitRoute({}, { taskType: 'omni_reference', inputVideos: [{}] }, false, true)).toBe('mcp');
  });
  it('rejects missing/multiple clips, frames, other models, and unsupported resolutions', () => {
    expect(() => topviewClipEditRequest(params, references.slice(1))).toThrow(/exactly one/);
    expect(() => topviewClipEditRequest(params, [references[0], references[0]])).toThrow(/exactly one/);
    expect(() => topviewClipEditRequest(params, [references[0], { ...references[1], role: 'start_image' }])).toThrow(/first or last frames/);
    expect(() => topviewClipEditRequest({ ...params, model: 'Seedance 2.0' }, references)).toThrow(/Seedance 2.5/);
    expect(() => topviewClipEditRequest({ ...params, resolution: '4k' }, references)).toThrow(/1080p/);
  });
  it('checks real track dimensions, including version 1 headers, and fails closed on malformed input', () => {
    for (const version of [0, 1]) expect(clipVideoFrameSize(clipVideoFixture(1280, 720, version))).toEqual({ width: 1280, height: 720 });
    expect(() => assertClipEditVideo(clipVideoFixture(640, 360))).toThrow(/407,696/);
    expect(() => assertClipEditVideo(clipVideoFixture())).not.toThrow();
    expect(() => assertClipEditVideo(new Uint8Array([1, 2]))).toThrow(/No generation/);
    const malformed = clipVideoFixture(); new DataView(malformed.buffer).setUint32(0, 0xffffffff);
    expect(clipVideoFrameSize(malformed)).toBeUndefined();
  });
  it('submits exactly one 1080p edit with all reference kinds and resumes the same output', async () => {
    const fixture = canvasFixture();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
    const request = topviewClipEditRequest(params, references);
    const result = await submitTopviewCanvasAudio({ call: fixture.call, request, references,
      load: async ref => ({ bytes: ref.role === 'video' ? clipVideoFixture() : new Uint8Array([1]), format: ref.value.split('.').at(-1)! }) });
    const paid = fixture.calls.filter(call => call.name === 'submit_topview_canvas_generation_task');
    expect(paid).toHaveLength(1);
    expect(paid[0].args).toMatchObject({ taskType: 'video_edit', model: 'seedance-2.5', prompt: params.prompt,
      parameters: { resolution: 1080, duration: -1, aspectRatio: 'adaptive', omniReferenceTaskType: 'edit', nativeAudio: true } });
    expect(paid[0].args.inputs.map((input: { role: string }) => input.role)).toEqual(['reference_video', 'reference_image', 'reference_audio']);
    expect(result.durationSec).toBeUndefined();
    fixture.complete(); expect(await queryTopviewCanvasAudio(fixture.call, result.taskId)).toMatchObject({ status: 'success' });
    expect(fixture.calls.filter(call => call.name === 'submit_topview_canvas_generation_task')).toHaveLength(1);
  });
  it('stops an undersized source before uploading or charging, even with 1080p output', async () => {
    const fixture = canvasFixture(); vi.stubGlobal('fetch', vi.fn());
    await expect(submitTopviewCanvasAudio({ call: fixture.call, request: topviewClipEditRequest(params, references), references,
      load: async () => ({ bytes: clipVideoFixture(640, 360), format: 'mp4' }) })).rejects.toThrow(/640×360/);
    expect(fetch).not.toHaveBeenCalled();
    expect(fixture.calls.some(call => call.name === 'submit_topview_canvas_generation_task')).toBe(false);
  });
  it('exposes an opt-in Canvas mode and a typed source-video port', () => {
    const model = buildTopviewModelRegistry()['topview-video-seedance-2-5'];
    expect(model.inputs.find(field => field.id === 'video_mode')).toMatchObject({ default: 'auto', options: expect.arrayContaining([{ value: 'auto', label: 'Generate' }, expect.objectContaining({ value: 'edit' })]) });
    expect(model.inputs.find(field => field.id === 'source_video')).toMatchObject({ portType: 'video', mediaRole: 'video', falParam: 'input_video' });
  });
});
