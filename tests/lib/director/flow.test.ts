import { describe, expect, it } from 'vitest';
import type { Element } from '@/types/elements';
import { assignBreakdownElement, findMatchingElement, itemsMissingElements, mergeBreakdownItems, parseBreakdownPayload } from '@/lib/director/breakdown';
import { clipDisplayLabels, mergeShotlist, parseShotlistPayload } from '@/lib/director/shotlist';
import { planDirectorFolders } from '@/lib/director/folders';
import { createPendingTake } from '@/lib/director/generate';
import type { DirectorBreakdownItem, DirectorClip, DirectorScene } from '@/types/director';

const elements: Element[] = [{
  id: 'el-1',
  name: 'Dr Jordan',
  type: 'character',
  description: '',
  images: [],
  createdAt: '',
  updatedAt: '',
}];

describe('director breakdown', () => {
  it('parses items and matches existing elements by name', () => {
    const parsed = parseBreakdownPayload({
      items: [{ kind: 'character', name: 'Dr Jordan', tag: '@Dr-Jordan', description: 'therapist' }],
      scenes: [{ number: 1, label: 'SCENE 1 — ARRIVAL', summary: 'wakes' }],
    });
    expect(parsed.items[0].tag).toBe('@Dr-Jordan');
    expect(findMatchingElement(elements, parsed.items[0])?.id).toBe('el-1');
    const merged = mergeBreakdownItems([], parsed.items, elements);
    expect(merged[0].elementId).toBe('el-1');
    expect(itemsMissingElements(merged, elements)).toEqual([]);
  });

  it('assigns a suggestion onto an existing library element without creating one', () => {
    const items: DirectorBreakdownItem[] = [{
      id: 'p1', kind: 'prop', name: 'Sofa', tag: '@Sofa', description: 'olive velvet',
    }];
    const assigned = assignBreakdownElement(items, '@Sofa', 'el-sofa');
    expect(assigned[0].elementId).toBe('el-sofa');
    expect(items[0].elementId).toBeUndefined();
  });

  it('does not duplicate on re-merge', () => {
    const first = mergeBreakdownItems([], parseBreakdownPayload({
      items: [{ kind: 'prop', name: 'Pen', description: '' }],
      scenes: [],
    }).items, []);
    const second = mergeBreakdownItems(first, first, []);
    expect(second).toHaveLength(1);
  });

  it('preserves enriched actingProfile/voice/enrichedAt when re-merged from identify pass', () => {
    // An enriched character already in the show breakdown.
    const enrichedAt = 1_700_000_000_000;
    const existing: DirectorBreakdownItem[] = [{
      id: 'char-1',
      kind: 'character',
      name: 'Dr Jordan',
      tag: '@Dr-Jordan',
      description: 'therapist',
      actingProfile: 'measured, clinical, warm undertone',
      voice: 'low, even, unhurried',
      enrichedAt,
    }];
    // The identify prompt re-runs breakdown and emits the same tag WITHOUT
    // actingProfile/voice/enrichedAt (parseBreakdownPayload gives undefined own-keys).
    const incoming = parseBreakdownPayload({
      items: [{ kind: 'character', name: 'Dr Jordan', tag: '@Dr-Jordan', description: 'therapist, updated' }],
      scenes: [],
    }).items;
    const merged = mergeBreakdownItems(existing, incoming, elements);
    expect(merged).toHaveLength(1);
    // Enriched fields survive the identify re-merge.
    expect(merged[0].actingProfile).toBe('measured, clinical, warm undertone');
    expect(merged[0].voice).toBe('low, even, unhurried');
    expect(merged[0].enrichedAt).toBe(enrichedAt);
    // Incoming still updates the non-enriched descriptive fields.
    expect(merged[0].description).toBe('therapist, updated');
    expect(merged[0].id).toBe('char-1');
  });
});

describe('director shotlist parse', () => {
  it('keeps takes when merging the same clip id', () => {
    const incoming = parseShotlistPayload({
      scenes: [{ id: 's1', number: 1, label: 'SCENE 1 — ARRIVAL' }],
      clips: [{
        id: '2-1a',
        title: 'He wakes',
        seconds: 20,
        sceneId: 's1',
        subject: 's',
        location: 'l',
        style: 'st',
        constraints: 'c',
        beats: [
          { n: 1, from: '0:00', to: '0:10', dur: 10, text: 'a' },
          { n: 2, from: '0:10', to: '0:20', dur: 10, text: 'b' },
        ],
      }],
    });
    expect(incoming.errors).toEqual([]);
    const existing: DirectorClip[] = [{
      ...incoming.clips[0],
      takes: [{
        id: 'keep', number: 1, variantKey: 'full', status: 'done',
        adapterId: 'seedance-2.5', modelId: 'seedance_2_5', promptSnapshot: 'old', createdAt: '',
      }],
    }];
    const merged = mergeShotlist(incoming.scenes, existing, incoming);
    expect(merged.clips[0].takes[0].id).toBe('keep');
  });

  it('remaps LLM-invented scene ids onto the existing scenes so new clips never orphan', () => {
    // The breakdown assigned real ids; the LLM answered with "scene-1"-style
    // ids of its own. Clips must land on the existing scenes regardless.
    const existingScenes: DirectorScene[] = [{
      id: 'real-scene-a', number: 1, label: 'INT. OFFICE - DAY', summary: '', elementIds: [], clipIds: [],
    }, {
      id: 'real-scene-b', number: 2, label: 'EXT. FOREST - DAY', summary: '', elementIds: [], clipIds: [],
    }];
    const incoming = parseShotlistPayload({
      scenes: [
        { id: 'scene-1', number: 1, label: 'INT. OFFICE - DAY', summary: 's' },
        { id: 'scene-2', number: 2, label: 'EXT. FOREST - DAY', summary: 's' },
      ],
      clips: [
        {
          id: '1-1a', title: 'Pill', seconds: 20, sceneId: 'scene-1', subject: '', location: '', style: '', constraints: '',
          beats: [{ n: 1, from: '0:00', to: '0:20', dur: 20, text: 'He takes the pill.' }],
        },
        {
          id: '2-1a', title: 'Forest', seconds: 20, sceneId: 'totally-unknown', subject: '', location: '', style: '', constraints: '',
          beats: [{ n: 1, from: '0:00', to: '0:20', dur: 20, text: 'He wakes in the forest.' }],
        },
        {
          // A model told to copy sceneIds verbatim sometimes bakes them into
          // the clip id too — it must normalize back to "number-letter".
          id: 'real-scene-a-1b', title: 'Arm', seconds: 20, sceneId: 'real-scene-a', subject: '', location: '', style: '', constraints: '',
          beats: [{ n: 1, from: '0:00', to: '0:20', dur: 20, text: 'He shows the arm.' }],
        },
      ],
    });
    const merged = mergeShotlist(existingScenes, [], incoming);
    expect(merged.scenes).toHaveLength(2); // matched by label, not appended
    expect(merged.clips.find((c) => c.id === '1-1a')?.sceneId).toBe('real-scene-a');
    // Unknown sceneId falls back to the scene number in the clip id prefix.
    expect(merged.clips.find((c) => c.id === '2-1a')?.sceneId).toBe('real-scene-b');
    expect(merged.scenes.find((s) => s.id === 'real-scene-a')?.clipIds).toContain('1-1a');
    // Uuid-prefixed clip id normalized to scene number + suffix.
    expect(merged.clips.some((c) => c.id === '1-1b')).toBe(true);
    expect(merged.clips.some((c) => c.id.includes('real-scene-a-'))).toBe(false);
  });

  it('keeps clips whose identity fields drift (label/clipId/name) instead of dropping them', () => {
    const parsed = parseShotlistPayload({
      clips: [
        { label: '1-c', name: 'The turn', seconds: 20, sceneId: 's1', beats: [{ n: 1, from: '0:00', to: '0:20', dur: 20, text: 'He turns.' }] },
        { clipId: '1-d', gist: 'The reply', seconds: 20, sceneId: 's1', beats: [{ n: 1, from: '0:00', to: '0:20', dur: 20, text: 'She answers.' }] },
      ],
    }, 's1');
    expect(parsed.rawClipCount).toBe(2);
    expect(parsed.clips).toHaveLength(2);
    expect(parsed.clips[0].id).toBe('1-c');
    expect(parsed.clips[0].title).toBe('The turn');
    expect(parsed.clips[1].id).toBe('1-d');
    expect(parsed.clips[1].title).toBe('The reply');
  });

  it('reads drifted beat shapes ("shots", description text, timecode-only durations) and self-heals timing', () => {
    const parsed = parseShotlistPayload({
      clips: [{
        id: '1-e', title: 'Drift', seconds: 20, sceneId: 's1',
        // "shots" instead of "beats"; description instead of text; no dur — only from/to.
        shots: [
          { n: 1, from: '0:00', to: '0:12', description: 'He stands.' },
          { n: 2, from: '0:12', to: '0:18', content: 'She replies.', dialogue: 'No.', character: 'Ada' },
        ],
      }],
    }, 's1');
    expect(parsed.errors).toEqual([]);
    const clip = parsed.clips[0];
    expect(clip.beats).toHaveLength(2);
    expect(clip.beats[0].text).toBe('He stands.');
    expect(clip.beats[1].quote).toBe('No.');
    expect(clip.beats[1].speaker).toBe('@Ada');
    // 12s + 6s ≠ 20s — proportionally retimed to the stated clip length.
    expect(clip.beats.reduce((sum, beat) => sum + beat.dur, 0)).toBe(20);
    expect(clip.seconds).toBe(20);
  });

  it('parses the coveredToEnd report in boolean and string forms', () => {
    expect(parseShotlistPayload({ clips: [], coveredToEnd: true }, 's1').coveredToEnd).toBe(true);
    expect(parseShotlistPayload({ clips: [], coveredToEnd: 'false' }, 's1').coveredToEnd).toBe(false);
    expect(parseShotlistPayload({ clips: [] }, 's1').coveredToEnd).toBeUndefined();
  });

  it('labels clips by scene number + position letter, regardless of stored id', () => {
    const scenes: DirectorScene[] = [
      { id: 'sa', number: 1, label: 'INT. OFFICE - DAY', summary: '', elementIds: [], clipIds: [] },
      { id: 'sb', number: 2, label: 'EXT. FOREST - DAY', summary: '', elementIds: [], clipIds: [] },
    ];
    const clip = (id: string, sceneId: string, altOf?: string): DirectorClip => ({
      id, title: id, seconds: 20, sceneId, altOf, beats: [], subject: '', location: '', style: '', constraints: '',
      elementTags: [], activeVariant: { kind: 'full' }, bodyEdits: {}, takes: [],
    });
    const labels = clipDisplayLabels(scenes, [
      clip('ugly-uuid-1a', 'sa'),
      clip('ugly-uuid-1b', 'sa'),
      clip('x', 'sb'),
      clip('x-alt', 'sb', 'x'),
    ]);
    expect(labels.get('ugly-uuid-1a')).toBe('1A');
    expect(labels.get('ugly-uuid-1b')).toBe('1B');
    expect(labels.get('x')).toBe('2A');
    expect(labels.get('x-alt')).toBe('2A ALT');
  });

  it('slate letters skip O and roll over to AA after Z', () => {
    const scenes: DirectorScene[] = [
      { id: 'sa', number: 1, label: 'INT. OFFICE - DAY', summary: '', elementIds: [], clipIds: [] },
    ];
    const many = Array.from({ length: 52 }, (_, i) => ({
      id: `c${i}`, title: `clip ${i}`, seconds: 20, sceneId: 'sa', beats: [], subject: '', location: '',
      style: '', constraints: '', elementTags: [], activeVariant: { kind: 'full' as const }, bodyEdits: {}, takes: [],
    }));
    const labels = clipDisplayLabels(scenes, many);
    expect(labels.get('c13')).toBe('1N');
    expect(labels.get('c14')).toBe('1P');  // O skipped — reads as a zero
    expect(labels.get('c24')).toBe('1Z');
    expect(labels.get('c25')).toBe('1AA'); // rollover
    expect(labels.get('c26')).toBe('1AB');
    expect(labels.get('c49')).toBe('1AZ');
    expect(labels.get('c50')).toBe('1BA');
  });
});

describe('director folders and takes', () => {
  it('creates a nested Director/Scene/Clip/Variant tree', () => {
    const scene: DirectorScene = {
      id: 's9', number: 9, label: 'SCENE 9 — THE BOY', summary: '', elementIds: [], clipIds: [],
    };
    const clip: DirectorClip = {
      id: '2-9b', title: 'He turns', seconds: 20, sceneId: 's9', beats: [{ n: 3, from: '0:14', to: '0:20', dur: 6, text: 'turn' }],
      subject: '', location: '', style: '', constraints: '', elementTags: [],
      activeVariant: { kind: 'full' }, bodyEdits: {}, takes: [],
    };
    const planned = planDirectorFolders({ folders: [], scene, clip, variantKey: '3:native' });
    expect(planned.foldersToAdd.map((folder) => folder.name)).toEqual([
      'Director',
      'Scene 09 — THE BOY',
      '2-9b — He turns',
      'Shot 3 · 6s',
    ]);
    expect(planned.foldersToAdd[3].parentId).toBe(planned.clipId);
  });

  it('increments failed takes without skipping numbers', () => {
    const clip: DirectorClip = {
      id: '2-1a', title: 'Wake', seconds: 20, sceneId: 's1', beats: [],
      subject: '', location: '', style: '', constraints: '', elementTags: [],
      activeVariant: { kind: 'full' }, bodyEdits: {},
      takes: [{
        id: 'a', number: 1, variantKey: 'full', status: 'failed',
        adapterId: 'seedance-2.5', modelId: 'seedance_2_5', promptSnapshot: '', createdAt: '',
      }],
    };
    const next = createPendingTake({
      clip, variant: { kind: 'full' }, adapterId: 'seedance-2.5', modelId: 'seedance_2_5', promptSnapshot: 'p',
    });
    expect(next.number).toBe(2);
  });
});
