import { describe, expect, it, vi } from 'vitest';
import { captureSetView, captureShapeShot, passesWithinBudget, referencePrompt, shapeShotSize } from '@/lib/sets/shape-shot';
import { buildCameraPrompt } from '@/lib/sets/camera-prompt';
import { FULL_FRAME } from '@/lib/sets/optics';

describe('Set shot handoff', () => {
  it('renumbers every tag and mannequin exclusion when passes are omitted', () => {
    const block = buildCameraPrompt({ focalMm: 50, cameraHeightM: 1.6, subjectDistanceM: 4.2 }).block;
    for (const budget of [2, 3, 4]) {
      const result = referencePrompt(passesWithinBudget(budget), block);
      const slots = [...result.matchAll(/@image(\d+)/g)].map(match => Number(match[1]));
      expect(Math.max(...slots)).toBe(budget);
      expect(result).toContain('about 4.2 metres');
      expect(result).not.toMatch(/\bmm\b|\bISO\b|\bf\/\d/);
      if (budget === 3) expect(result).toContain('@image3 shows character');
    }
  });
  it('matches landscape, portrait, square and explicit output dimensions', () => {
    expect(shapeShotSize('16:9', '1080p')).toEqual({ width: 1920, height: 1080 });
    expect(shapeShotSize('9:16', '720p')).toEqual({ width: 720, height: 1280 });
    expect(shapeShotSize('1:1', '2K')).toEqual({ width: 2048, height: 2048 });
    expect(shapeShotSize('3:2', '1536x1024')).toEqual({ width: 1536, height: 1024 });
  });
  it('captures the exact output size and returns ordered PNG references', async () => {
    const camera = { id: 'camera', name: 'angle', createdAt: '', position: [0,1.6,4], target: [0,1,0], focalMm:50, sensorWidthMm:36, sensorHeightMm:24, aspect:'9:16', fovDiagonal:47 } as const;
    const capture = vi.fn(async () => Object.fromEntries(['plate','composite','depth','standin'].map(kind => [kind, new Blob([kind], {type:'image/png'})])));
    const handle = { capture, readCamera: () => ({...camera, position:[...camera.position], target:[...camera.target]}) as any, cameraHeight:()=>1.6, subjectDistance:()=>4.2, subjectFrameX:()=>.5 };
    const result = await captureShapeShot(handle, {setId:'set',width:720,height:1280,maxReferences:4,focalMm:50,sensor:FULL_FRAME});
    expect(capture).toHaveBeenCalledWith(['plate','composite','depth','standin'],720,1280);
    expect(result.files.map(file=>file.name)).toEqual(['shape-shot-plate.png','shape-shot-composite.png','shape-shot-depth.png','shape-shot-standin.png']);
    expect(result.setId).toBe('set');
    expect(result.camera.id).toBe('camera');
    await expect(captureShapeShot(handle, {setId:'set',width:720,height:1280,maxReferences:1,focalMm:50,sensor:FULL_FRAME})).rejects.toThrow('two free reference slots');
  });
  it('sends a clean single view with one slot, optionally includes actors, and never references absent passes', async () => {
    const capture = vi.fn(async (kinds: string[]) => Object.fromEntries(kinds.map(kind => [kind, new Blob([kind])])));
    const handle = { capture, readCamera: () => ({ id: 'same-angle' }) } as any;
    const options = { setId: 'room', width: 1536, height: 1024, maxReferences: 1,
      mode: 'view' as const, includeStandIns: false, enhance: true, instructions: 'Keep the warm light.' };
    const result = await captureSetView(handle, options);
    expect(capture).toHaveBeenLastCalledWith(['plate'], 1536, 1024);
    expect(result.files.map(file => file.name)).toEqual(['set-view.png']);
    expect(result.promptBlock).toContain('Preserve its exact camera angle');
    expect(result.promptBlock).toContain('Keep the warm light.');
    expect(result.promptBlock).not.toMatch(/@image[2-9]|\bmm\b|\bISO\b|\bf\/\d/);
    expect(result.camera.id).toBe('same-angle');
    const composite = await captureSetView(handle, { ...options, includeStandIns: true, enhance: false });
    expect(capture).toHaveBeenLastCalledWith(['composite'], 1536, 1024);
    expect(composite.promptBlock).toBe('Keep the warm light.');
    expect(composite.mode).toBe('view');
    const plain = await captureSetView(handle, { ...options, enhance: false, instructions: '' });
    expect(plain.promptBlock).toBe('');
    expect(plain.files).toHaveLength(1);
    expect(composite.promptBlock).not.toContain('polished');
    await expect(captureSetView(handle, { ...options, maxReferences: 0 })).rejects.toThrow('free image reference slot');
    expect(capture).toHaveBeenCalledTimes(3);
  });

});
