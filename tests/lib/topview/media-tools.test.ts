import { describe, expect, it } from 'vitest';
import { buildTopviewMediaToolRequest, topviewMediaToolDefinitions } from '@/lib/topview/media-tools';
import { buildTopviewModelRegistry } from '@/lib/topview/model-catalog';
import { prepareProviderGeneration } from '../../../remote/src/providers';
import { normalizeTopviewVideoTask } from '@/lib/topview/video-task';
import { getModelDefinition } from '@/lib/fal/models';
import { buildCreateArgs } from '../../../electron/ipc/higgsfield';

const media = [{ value: 'https://example.com/face.png', role: 'image', fileId: 'photo' }, { value: 'https://example.com/speech.wav', role: 'audio', fileId: 'speech' }];
describe('explicit media tools', () => {
  it('adds separate options without changing the default generation model', () => {
    const entries = Object.values(buildTopviewModelRegistry());
    expect(entries[0].name).toBe('GPT Image 2');
    expect(entries.find(m => m.name === 'Seedance 2.5')?.inputs.some(f => /upscal|lip/i.test(f.id))).toBe(false);
    const models = topviewMediaToolDefinitions(['topview_avatar_video']);
    expect(models.find(m => m.name === 'Avatar 4')?.unavailableReason).toBeUndefined();
    expect(models.find(m => m.name === 'Video Upscale')?.unavailableReason).toContain('not exposed');
    expect(models.find(m => m.name === 'Video Lip Sync')?.unavailableReason).toContain('API-key');
  });
  it('uses uploaded dialogue with no invented prompt, off-peak delay, or saved avatar', () => {
    expect(buildTopviewMediaToolRequest('Avatar 4 Fast', '', media, 'board')).toEqual({ taskType: 'avatar_video', request: {
      mode: 'avatar4Fast', templateImageFileId: 'photo', scriptMode: 'audio', audioFileId: 'speech', offPeak: false, saveCustomAiAvatar: 'false', boardId: 'board',
    }});
    expect(() => buildTopviewMediaToolRequest('Avatar 4', '', media.slice(0,1))).toThrow(/one audio/);
    expect(() => buildTopviewMediaToolRequest('Avatar 4', 'x'.repeat(601), media)).toThrow(/600/);
    expect(buildTopviewMediaToolRequest('Video Lip Sync', '', [{...media[0], role:'video'}, media[1]]).request).toMatchObject({avatarSourceFrom:'0',audioSourceFrom:'0',modeType:'0'});
  });
  it('accepts promptless avatar jobs through MCP and persists their resume type', () => {
    const prepared = prepareProviderGeneration({provider:'topview',model:'topview-video-avatar-4',inputs:{image_url:[media[0].value],audio_references:[media[1].value]}});
    expect(prepared.params.model).toBe('Avatar 4');
    expect(prepared.params.prompt).toBe('');
    expect(prepared.params.medias.map((m:any)=>m.role)).toEqual(['image','audio']);
    expect(normalizeTopviewVideoTask({taskId:'original-paid-job',taskType:'avatar_video',model:'Avatar 4'})).toMatchObject({taskId:'original-paid-job',taskType:'avatar_video'});
    expect(() => prepareProviderGeneration({provider:'topview',model:'topview-video-video-upscale',inputs:{image_url:['https://example.com/source.mp4']}})).toThrow(/not exposed/);
  });
  it('passes Topaz sources exactly once, with explicit output size and no prompt requirement', () => {
    const model = getModelDefinition('hf-topaz-image')!;
    expect(model.inputs.find(f=>f.id==='image_references')).toMatchObject({portType:'image',multiple:true});
    const prepared = prepareProviderGeneration({provider:'higgsfield',model:model.nodeType,inputs:{image_references:['https://example.com/source.png'],output_width:2048,output_height:1024}});
    expect(prepared.params.prompt).toBeUndefined();
    const args = buildCreateArgs({model:'topaz_image',mediaType:'image',medias:[{value:'/tmp/source.png',role:'image'}],params:prepared.config});
    expect(args.filter(x=>x==='/tmp/source.png')).toHaveLength(1);
    expect(args).not.toContain('--image_references');
    expect(args).not.toContain('--prompt');
    expect(() => prepareProviderGeneration({provider:'higgsfield',model:model.nodeType,inputs:{image_references:['https://example.com/source.png'],output_width:0,output_height:1024}})).toThrow();
  });
});
