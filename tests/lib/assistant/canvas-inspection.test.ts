import { describe, expect, it, vi } from 'vitest';
import { answerWithCanvasVision } from '@/lib/assistant/canvas-inspection';
import { canvasSheetGroups, packCanvasImages } from '@/lib/assistant/canvas-contact-sheets';
import type { CanvasVisualContext } from '@/lib/assistant/canvas-visual-context';

const frame = (label: string) => ({ label, dataUrl: 'data:image/jpeg;base64,ok' });
const overview = [frame('overview with all canvas images')];
const visual: CanvasVisualContext = {
  images: overview, overview, context: 'Full canvas', total: 40, readable: 40, packed: true,
  details: new Map([['unselected-photo', [frame('The room [node unselected-photo]')]]]),
};

describe('Automatic canvas inspection', () => {
  it('retrieves an unselected photo internally, retaining the complete overview', async () => {
    const invoke = vi.fn().mockResolvedValueOnce('```cinegen-canvas-inspect\n{"nodeIds":["unselected-photo"]}\n```').mockResolvedValueOnce('The banner in the room should drape lower.');
    expect(await answerWithCanvasVision(visual, invoke)).toBe('The banner in the room should drape lower.');
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1][1]).toEqual([...overview, ...visual.details.get('unselected-photo')!]);
    expect(invoke.mock.calls[1][0]).toContain('Attached image 2: The room [node unselected-photo]');
  });

  it('never resolves arbitrary paths or node IDs from an inspection request', async () => {
    const invoke = vi.fn().mockResolvedValueOnce('```cinegen-canvas-inspect\n{"nodeIds":["/private/file","unknown"]}\n```').mockResolvedValueOnce('I can describe the available overview.');
    await answerWithCanvasVision(visual, invoke);
    expect(invoke.mock.calls[1][1]).toEqual(overview);
    expect(invoke.mock.calls[1][0]).toContain('No readable images matched');
  });

  it('bounds internal requests and stops when the project or thread changes', async () => {
    const invoke = vi.fn().mockResolvedValue('```cinegen-canvas-inspect\n{"nodeIds":["unselected-photo"]}\n```');
    await expect(answerWithCanvasVision(visual, invoke)).rejects.toThrow('could not finish');
    expect(invoke).toHaveBeenCalledTimes(3);
    invoke.mockClear();
    const current = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    await expect(answerWithCanvasVision(visual, invoke, current)).resolves.toBe('');
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe('Canvas overview coverage', () => {
  it.each([19, 40, 120, 400])('covers all %i frames without exceeding transport slots', async count => {
    const frames = Array.from({ length: count }, (_, i) => frame(`image-${i}`));
    const groups = canvasSheetGroups(frames);
    expect(groups.flat()).toEqual(frames);
    expect(groups.length).toBeLessThanOrEqual(12);
    const render = vi.fn(async (group) => frame(group.map((f: { label: string }) => f.label).join(',')));
    const result = await packCanvasImages(frames, render);
    expect(result.packed).toBe(true);
    expect(result.images).toHaveLength(groups.length);
    expect(render.mock.calls.flatMap(call => call[0])).toEqual(frames);
  });

  it('sends smaller canvases as individual images for full detail', async () => {
    const frames = Array.from({ length: 14 }, (_, i) => frame(`image-${i}`));
    const render = vi.fn();
    expect(await packCanvasImages(frames, render)).toEqual({ images: frames, packed: false });
    expect(render).not.toHaveBeenCalled();
  });
});
