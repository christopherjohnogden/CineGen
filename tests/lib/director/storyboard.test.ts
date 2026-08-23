import { describe, expect, it } from 'vitest';
import { createEmptyDirectorShow } from '@/lib/director/create-show';
import {
  storyboardPlan,
  storyboardGenerationErrorMessage,
  isRetryableStoryboardError,
  runStoryboardWithRetry,
  storyboardPromptWithReferences,
  storyboardReferences,
  storyboardReferenceUrls,
  storyboardResultUrl,
  upsertStoryboardFrame,
} from '@/lib/director/storyboard';
import type { DirectorClip, DirectorScene, DirectorShow } from '@/types/director';
import type { Element } from '@/types/elements';

const scenes: DirectorScene[] = [
  { id: 'scene-1', number: 1, label: 'INT. OFFICE - DAY', summary: '', elementIds: [], clipIds: ['clip-1'] },
  { id: 'scene-3', number: 3, label: 'EXT. FOREST - NIGHT', summary: '', elementIds: [], clipIds: ['clip-3'] },
];

function clip(id: string, sceneId: string, beatCount: number): DirectorClip {
  return {
    id,
    sceneId,
    title: id === 'clip-1' ? 'The office fractures' : 'Jordan finds the clearing',
    seconds: 20,
    subject: '@Jordan crosses the room.',
    location: 'A narrow office with a rain-streaked window.',
    blocking: '@Jordan stays camera-left of @Peter.',
    style: 'Muted amber practical light and restrained contrast.',
    constraints: '',
    elementTags: ['@Jordan', '@Office'],
    activeVariant: { kind: 'full' },
    bodyEdits: {},
    takes: [],
    beats: Array.from({ length: beatCount }, (_, index) => ({
      n: index + 1,
      from: `0:${String(index * 4).padStart(2, '0')}`,
      to: `0:${String((index + 1) * 4).padStart(2, '0')}`,
      dur: 4,
      text: index === 0 ? '@Jordan wheels toward the desk. Hard cut.' : `Action beat ${index + 1}. Hard cut.`,
      cam: index === 0 ? 'Low medium tracking shot on @Jordan' : `Camera setup ${index + 1}`,
    })),
  };
}

function show(): DirectorShow {
  return {
    ...createEmptyDirectorShow(),
    sourceText: 'INT. OFFICE - DAY',
    lookBible: {
      filmRefs: ['The Conversation'],
      moodBoards: [{ id: 'look-1', name: 'Amber office', url: 'https://cdn.test/look.jpg' }],
      notes: 'Patient locked-off frames with warm practical light.',
    },
    scenes,
    clips: [clip('clip-1', 'scene-1', 5), clip('clip-3', 'scene-3', 2)],
    breakdown: [
      { id: 'b1', kind: 'character', name: 'Jordan', tag: '@Jordan', description: '', elementId: 'jordan' },
      { id: 'b2', kind: 'location', name: 'Office', tag: '@Office', description: '', elementId: 'office' },
    ],
  };
}

describe('director storyboard plan', () => {
  it('creates exactly one frame per numbered multishot beat', () => {
    const frames = storyboardPlan(show());
    expect(frames).toHaveLength(7);
    expect(frames.filter((frame) => frame.clip.id === 'clip-1')).toHaveLength(5);
    expect(frames.filter((frame) => frame.clip.id === 'clip-3')).toHaveLength(2);
    expect(frames.map((frame) => frame.id)).toEqual([
      'clip-1::1', 'clip-1::2', 'clip-1::3', 'clip-1::4', 'clip-1::5',
      'clip-3::1', 'clip-3::2',
    ]);
  });

  it('preserves the shot action language while adapting it to one still frame', () => {
    const frame = storyboardPlan(show())[0];
    expect(frame.prompt).toContain('ACTION — @Jordan wheels toward the desk.');
    expect(frame.prompt).toContain('COMPOSITION —');
    expect(frame.prompt).toContain('Low medium tracking shot on @Jordan');
    expect(frame.prompt).toContain('photorealistic live-action motion-picture frame');
    expect(frame.prompt).toContain('No drawing, illustration, painting, anime');
    expect(frame.prompt).toContain('One image, one camera angle');
    expect(frame.prompt).not.toContain('Hard cut.');
  });

  it('marks a rendered frame outdated when its shot wording changes', () => {
    const initial = show();
    const frame = storyboardPlan(initial)[0];
    const rendered = upsertStoryboardFrame(initial, frame, {
      status: 'ready',
      imageUrl: 'https://cdn.test/board.jpg',
      generatedSourceHash: frame.sourceHash,
      generatedPrompt: frame.prompt,
    });
    expect(storyboardPlan(rendered)[0].stale).toBe(false);

    const changed = {
      ...rendered,
      clips: rendered.clips.map((entry) => entry.id === 'clip-1'
        ? { ...entry, beats: entry.beats.map((beat) => beat.n === 1 ? { ...beat, cam: 'High overhead wide' } : beat) }
        : entry),
    };
    expect(storyboardPlan(changed)[0].stale).toBe(true);
  });

  it('collects matching element stills first, then look-bible references', () => {
    const elements: Element[] = [
      { id: 'jordan', name: 'Jordan', type: 'character', description: '', createdAt: '', updatedAt: '', images: [{ id: '1', url: 'https://cdn.test/jordan.jpg', source: 'upload', createdAt: '' }] },
      { id: 'office', name: 'Office', type: 'location', description: '', createdAt: '', updatedAt: '', images: [{ id: '2', url: 'https://cdn.test/office.jpg', source: 'upload', createdAt: '' }] },
    ];
    expect(storyboardReferenceUrls(show(), show().clips[0], elements)).toEqual([
      'https://cdn.test/jordan.jpg',
      'https://cdn.test/office.jpg',
      'https://cdn.test/look.jpg',
    ]);
    const resolved = storyboardReferences(show(), show().clips[0], elements);
    expect(resolved.references.map((reference) => [reference.source, reference.name])).toEqual([
      ['element', 'Jordan'],
      ['element', 'Office'],
      ['look-bible', 'Amber office'],
    ]);
    expect(resolved.missingElementTags).toEqual([]);
    expect(storyboardPromptWithReferences('BASE PROMPT', resolved.references)).toContain(
      'IMAGE 1 — ELEMENT @Jordan: Jordan. Match its visible identity and design exactly.',
    );
  });

  it('reports shot tags that do not have an Element image', () => {
    const resolved = storyboardReferences(show(), show().clips[0], []);
    expect(resolved.references.map((reference) => reference.source)).toEqual(['look-bible']);
    expect(resolved.missingElementTags).toEqual(['@Jordan', '@Office']);
  });
});

describe('storyboard generation result', () => {
  it('finds image URLs in desktop, web, and funded relay response envelopes', () => {
    expect(storyboardResultUrl({ url: 'https://cdn.test/direct.jpg' })).toBe('https://cdn.test/direct.jpg');
    expect(storyboardResultUrl({ output: { url: '/media/generated/board.png' } })).toBe('/media/generated/board.png');
    expect(storyboardResultUrl({ result: { images: [{ image_url: 'https://cdn.test/funded.jpg' }] } })).toBe('https://cdn.test/funded.jpg');
  });

  it('retries temporary Higgsfield transport failures and then succeeds', async () => {
    let calls = 0;
    const result = await runStoryboardWithRetry(async () => {
      calls += 1;
      if (calls < 3) throw new Error('internal [0]');
      return 'ready';
    }, { wait: async () => {} });
    expect(result).toBe('ready');
    expect(calls).toBe(3);
  });

  it('does not retry a non-transient provider rejection', async () => {
    let calls = 0;
    await expect(runStoryboardWithRetry(async () => {
      calls += 1;
      throw new Error('Invalid values: aspect_ratio');
    }, { wait: async () => {} })).rejects.toThrow('Invalid values');
    expect(calls).toBe(1);
  });

  it('turns opaque provider transport failures into a useful message', () => {
    expect(isRetryableStoryboardError(new Error('internal [0]'))).toBe(true);
    expect(storyboardGenerationErrorMessage(new Error('internal [0]'))).toContain('after three attempts');
  });
});
