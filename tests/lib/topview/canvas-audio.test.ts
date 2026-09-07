import { afterEach, describe, expect, it, vi } from 'vitest';
import { canvasAudioParameters, hasTopviewCanvasAudioTools, queryTopviewCanvasAudio, readTopviewCanvasTask, submitTopviewCanvasAudio } from '../../../src/lib/topview/canvas-audio';
import { topviewVideoSubmitRoute } from '../../../src/lib/topview/reference-capabilities';
import { canvasCapability, canvasFixture, canvasToolNames } from '../../fixtures/topview-canvas.mjs';

const references = [{ value: 'https://cinegen.test/hero.png', role: 'image' }, { value: 'https://cinegen.test/motion.mp4', role: 'video' }, { value: 'https://cinegen.test/beat.mp3', role: 'audio' }];
const request = { taskType: 'omni_reference', model: 'Seedance 2.5', prompt: 'Move in time with the music.', resolution: 1080, duration: 12, aspectRatio: '16:9', sound: false, inputAudios: [{}] };
afterEach(() => vi.unstubAllGlobals());

describe('Topview Canvas audio route', () => {
  it('uses the same MCP connection only when the complete Canvas toolchain exists', () => {
    expect(hasTopviewCanvasAudioTools(canvasToolNames)).toBe(true);
    expect(hasTopviewCanvasAudioTools(canvasToolNames.filter(name => name !== 'download_topview_canvas_nodes'))).toBe(false);
    expect(topviewVideoSubmitRoute({}, request, false, true)).toBe('canvas-mcp');
    expect(topviewVideoSubmitRoute({}, { ...request, inputAudios: [] }, false, true)).toBe('mcp');
    expect(() => topviewVideoSubmitRoute({}, { ...request, model: 'Unrelated model' }, false, true)).toThrow();
    expect(topviewVideoSubmitRoute({ properties: { req: { properties: { inputAudios: {} } } } }, request, false, true)).toBe('mcp');
  });

  it('retains all three reference types and resumes the original video through its authorized download', async () => {
    const fixture = canvasFixture();
    const uploads: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => { uploads.push(init); return new Response(null, { status: 200 }); }));
    const submitted = await submitTopviewCanvasAudio({ call: fixture.call, request, references,
      load: async ref => ({ bytes: new Uint8Array([1, 2, 3]), format: ref.value.split('.').at(-1)! }) });
    expect(uploads).toHaveLength(3);
    expect(uploads[0]).toMatchObject({ method: 'PUT', headers: { 'x-fixture': 'required' }, redirect: 'manual' });
    const paid = fixture.calls.filter(call => call.name === 'submit_topview_canvas_generation_task');
    expect(paid).toHaveLength(1);
    expect(paid[0].args).toMatchObject({ capabilityVersion: 'sha256:fixture-v1', model: 'seedance-2.5', taskType: 'video_edit', prompt: request.prompt,
      parameters: { duration: 12, resolution: 1080, nativeAudio: false, aspectRatio: '16:9', omniReferenceTaskType: 'auto' },
      inputs: references.map((ref, index) => ({ role: `reference_${ref.role}`, source: { kind: 'canvas_node', nodeId: `node_reference_${index + 1}` } })) });
    expect(fixture.calls.filter(call => call.name === 'create_topview_canvas_media_node').map(call => call.args.url)).toEqual(['refs/reference-1.png', 'refs/reference-2.mp4', 'refs/reference-3.mp3']);
    expect(readTopviewCanvasTask(submitted.taskId)).toEqual({ canvasId: 'canvas_fixture', nodeId: 'node_output', taskId: 'provider_task' });
    expect(await queryTopviewCanvasAudio(fixture.call, submitted.taskId)).toMatchObject({ status: 'running' });
    fixture.complete();
    expect(await queryTopviewCanvasAudio(fixture.call, submitted.taskId)).toMatchObject({ status: 'success', videoUrl: 'https://download.topview.ai/output.mp4?signature=fixture' });
    expect(fixture.calls.filter(call => call.name === 'submit_topview_canvas_generation_task')).toHaveLength(1);
  });

  it('rejects unsupported combinations and settings before upload or paid submission', async () => {
    for (const [refs, req, message] of [
      [references.slice(2), request, /at least one image or video/],
      [[references[0], references[1], references[1], references[2]], request, /allows 0–1 video/],
      [references, { ...request, resolution: 2160 }, /resolution=2160/],
    ] as const) {
      const fixture = canvasFixture(); const load = vi.fn();
      await expect(submitTopviewCanvasAudio({ call: fixture.call, request: req, references: [...refs], load })).rejects.toThrow(message);
      expect(load).not.toHaveBeenCalled();
      expect(fixture.calls.some(call => /upload|submit/.test(call.name))).toBe(false);
    }
    expect(() => canvasAudioParameters(canvasCapability, { ...request, generatingCount: 2 }, references)).toThrow(/one output/);
  });

  it('does not submit after a failed reference upload or retry an ambiguous paid call', async () => {
    const load = async () => ({ bytes: new Uint8Array([1]), format: 'mp3' });
    const fixture = canvasFixture();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 403 })));
    await expect(submitTopviewCanvasAudio({ call: fixture.call, request, references, load })).rejects.toThrow(/HTTP 403/);
    expect(fixture.calls.some(call => call.name === 'submit_topview_canvas_generation_task')).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
    let submits = 0;
    const call = async (name: string, args: Record<string, unknown>) => {
      if (name === 'submit_topview_canvas_generation_task') { submits++; throw new Error('Network interrupted'); }
      return fixture.call(name, args);
    };
    await expect(submitTopviewCanvasAudio({ call, request, references, load })).rejects.toThrow('Network interrupted');
    expect(submits).toBe(1);
  });

  it('rejects corrupted receipts and surfaces structured provider errors', async () => {
    expect(readTopviewCanvasTask('ordinary-task')).toBeUndefined();
    expect(() => readTopviewCanvasTask('cinegen-canvas:invalid')).toThrow(/invalid/);
    await expect(submitTopviewCanvasAudio({ call: async () => ({ isError: true, structuredContent: { message: 'Reconnect Topview.' } }), request, references, load: vi.fn() })).rejects.toThrow('Reconnect Topview.');
  });
});
