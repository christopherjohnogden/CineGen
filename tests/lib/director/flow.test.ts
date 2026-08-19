import { describe, expect, it } from 'vitest';
import type { Element } from '@/types/elements';
import { findMatchingElement, itemsMissingElements, mergeBreakdownItems, parseBreakdownPayload } from '@/lib/director/breakdown';
import { mergeShotlist, parseShotlistPayload } from '@/lib/director/shotlist';
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
