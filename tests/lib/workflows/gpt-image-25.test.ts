import { describe, it, expect, vi } from 'vitest';
import { executeFromNode } from '@/lib/workflows/execute';
import { ALL_MODELS } from '@/lib/fal/models';
import { buildTopviewImageRequest } from '../../../electron/ipc/topview';
import { buildCreateArgs } from '../../../electron/ipc/higgsfield';
import topview from '@/lib/topview/gpt-image-25.generated.json';
import type { WorkflowNodeData } from '@/types/workflow';
import type { Node } from '@xyflow/react';

describe('GPT Image 2.5 across Canvas and Studio', () => {
  it.each(['flare', 'sunburst'])('preserves Topview %s, quality, resolution and reference edits', async (variant) => {
    const model = `topview-image-gpt-image-2-5-${variant}`;
    expect(ALL_MODELS[model].inputs.find(f => f.id === 'quality')?.options?.map(o => o.value)).toEqual(['low','medium','high','xhigh','max']);
    const generateImage = vi.fn().mockResolvedValue({url:'https://media.example/result.png'});
    Object.defineProperty(window, 'electronAPI', {configurable:true, value:{topview:{generateImage}}});
    const node:Node<WorkflowNodeData> = {id:'image',type:model,position:{x:0,y:0},data:{type:model,label:'Image',config:{prompt:'Ceramic cup',resolution:'4K',quality:'max',image_url:'https://media.example/ref.png'}}};
    const dispatch={setNodeRunning:vi.fn(),setNodeResult:vi.fn(),addGeneration:vi.fn(),addAsset:vi.fn(),getElements:()=>[]};
    await executeFromNode('image',[node],[],dispatch);
    expect(generateImage).toHaveBeenCalledWith(expect.objectContaining({model:ALL_MODELS[model].name,quality:'max',resolution:'4K',medias:[{value:'https://media.example/ref.png',role:'image'}]}));
    const built=buildTopviewImageRequest({config:{models:topview.models.filter(m=>m.taskType==='image_edit')},params:generateImage.mock.calls[0][0],references:[{value:'https://media.example/ref.png',role:'image',fileId:'ref-id'}],boardId:'board'});
    expect(built.req).toMatchObject({taskType:'image_edit',model:ALL_MODELS[model].name,quality:'max',resolution:'4K',inputImageFileIds:['ref-id']});
    expect(()=>buildTopviewImageRequest({config:{models:topview.models},params:{...generateImage.mock.calls[0][0],quality:'invented'},references:[],boardId:'board'})).toThrow();
  });
  it.each(['flare', 'sunburst'])('preserves Higgsfield %s controls and image references through execution and CLI', async variant=>{
    const model='hf-gpt-image-2-5';
    const field=ALL_MODELS[model].inputs.find(f=>f.id==='image_references');
    expect(field).toMatchObject({portType:'image',fieldType:'port',multiple:true,mediaRole:'image'});
    const generate=vi.fn().mockResolvedValue({url:'https://media.example/result.png'});
    Object.defineProperty(window,'electronAPI',{configurable:true,value:{higgsfield:{generate}}});
    const node:Node<WorkflowNodeData>={id:'image',type:model,position:{x:0,y:0},data:{type:model,label:'Image',config:{prompt:'Ceramic cup',variant,resolution:'4k',quality:'xhigh',background:'transparent',image_references:['https://media.example/ref.png']}}};
    await executeFromNode('image',[node],[],{setNodeRunning:vi.fn(),setNodeResult:vi.fn(),addGeneration:vi.fn(),addAsset:vi.fn(),getElements:()=>[]});
    const sent=generate.mock.calls[0][0];
    expect(sent).toMatchObject({model:'gpt_image_2_5',medias:[{value:'https://media.example/ref.png',role:'image'}],params:{variant,resolution:'4k',quality:'xhigh',background:'transparent'}});
    const cli=buildCreateArgs({...sent,mediaType:'image'});
    for(const [key,value] of [['variant',variant],['resolution','4k'],['quality','xhigh'],['background','transparent'],['image','https://media.example/ref.png']]) expect(cli[cli.indexOf(`--${key}`)+1]).toBe(value);
  });
});
