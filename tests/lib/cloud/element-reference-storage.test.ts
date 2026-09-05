import { describe, expect, it, vi, afterEach } from 'vitest';
const auth = vi.hoisted(() => vi.fn(async () => null));
vi.mock('@/lib/cloud/firebase', () => ({ waitForCloudAuth: auth, cloudDb: {} }));
vi.mock('@/lib/cloud/media', () => ({ prepareElementsLibraryForCloudMedia: vi.fn() }));
import { prepareElementReferences } from '@/lib/cloud/elements';
const image = { id:'image',url:'https://provider/short',source:'generated' as const,createdAt:'' };
const element = { id:'mug',name:'Mug',type:'prop' as const,description:'',images:[image],variations:[{id:'base',name:'Base',kind:'baseline' as const,description:'',images:[image],createdAt:'',updatedAt:''}],createdAt:'',updatedAt:'' };
afterEach(()=>{delete (window as unknown as {electronAPI?:unknown}).electronAPI;});
describe('durable Element storage',()=>{
  it('persists a local project copy and reuses it across baseline and flat projections',async()=>{
    const save=vi.fn(async()=>({path:'/project/media/reference.png',downloaded:true}));
    (window as unknown as {electronAPI:unknown}).electronAPI={media:{persistGeneratedAsset:save}};
    const result=await prepareElementReferences(element,'project');
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({projectId:'project',assetId:'mug-reference-image',assetType:'image',remoteUrl:'https://provider/short'});
    expect(result.images[0].url).toBe('local-media://file/project/media/reference.png');
    expect(result.variations![0].images[0].url).toBe(result.images[0].url);
    expect(element.images[0].url).toBe('https://provider/short');
  });
  it('does not hide ingest errors or return the temporary link as approved',async()=>{
    (window as unknown as {electronAPI:unknown}).electronAPI={media:{persistGeneratedAsset:async()=>({error:'Download failed'})}};
    await expect(prepareElementReferences(element,'project')).rejects.toThrow('Download failed');
  });
});
