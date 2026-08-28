import { describe, expect, it } from 'vitest';
import type { DirectorShow } from '@/types/director';
import { createEmptyDirectorShow } from '@/lib/director/create-show';
import { parseShotlistPayload } from '@/lib/director/shotlist';
import {
  applyClaudeShotlistImport,
  claudeShotlistImportPrompt,
  parseClaudeShotlistImport,
} from '@/lib/director/shotlist-import';

function project(): DirectorShow {
  const base = createEmptyDirectorShow();
  const scenes = [
    { id: 'real-office', number: 1, label: 'INT. OFFICE - DAY', summary: '', elementIds: [], clipIds: ['old-1'] },
    { id: 'real-forest', number: 2, label: 'EXT. FOREST - NIGHT', summary: '', elementIds: [], clipIds: ['old-2'] },
  ];
  const old = parseShotlistPayload({
    clips: [
      { id: 'old-1', title: 'Old office', seconds: 20, sceneId: 'real-office', beats: [{ n: 1, from: '0:00', to: '0:20', dur: 20, text: 'Old office action.' }] },
      { id: 'old-2', title: 'Old forest', seconds: 20, sceneId: 'real-forest', beats: [{ n: 1, from: '0:00', to: '0:20', dur: 20, text: 'Old forest action.' }] },
    ],
  }).clips;
  return {
    ...base,
    sourceText: 'INT. OFFICE - DAY\nMara opens the file.\n\nEXT. FOREST - NIGHT\nMara runs.',
    mode: 'shotlist',
    scenes,
    clips: old,
    selectedSceneId: 'real-office',
    selectedClipId: 'old-1',
    storyboardFrames: [
      { id: 'old-1::1', clipId: 'old-1', beatN: 1, prompt: 'old', modelId: 'nano_banana_2', status: 'ready', imageUrl: 'office.jpg' },
      { id: 'old-2::1', clipId: 'old-2', beatN: 1, prompt: 'keep', modelId: 'nano_banana_2', status: 'ready', imageUrl: 'forest.jpg' },
    ],
  };
}

const CLAUDE_SCENE_ONE = `\`\`\`json
{
  "stylePrefix": "Naturalistic 35mm drama",
  "scenes": [{ "id": "claude-scene-1", "number": 1, "label": "SCENE 1 — THE FILE" }],
  "clips": [{
    "id": "1A",
    "title": "Mara opens the file",
    "seconds": 20,
    "sceneId": "claude-scene-1",
    "elementTags": ["@Mara", "@File"],
    "subject": "@Mara",
    "location": "@Office",
    "blocking": "Mara remains frame left at the desk.",
    "fov": 47,
    "style": "Muted green and amber.",
    "constraints": "Continuous screen direction.",
    "beats": [
      { "n": 1, "from": "0:00", "to": "0:08", "dur": 8, "text": "Mara draws the file closer.", "cam": "Locked medium." },
      { "n": 2, "from": "0:08", "to": "0:20", "dur": 12, "text": "She opens it and reads.", "cam": "Slow push-in." }
    ]
  }],
  "coveredToEnd": true
}
\`\`\``;

describe('Claude shotlist import', () => {
  it('accepts fenced Claude JSON and maps scene numbers onto the project scene ids', () => {
    const result = parseClaudeShotlistImport(CLAUDE_SCENE_ONE, project());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft).toMatchObject({ clipCount: 1, shotCount: 2, seconds: 20 });
    expect(result.draft.clips[0].sceneId).toBe('real-office');
    expect(result.draft.clips[0].id).toMatch(/^1-/);
    expect(result.draft.warnings[0]).toMatch(/Only 1 of 2/);
  });

  it('replaces only imported scenes and clears only their stale storyboard frames', () => {
    const show = project();
    const result = parseClaudeShotlistImport(CLAUDE_SCENE_ONE, show);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = applyClaudeShotlistImport(show, result.draft);
    expect(next.clips.some((clip) => clip.id === 'old-1')).toBe(false);
    expect(next.clips.some((clip) => clip.id === 'old-2')).toBe(true);
    expect(next.clips.find((clip) => clip.sceneId === 'real-office')?.title).toBe('Mara opens the file');
    expect(next.storyboardFrames?.map((frame) => frame.id)).toEqual(['old-2::1']);
    expect(next.stylePrefix).toBe('Naturalistic 35mm drama');
  });

  it('rejects clips that cannot be matched to a project scene', () => {
    const result = parseClaudeShotlistImport(JSON.stringify({
      clips: [{
        id: '9-a', title: 'Unknown', seconds: 20, sceneId: 'scene-nine',
        beats: [{ n: 1, from: '0:00', to: '0:20', dur: 20, text: 'Something happens.' }],
      }],
    }), project());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toMatch(/could not match sceneId/);
  });

  it('builds a Claude prompt with the app schema and the current project input', () => {
    const prompt = claudeShotlistImportPrompt(project());
    expect(prompt).toContain('Return one raw JSON object only');
    expect(prompt).toContain('"clips"');
    expect(prompt).toContain('real-office');
    expect(prompt).toContain('Mara opens the file.');
  });
});
