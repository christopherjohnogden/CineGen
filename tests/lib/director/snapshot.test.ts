import { describe, expect, it } from 'vitest';
import { PROJECT_TABS } from '@/components/workspace/top-tabs';
import { createEmptyDirectorShow } from '@/lib/director/create-show';
import { directorJobIsRunning, directorRunningLabel } from '@/lib/director/director-state';
import { directorFromSnapshot, directorFromUnknown, directorFromWorkflow } from '@/lib/director/snapshot';
import { prepareDirectorGeneration } from '@/lib/director/generate';
import type { DirectorClip, DirectorScene } from '@/types/director';

describe('director tab wiring', () => {
  it('places Director between Spaces and Edit', () => {
    expect(PROJECT_TABS.map((tab) => tab.id)).toEqual([
      'elements', 'create', 'director', 'edit', 'llm', 'export',
    ]);
  });
});

describe('director snapshot', () => {
  it('round-trips a show through snapshot and workflow extras', () => {
    const show = { ...createEmptyDirectorShow(), sourceText: 'You woke up early.' };
    expect(directorFromUnknown(show).sourceText).toBe('You woke up early.');
    expect(directorFromSnapshot({ director: show }).sourceText).toBe('You woke up early.');
    expect(directorFromWorkflow({ director: show }).sourceText).toBe('You woke up early.');
    expect(directorFromSnapshot({}).clipLengthSec).toBe(20);
    expect(directorFromSnapshot({}).adapterId).toBe('topview-auto');
    expect(directorFromUnknown({
      sourceText: 'x',
      clipLengthSec: 20,
      breakdown: [],
      scenes: [],
      clips: [],
    }).llmProvider).toBe('claude-code');
    expect(directorFromUnknown({
      ...createEmptyDirectorShow(),
      llmProvider: 'gemini',
    }).llmProvider).toBe('gemini');
    expect(directorFromUnknown({
      ...createEmptyDirectorShow(),
      llmSpend: { cost: 0.12, promptTokens: 10, completionTokens: 5, cachedTokens: 0, requestCount: 2, lastCost: 0.06 },
    }).llmSpend?.requestCount).toBe(2);
    expect(directorFromUnknown({
      ...createEmptyDirectorShow(),
      jobStatus: { type: 'look-bible', message: 'Writing look bible…' },
    }).jobStatus).toBeNull();
  });

  it('preserves RunPod storyboard model selections', () => {
    expect(directorFromUnknown({
      ...createEmptyDirectorShow(),
      storyboardModelId: 'runpod_sdxl_session',
    }).storyboardModelId).toBe('runpod_sdxl_session');
    expect(directorFromUnknown({
      ...createEmptyDirectorShow(),
      storyboardModelId: 'runpod_qwen_image_edit_session',
    }).storyboardModelId).toBe('runpod_qwen_image_edit_session');
  });

  it.each(['480p', '720p', '1080p'])('persists the %s Director generation resolution', (resolution) => {
    const show = { ...createEmptyDirectorShow(), resolution };

    expect(directorFromUnknown(structuredClone(show)).resolution).toBe(resolution);
    expect(directorFromSnapshot({ director: structuredClone(show) }).resolution).toBe(resolution);
    expect(directorFromWorkflow({ director: structuredClone(show) }).resolution).toBe(resolution);
  });

  it('strips a Final Draft ElementSettings trailer from a saved script', () => {
    const loaded = directorFromUnknown({
      ...createEmptyDirectorShow(),
      sourceText: 'EXT. FOREST - DAY\nJordan listens.\n\nCUT TO:\n<ElementSettings Type="General">\n<FontSpec Font="Courier Final Draft"/>',
    });
    expect(loaded.sourceText).toContain('CUT TO:');
    expect(loaded.sourceText).not.toMatch(/ElementSettings|Courier Final Draft/);
  });

  it('repairs old flattened text from its stored screenplay block types', () => {
    const loaded = directorFromUnknown({
      ...createEmptyDirectorShow(),
      sourceText: 'PETER\nHey.\nJordan lays the jacket over the chair.',
      sourceElements: [
        { id: 'c1', type: 'character', text: 'PETER' },
        { id: 'd1', type: 'dialogue', text: 'Hey.' },
        { id: 'a1', type: 'action', text: 'Jordan lays the jacket over the chair.' },
      ],
    });

    expect(loaded.sourceText).toBe('PETER\nHey.\n\nJordan lays the jacket over the chair.');
  });
});

describe('director job spinner', () => {
  it('names a running job in one word so the toolbar stays quiet', () => {
    expect(directorRunningLabel('shotlist')).toBe('Shotlisting…');
    expect(directorRunningLabel('breakdown')).toBe('Breaking down…');
    expect(directorRunningLabel('rewrite')).toBe('Rewriting…');
    expect(directorRunningLabel('look-bible')).toBe('Writing look…');
    expect(directorRunningLabel('generate')).toBe('Generating…');
  });

  it('treats look-bible errors as idle so Rewrite is clickable', () => {
    expect(directorJobIsRunning({
      ...createEmptyDirectorShow(),
      jobStatus: { type: 'look-bible', message: 'Writing look bible…' },
    }, 'look-bible')).toBe(true);
    expect(directorJobIsRunning({
      ...createEmptyDirectorShow(),
      jobStatus: { type: 'look-bible', message: 'Claude Code: timed out', error: true },
    }, 'look-bible')).toBe(false);
  });
});

describe('director generate folders', () => {
  it('assigns the take asset to the variant folder', () => {
    const scene: DirectorScene = {
      id: 's9', number: 9, label: 'SCENE 9 — THE BOY', summary: '', elementIds: [], clipIds: [],
    };
    const clip: DirectorClip = {
      id: '2-9b', title: 'He turns', seconds: 20, sceneId: 's9',
      beats: [
        { n: 1, from: '0:00', to: '0:07', dur: 7, text: 'a' },
        { n: 2, from: '0:07', to: '0:14', dur: 7, text: 'b' },
        { n: 3, from: '0:14', to: '0:20', dur: 6, text: 'c' },
      ],
      subject: 's', location: 'l', style: 'st', constraints: 'c', elementTags: [],
      activeVariant: { kind: 'full' }, bodyEdits: {}, takes: [],
    };
    const prepared = prepareDirectorGeneration({
      show: createEmptyDirectorShow(),
      scene,
      clip,
      folders: [],
    });
    expect(prepared.asset.folderId).toBe(prepared.variantFolderId);
    expect(prepared.asset.name).toMatch(/^9A · T01$/);
    expect(prepared.take.number).toBe(1);
    expect(prepared.request.params).not.toHaveProperty('multi_shots');
    expect(prepared.request.provider).toBe('topview');
    expect(prepared.request.params.duration).toBe(20);
  });
});
