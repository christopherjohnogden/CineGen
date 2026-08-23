import { describe, expect, it } from 'vitest';
import { breakdownAuditInput, breakdownJobInput, clipNotesJobInput, estimateSceneSeconds, lookBibleJobInput, sceneScriptText, shotlistContinuationInput, shotlistJobInput } from '@/lib/director/job-inputs';
import type { DirectorClip, DirectorShow, DirectorScene } from '@/types/director';

const show = (over: Partial<DirectorShow>): DirectorShow => ({
  sourceText: '', clipLengthSec: 10, stylePrefix: '', lookBible: {} as never,
  aspectRatio: '16:9', adapterId: '', resolution: '', generateAudio: false,
  genre: '', mode: 'source', breakdown: [], breakdownApproved: false,
  scenes: [], clips: [], ...over,
} as DirectorShow);

const SRC = 'INT. OFFICE - DAY\nDr Jordan enters.\n\nEXT. STREET - NIGHT\nHe walks fast.';
const SCENES: DirectorScene[] = [
  { id: 's1', number: 1, label: 'INT. OFFICE - DAY', summary: '', elementIds: [], clipIds: [] },
  { id: 's2', number: 2, label: 'EXT. STREET - NIGHT', summary: '', elementIds: [], clipIds: [] },
];

describe('breakdownJobInput', () => {
  it('sends the full script when no scope', () => {
    const body = breakdownJobInput(show({ sourceText: SRC }), 'none');
    expect(body).toMatch(/Dr Jordan enters/);
    expect(body).toMatch(/He walks fast/);
  });
  it('sends only the changed scene text when scoped', () => {
    const body = breakdownJobInput(show({ sourceText: SRC, scenes: SCENES }), 'none', { sceneIds: ['s1'] });
    expect(body).toMatch(/changed scenes only/i);
    expect(body).toMatch(/complete element list/i);
    expect(body).toMatch(/Dr Jordan enters/);   // scene s1 kept
    expect(body).not.toMatch(/He walks fast/);  // scene s2 omitted
    expect(body).not.toMatch(/ALREADY IDENTIFIED/);
  });
  it('numbers action lines so the model must walk every slug', () => {
    const body = breakdownJobInput(show({ sourceText: SRC }), 'none');
    expect(body).toMatch(/\[A1\] ACTION {2}Dr Jordan enters\./);
    expect(body).toMatch(/=== SCENE 1\/2 {2}INT\. OFFICE - DAY ===/);
  });
  it('audit input lists the junior pass and the numbered script', () => {
    const body = breakdownAuditInput(show({ sourceText: SRC }), [
      { id: '1', kind: 'character', name: 'Dr Jordan', tag: '@Dr-Jordan', description: '' },
    ]);
    expect(body).toMatch(/JUNIOR BREAKDOWN/);
    expect(body).toMatch(/@Dr-Jordan/);
    expect(body).toMatch(/\[A1\] ACTION/);
  });
});

describe('shotlistJobInput', () => {
  const LOOK = { filmRefs: [], moodBoards: [], notes: '' };
  it('carries EVERY scoped scene, not just the first', () => {
    const body = shotlistJobInput(show({ sourceText: SRC, scenes: SCENES, lookBible: LOOK }), SCENES);
    expect(body).toMatch(/Only these scenes/);
    expect(body).toMatch(/INT\. OFFICE - DAY/);
    expect(body).toMatch(/EXT\. STREET - NIGHT/);
  });
  it('lists all show scenes when unscoped', () => {
    const body = shotlistJobInput(show({ sourceText: SRC, scenes: SCENES, lookBible: LOOK }), undefined);
    expect(body).toMatch(/Scenes:/);
    expect(body).toMatch(/EXT\. STREET - NIGHT/);
  });
  it('scopes the element bible to what the scene actually mentions', () => {
    const breakdown = [
      { id: 'b1', kind: 'character' as const, name: 'Dr Jordan', tag: '@Dr-Jordan', description: 'therapist' },
      { id: 'b2', kind: 'prop' as const, name: 'Bicycle', tag: '@Bicycle', description: 'red bike' },
    ];
    const body = shotlistJobInput(show({ sourceText: SRC, scenes: SCENES, lookBible: LOOK, breakdown }), [SCENES[0]]);
    expect(body).toContain('@Dr-Jordan');       // named in scene 1
    expect(body).not.toContain('@Bicycle');     // never appears in the scene
  });

  it('sends only the scoped scene script slice, with a coverage target', () => {
    const body = shotlistJobInput(show({ sourceText: SRC, scenes: SCENES, lookBible: LOOK }), [SCENES[0]]);
    expect(body).toMatch(/COVERAGE TARGET/);
    expect(body).toMatch(/screen time/);
    expect(body).toMatch(/Dr Jordan enters/);      // scene 1 text kept
    expect(body).not.toMatch(/He walks fast/);     // scene 2 text excluded
  });

  it('scopes legacy descriptive scene labels by scene number instead of sending the full script', () => {
    const legacyScenes = [
      { ...SCENES[0], label: 'SCENE 1 — THE APPOINTMENT' },
      { ...SCENES[1], label: 'SCENE 2 — THE ESCAPE' },
    ];
    const current = show({ sourceText: SRC, scenes: legacyScenes, lookBible: LOOK });
    const body = shotlistJobInput(current, [legacyScenes[0]]);

    expect(sceneScriptText(current, legacyScenes[0])).toContain('Dr Jordan enters.');
    expect(body).toContain('Dr Jordan enters.');
    expect(body).not.toContain('He walks fast.');
  });

  it('fails safely when a requested scene cannot be isolated', () => {
    const missing = { ...SCENES[0], id: 'missing', number: 99, label: 'SCENE 99' };
    const current = show({ sourceText: SRC, scenes: SCENES, lookBible: LOOK });

    expect(() => shotlistJobInput(current, [missing])).toThrow(/Could not isolate Scene 99/);
  });
});

describe('look bible job input', () => {
  it('tells the model that mood-board stills are attached as images', () => {
    const body = lookBibleJobInput(show({
      lookBible: {
        filmRefs: [],
        notes: '',
        moodBoards: [{ id: '1', name: 'kitchen.jpg', url: 'local-media://file/tmp/kitchen.jpg' }],
      },
    }));
    expect(body).toMatch(/attached as images/i);
    expect(body).toMatch(/what you SEE/i);
  });
});

describe('coverage estimate + continuation input', () => {
  it('estimates screen time from the scene word count, floored at the clip length', () => {
    const s = show({ sourceText: SRC, scenes: SCENES, clipLengthSec: 20 as DirectorShow['clipLengthSec'] });
    // Tiny scenes floor at one clip length.
    expect(estimateSceneSeconds(s, SCENES[0])).toBe(20);
    const long = show({
      sourceText: `INT. OFFICE - DAY\n${'word '.repeat(600)}`,
      scenes: [SCENES[0]],
      clipLengthSec: 20 as DirectorShow['clipLengthSec'],
    });
    expect(estimateSceneSeconds(long, SCENES[0])).toBe(201); // (600 words + 3-word heading) / 3 wps
  });

  it('tells the continuation where the existing clips stop', () => {
    const s = show({ sourceText: SRC, scenes: SCENES, lookBible: { filmRefs: [], moodBoards: [], notes: '' } as DirectorShow['lookBible'] });
    const clip = {
      id: '1-1a', title: 'Opening', seconds: 20, sceneId: 's1', elementTags: [], subject: '', location: '',
      style: '', constraints: '', activeVariant: { kind: 'full' as const }, bodyEdits: {}, takes: [],
      beats: [{ n: 1, from: '0:00', to: '0:20', dur: 20, text: 'He crosses to the desk.' }],
    };
    const body = shotlistContinuationInput(s, SCENES[0], [clip], new Map([['1-1a', '1A']]));
    expect(body).toMatch(/EXISTING clips below cover only ~20s/);
    expect(body).toMatch(/\[1A\].*ends on: He crosses to the desk\./);
    expect(body).toMatch(/continue from there to the END/);
  });
});

describe('clipNotesJobInput', () => {
  it('scopes notes to one clip and lets shots be named as S1/S2', () => {
    const clip: DirectorClip = {
      id: 'c1', sceneId: 's1', title: 'Peter waits', seconds: 20,
      subject: '', location: '', style: '', constraints: '', elementTags: [],
      activeVariant: { kind: 'full' }, bodyEdits: {}, takes: [],
      beats: [
        { n: 1, from: '0:00', to: '0:08', dur: 8, text: 'Peter waits on the sofa.' },
        { n: 2, from: '0:08', to: '0:20', dur: 12, text: 'Jordan enters.' },
      ],
    };
    const body = clipNotesJobInput(SCENES[0], clip, '1A', 'S2 should be over Jordan\'s shoulder');
    expect(body).toMatch(/THIS CLIP is 1A/);
    expect(body).toMatch(/ACTIVE VIEW: full 20s multishot/);
    expect(body).toMatch(/S1, S2/);
    expect(body).toMatch(/Peter waits on the sofa/);
    expect(body).toMatch(/S2 should be over Jordan's shoulder/);
    expect(body).not.toMatch(/Clips:/);
  });

  it('scopes unnamed generate notes to the isolated shot in view', () => {
    const clip: DirectorClip = {
      id: 'c1', sceneId: 's1', title: 'Peter waits', seconds: 20,
      subject: '', location: '', style: '', constraints: '', elementTags: [],
      activeVariant: { kind: 'isolated', beatN: 2, mode: 'held' }, bodyEdits: {}, takes: [],
      beats: [
        { n: 1, from: '0:00', to: '0:08', dur: 8, text: 'Peter waits on the sofa.' },
        { n: 2, from: '0:08', to: '0:20', dur: 12, text: 'Jordan enters.' },
      ],
    };
    const body = clipNotesJobInput(SCENES[0], clip, '1A', 'Peter should fidget');
    expect(body).toMatch(/ACTIVE VIEW: isolated S2 \(held 20s\)/);
    expect(body).toMatch(/Unnamed notes apply to S2/);
  });
});
