import { describe, expect, it } from 'vitest';
import { createEmptyDirectorShow } from '@/lib/director/create-show';
import {
  storyboardPlan,
  storyboardModelOption,
  storyboardModelForRunpodSession,
  storyboardRunpodDimensions,
  storyboardGenerationErrorMessage,
  isRetryableStoryboardError,
  runStoryboardWithRetry,
  storyboardPromptWithReferences,
  storyboardQwenRequest,
  storyboardPromptWithoutImageReferences,
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

  it('builds Qwen references and numbered bindings from the same ordered Element set', () => {
    const elements: Element[] = [
      { id: 'jordan', name: 'Jordan', type: 'character', description: '', createdAt: '', updatedAt: '', images: [{ id: '1', url: 'https://cdn.test/jordan.jpg', source: 'upload', createdAt: '' }] },
      { id: 'office', name: 'Office', type: 'location', description: '', createdAt: '', updatedAt: '', images: [{ id: '2', url: 'https://cdn.test/office.jpg', source: 'upload', createdAt: '' }] },
    ];
    const references = storyboardReferences(show(), show().clips[0], elements).references;

    const fresh = storyboardQwenRequest(storyboardPlan(show())[0].prompt, references);
    expect(fresh.referenceImages).toEqual([
      'https://cdn.test/office.jpg',
      'https://cdn.test/jordan.jpg',
      'https://cdn.test/look.jpg',
    ]);
    expect(fresh.prompt).toContain('Picture 1 is the base location');
    expect(fresh.prompt).toContain('Picture 2 is a character identity reference');
    expect(fresh.prompt).toContain('Picture 3 is a visual-style reference only');
    expect(fresh.prompt).toContain('ACTION — the character shown in Picture 2 wheels toward the desk.');
    expect(fresh.prompt).toContain('the location shown in Picture 1');
    expect(fresh.prompt).not.toContain('@');

    const revision = storyboardQwenRequest(
      'REVISE PROMPT',
      references,
      'https://cdn.test/existing-frame.jpg',
    );
    expect(revision.referenceImages).toEqual([
      'https://cdn.test/existing-frame.jpg',
      'https://cdn.test/office.jpg',
      'https://cdn.test/jordan.jpg',
    ]);
    expect(revision.prompt).toContain('Picture 1 is the base scene');
    expect(revision.prompt).toContain('Picture 2 is the location reference');
    expect(revision.prompt).toContain('Picture 3 is a character identity reference');
  });

  it('reports shot tags that do not have an Element image', () => {
    const resolved = storyboardReferences(show(), show().clips[0], []);
    expect(resolved.references.map((reference) => reference.source)).toEqual(['look-bible']);
    expect(resolved.missingElementTags).toEqual(['@Jordan', '@Office']);
  });

  it('removes identity-lock copy when a text-only model receives no reference files', () => {
    const prompt = storyboardPlan(show())[0].prompt;
    expect(prompt).toContain('ACTIVE REFERENCES');
    const textOnly = storyboardPromptWithoutImageReferences(prompt);
    expect(textOnly).not.toContain('ACTIVE REFERENCES');
    expect(textOnly).not.toContain('SUPPLIED IMAGE BINDINGS');
    expect(textOnly).toContain('ACTION — @Jordan wheels toward the desk.');
    expect(textOnly).toContain('FRAME —');
  });
});

describe('storyboard generation result', () => {
  it('describes RunPod storyboard models and maps film ratios to native image sizes', () => {
    expect(storyboardModelOption('runpod_sdxl_session')).toMatchObject({
      provider: 'runpod',
      sessionModel: 'sdxl',
    });
    expect(storyboardModelOption('runpod_qwen_image_edit_session')).toMatchObject({
      provider: 'runpod',
      sessionModel: 'qwen-image-edit',
      requiresSourceImage: true,
    });
    expect(storyboardModelOption('runpod_sdxl_session').label).toBe('RunPod Session · SDXL');
    expect(storyboardModelOption('nano_banana_2').label).toBe('Higgsfield · Nano Banana 2');
    expect(storyboardRunpodDimensions('16:9')).toEqual({ width: 1344, height: 768 });
    expect(storyboardRunpodDimensions('9:16')).toEqual({ width: 768, height: 1344 });
    expect(storyboardRunpodDimensions('4:3')).toEqual({ width: 1152, height: 896 });
  });

  it('selects an installed RunPod image model when a generation session becomes ready', () => {
    expect(storyboardModelForRunpodSession('nano_banana_2', true, ['sdxl', 'qwen-image-edit']))
      .toBe('runpod_sdxl_session');
    expect(storyboardModelForRunpodSession('nano_banana_2', true, ['qwen-image-edit']))
      .toBe('runpod_qwen_image_edit_session');
  });

  it('preserves an available RunPod choice and does not change providers for an unavailable session', () => {
    expect(storyboardModelForRunpodSession('runpod_qwen_image_edit_session', true, ['sdxl', 'qwen-image-edit']))
      .toBe('runpod_qwen_image_edit_session');
    expect(storyboardModelForRunpodSession('gpt_image_2', false, ['sdxl']))
      .toBe('gpt_image_2');
    expect(storyboardModelForRunpodSession('gpt_image_2', true, []))
      .toBe('gpt_image_2');
  });

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
    expect(storyboardGenerationErrorMessage(new Error('HTTP 504'), 'runpod')).toContain('RunPod session');
  });
});
