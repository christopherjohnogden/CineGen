import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const persist = vi.hoisted(() => vi.fn());
vi.mock('@/lib/cloud/elements', () => ({ prepareElementReferences: persist }));
vi.mock('@/components/elements/element-generate', () => ({ ElementGenerate: () => null }));
vi.mock('@/components/elements/element-image-upload', () => ({ ElementImageUpload: () => null }));
vi.mock('@/components/elements/element-description-assistant', () => ({ ElementDescriptionAssistant: () => null }));
import { ElementModal } from '@/components/elements/element-modal';
const element = { id:'mug',name:'Mug',type:'prop' as const,description:'Ceramic',images:[{id:'ref',url:'https://provider/image',source:'generated' as const,createdAt:''}],createdAt:'',updatedAt:'' };
afterEach(cleanup);
describe('Element modal approval storage', () => {
  it('uses the shared ingest function before saving approved views', async () => {
    const save=vi.fn();
    persist.mockImplementation(async draft=>({...draft,images:[{...draft.images[0],url:'https://project/image'}]}));
    render(<ElementModal element={element} projectId="project" onSave={save} onClose={()=>{}} />);
    fireEvent.click(screen.getByText('Approve element'));
    fireEvent.click(screen.getByRole('button',{name:'Save element'}));
    await waitFor(()=>expect(save).toHaveBeenCalled());
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({id:'mug'}),'project');
    expect(save.mock.calls[0][0].images[0].url).toBe('https://project/image');
  });
  it('keeps the modal open and reports storage failure instead of approving a temporary URL', async () => {
    const save=vi.fn();persist.mockRejectedValue(new Error('Storage unavailable'));
    render(<ElementModal element={element} projectId="project" onSave={save} onClose={()=>{}} />);
    fireEvent.click(screen.getByText('Approve element'));fireEvent.click(screen.getByRole('button',{name:'Save element'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable');expect(save).not.toHaveBeenCalled();
  });
});
