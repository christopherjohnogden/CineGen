import { describe, expect, it } from 'vitest';
import type { DirectorClip, DirectorScene, DirectorStagingMap } from '@/types/director';
import { createEmptyDirectorShow } from '@/lib/director/create-show';
import { bindStagingDiagram } from '@/lib/director/staging-diagram';
import {
  adoptClipFramings, applyFraming, applyFramingToBeat, beatAtPlayhead, beatFramingId, bindKeyForFrameGrab, boundFramingId, clearFramingBind, framingPickerLabel, framingShotTypeLabel, framingThumb, resolveClipStaging, revertFramingOnBeat, uniqueFramingName, uniqueFramingPickerLabels,
  upsertFramingReserve,
} from '@/lib/director/framing-reserve';

const scene: DirectorScene = {
  id: 's1', number: 1, label: 'SCENE 1 — WARD', summary: '', elementIds: [], clipIds: ['a', 'b'],
};

const map = (url: string, extra?: Partial<DirectorStagingMap>): DirectorStagingMap => ({
  enabled: true,
  stagingTag: '@staging_ward_v1',
  locationTag: '@loc_ward',
  figures: [],
  diagramUrl: url,
  ...extra,
});

const clip = (id: string, extra?: Partial<DirectorClip>): DirectorClip => ({
  id, title: id, seconds: 14, sceneId: 's1',
  beats: [
    { n: 1, from: '0:00', to: '0:07', dur: 7, text: '@Peter sits.' },
    { n: 2, from: '0:07', to: '0:14', dur: 7, text: '@Jordan stands.' },
  ],
  subject: 'a talk', location: 'the ward', style: '', constraints: '',
  elementTags: ['@Peter'],
  activeVariant: { kind: 'full' }, bodyEdits: {}, takes: [],
  ...extra,
});

describe('framing reserve', () => {
  it('maps a Full-take playhead onto S1–S4 from beat timings', () => {
    const multi = clip('a', {
      seconds: 20,
      beats: [
        { n: 1, from: '0:00', to: '0:05', dur: 5, text: 'ws', grammar: { size: 'ws' } },
        { n: 2, from: '0:05', to: '0:10', dur: 5, text: 'cu', grammar: { size: 'cu' } },
        { n: 3, from: '0:10', to: '0:15', dur: 5, text: 'cu', grammar: { size: 'cu' } },
        { n: 4, from: '0:15', to: '0:20', dur: 5, text: 'ms', grammar: { size: 'ms' } },
      ],
      activeVariant: { kind: 'full' },
    });
    expect(beatAtPlayhead(multi, 0)?.n).toBe(1);
    expect(beatAtPlayhead(multi, 6)?.n).toBe(2);
    expect(beatAtPlayhead(multi, 12)?.n).toBe(3);
    expect(beatAtPlayhead(multi, 19)?.n).toBe(4);
    expect(bindKeyForFrameGrab(multi, { variant: { kind: 'full' }, timeSec: 12 })).toBe('3');
    expect(bindKeyForFrameGrab(multi, { variant: { kind: 'isolated', beatN: 1, mode: 'held' }, timeSec: 12 })).toBe('1');
  });

  it('shows the liked frame on storyboard cards and keeps the diagram for generate', () => {
    expect(framingThumb(map('https://cdn/map.png', { sourceFrameUrl: 'https://cdn/take.jpg' }))).toBe('https://cdn/take.jpg');
    expect(framingThumb(map('https://cdn/map.png'))).toBe('https://cdn/map.png');
  });

  it('labels storyboard options from the source slate and shot type', () => {
    const named = upsertFramingReserve(createEmptyDirectorShow(), {
      name: 'Peter waits as Jordan enters',
      map: map('https://cdn/ots.png', { sourceBindKey: '2' }),
      look: { grammar: { size: 'mcu', bodies: 'ots' }, cam: 'over-the-shoulder of Peter' },
      sourceClipId: 'a',
      sourceSceneId: 's1',
      variantKey: '2',
    });
    const two = upsertFramingReserve(named.show, {
      name: 'Both in the doorway',
      map: map('https://cdn/two.png'),
      look: { grammar: { size: 'ms', bodies: 'two' } },
      sourceClipId: 'a',
      variantKey: '1',
    });
    const cu = upsertFramingReserve(two.show, {
      name: 'Peter’s face',
      map: map('https://cdn/cu.png'),
      look: { grammar: { size: 'cu', bodies: 'one' } },
      sourceClipId: 'b',
      variantKey: '3:held',
    });
    const show = { ...cu.show, scenes: [scene], clips: [clip('a'), clip('b')] };
    expect(framingShotTypeLabel(named.framing)).toBe('OTS');
    expect(framingPickerLabel(show, named.framing)).toBe('1A · S2 · OTS');
    expect(framingPickerLabel(show, two.framing)).toBe('1A · S1 · 2-shot');
    expect(framingPickerLabel(show, cu.framing)).toBe('1B · S3 · CU');
    const labels = uniqueFramingPickerLabels(show, show.framingReserve ?? []);
    expect(labels.get(named.framing.id)).toBe('1A · S2 · OTS');
    expect(labels.get(cu.framing.id)).toBe('1B · S3 · CU');
  });

  it('uniques card names when the same label is saved twice', () => {
    const first = upsertFramingReserve(createEmptyDirectorShow(), { name: '1A · S1', map: map('https://cdn/a.png') });
    const second = upsertFramingReserve(first.show, { name: '1A · S1', map: map('https://cdn/b.png') });
    expect(uniqueFramingName(first.show, '1A · S1')).toBe('1A · S1 (2)');
    expect(second.framing.name).toBe('1A · S1 (2)');
    expect(second.show.framingReserve).toHaveLength(2);
  });

  it('reuses the card when the same diagram URL is saved again', () => {
    const first = upsertFramingReserve(createEmptyDirectorShow(), { name: 'MCU', map: map('https://cdn/a.png') });
    const again = upsertFramingReserve(first.show, { name: 'MCU copy', map: map('https://cdn/a.png') });
    expect(again.framing.id).toBe(first.framing.id);
    expect(again.show.framingReserve).toHaveLength(1);
  });

  it('binds an isolated shot without overwriting the clip default', () => {
    const wide = upsertFramingReserve(createEmptyDirectorShow(), { name: 'WS', map: map('https://cdn/ws.png') });
    const tight = upsertFramingReserve(wide.show, { name: 'CU', map: map('https://cdn/cu.png') });
    const seeded = {
      ...tight.show,
      scenes: [scene],
      clips: [clip('a', { staging: { ...wide.framing.map, reserveId: wide.framing.id } })],
    };
    const onS1 = applyFraming(
      { ...seeded, clips: seeded.clips.map((entry) => ({ ...entry, activeVariant: { kind: 'isolated', beatN: 1, mode: 'held' } })) },
      'a',
      tight.framing.id,
      'variant',
    );
    const row = onS1.clips[0];
    expect(boundFramingId(row, { kind: 'isolated', beatN: 1, mode: 'held' })).toBe(tight.framing.id);
    expect(boundFramingId(row, { kind: 'isolated', beatN: 1, mode: 'native' })).toBe(tight.framing.id);
    expect(boundFramingId(row, { kind: 'isolated', beatN: 2, mode: 'held' })).toBe(wide.framing.id);
    expect(resolveClipStaging(onS1, row, { kind: 'full' })?.diagramUrl).toBe('https://cdn/ws.png');
    expect(resolveClipStaging(onS1, row, { kind: 'isolated', beatN: 1, mode: 'held' })?.diagramUrl).toBe('https://cdn/cu.png');
  });

  it('rewrites an isolated WS beat to the liked CU so the compiled prompt matches that shot', () => {
    const saved = upsertFramingReserve(createEmptyDirectorShow(), {
      name: 'CU',
      map: map('https://cdn/cu.png'),
      look: { grammar: { size: 'cu', bodies: 'one', clean: 'clean' }, cam: 'close-up of Peter' },
    });
    const show = {
      ...saved.show,
      scenes: [scene],
      clips: [clip('a', {
        beats: [
          { n: 1, from: '0:00', to: '0:07', dur: 7, text: '@Peter sits.', grammar: { size: 'cu' } },
          { n: 2, from: '0:07', to: '0:14', dur: 7, text: '@Jordan stands.', grammar: { size: 'ws', bodies: 'two' }, cam: 'wide of the room' },
        ],
        activeVariant: { kind: 'isolated', beatN: 2, mode: 'held' },
        bodyEdits: { '2:held': 'old wide prompt' },
      })],
    };
    const next = applyFraming(show, 'a', saved.framing.id, 'variant');
    expect(next.clips[0].beats[0].grammar?.size).toBe('cu');
    expect(next.clips[0].beats[1].grammar).toMatchObject({ size: 'cu', bodies: 'one', clean: 'clean' });
    expect(next.clips[0].beats[1].cam).toMatch(/close-up/i);
    expect(next.clips[0].bodyEdits['2:held']).toBeUndefined();
  });

  it('applies a storyboard to beat 3 while Full is selected and leaves S1 alone', () => {
    const saved = upsertFramingReserve(createEmptyDirectorShow(), {
      name: 'S1 · CU',
      map: map('https://cdn/cu.png', { sourceFrameUrl: 'https://cdn/take.jpg' }),
      look: { grammar: { size: 'cu', bodies: 'one', clean: 'clean' }, cam: 'close-up of Peter' },
    });
    const show = {
      ...saved.show,
      scenes: [scene],
      clips: [clip('a', {
        seconds: 20,
        beats: [
          { n: 1, from: '0:00', to: '0:05', dur: 5, text: '@Peter sits.', grammar: { size: 'ws' }, cam: 'wide of the room' },
          { n: 2, from: '0:05', to: '0:10', dur: 5, text: '@Peter waits.', grammar: { size: 'cu' } },
          { n: 3, from: '0:10', to: '0:15', dur: 5, text: '@Peter looks.', grammar: { size: 'ws', bodies: 'two' }, cam: 'wide two-shot' },
          { n: 4, from: '0:15', to: '0:20', dur: 5, text: '@Door stays shut.', grammar: { size: 'ms' } },
        ],
        activeVariant: { kind: 'full' },
        bodyEdits: { '3:held': 'old wide prompt', full: 'keep the full take' },
      })],
    };
    const next = applyFramingToBeat(show, 'a', saved.framing.id, 3);
    const row = next.clips[0];
    expect(row.activeVariant).toEqual({ kind: 'full' });
    expect(row.beats[0].grammar?.size).toBe('ws');
    expect(row.beats[0].cam).toBe('wide of the room');
    expect(row.beats[0].text).toBe('@Peter sits.');
    expect(row.beats[2].grammar).toMatchObject({ size: 'cu', bodies: 'one', clean: 'clean' });
    expect(row.beats[2].cam).toMatch(/close-up/i);
    expect(row.beats[2].text).toBe('@Peter looks.');
    expect(row.bodyEdits['3:held']).toBeUndefined();
    expect(row.bodyEdits.full).toBeUndefined();
    expect(boundFramingId(row, { kind: 'isolated', beatN: 3, mode: 'held' })).toBe(saved.framing.id);
    expect(boundFramingId(row, { kind: 'isolated', beatN: 1, mode: 'held' })).not.toBe(saved.framing.id);
  });

  it('unselects a storyboard card and restores that beat’s coverage and body edit', () => {
    const saved = upsertFramingReserve(createEmptyDirectorShow(), {
      name: 'CU',
      map: map('https://cdn/cu.png'),
      look: { grammar: { size: 'cu', bodies: 'one', clean: 'clean' }, cam: 'close-up of Peter' },
    });
    const show = {
      ...saved.show,
      scenes: [scene],
      clips: [clip('a', {
        beats: [
          { n: 1, from: '0:00', to: '0:07', dur: 7, text: '@Peter sits.', grammar: { size: 'ws' }, cam: 'wide of the room' },
          { n: 2, from: '0:07', to: '0:14', dur: 7, text: '@Jordan stands.', grammar: { size: 'ms', bodies: 'two' }, cam: 'medium two-shot' },
        ],
        bodyEdits: { '2:held': 'old medium prompt', full: 'keep the full take' },
      })],
    };
    const applied = applyFramingToBeat(show, 'a', saved.framing.id, 2);
    expect(applied.clips[0].beats[1].grammar?.size).toBe('cu');
    expect(applied.clips[0].bodyEdits['2:held']).toBeUndefined();
    const reverted = revertFramingOnBeat(applied, 'a', 2);
    const row = reverted.clips[0];
    expect(row.beats[1].grammar).toMatchObject({ size: 'ms', bodies: 'two' });
    expect(row.beats[1].cam).toBe('medium two-shot');
    expect(row.beats[1].text).toBe('@Jordan stands.');
    expect(row.bodyEdits['2:held']).toBe('old medium prompt');
    expect(row.bodyEdits.full).toBe('keep the full take');
    expect(row.framingRestores).toBeUndefined();
    expect(beatFramingId(row, 2)).toBeUndefined();
    expect(boundFramingId(row, { kind: 'isolated', beatN: 2, mode: 'held' })).toBeUndefined();
  });

  it('keeps the original coverage when swapping cards, then restores it on unselect', () => {
    const wide = upsertFramingReserve(createEmptyDirectorShow(), {
      name: 'WS',
      map: map('https://cdn/ws.png'),
      look: { grammar: { size: 'ws' }, cam: 'wide of the room' },
    });
    const tight = upsertFramingReserve(wide.show, {
      name: 'CU',
      map: map('https://cdn/cu.png'),
      look: { grammar: { size: 'cu', bodies: 'one' }, cam: 'close-up of Peter' },
    });
    const show = {
      ...tight.show,
      scenes: [scene],
      clips: [clip('a', {
        beats: [
          { n: 1, from: '0:00', to: '0:14', dur: 14, text: '@Peter sits.', grammar: { size: 'ms' }, cam: 'medium of Peter' },
        ],
      })],
    };
    const afterWide = applyFramingToBeat(show, 'a', wide.framing.id, 1);
    const afterCu = applyFramingToBeat(afterWide, 'a', tight.framing.id, 1);
    expect(afterCu.clips[0].beats[0].grammar?.size).toBe('cu');
    const reverted = revertFramingOnBeat(afterCu, 'a', 1);
    expect(reverted.clips[0].beats[0].grammar?.size).toBe('ms');
    expect(reverted.clips[0].beats[0].cam).toBe('medium of Peter');
  });

  it('rewrites leftover two-shot / CU copy when a storyboard restages the beat', () => {
    const saved = upsertFramingReserve(createEmptyDirectorShow(), {
      name: 'WS',
      map: map('https://cdn/ws.png'),
      look: { grammar: { size: 'ws', bodies: 'one' }, cam: 'wide of Peter' },
    });
    const show = {
      ...saved.show,
      scenes: [scene],
      clips: [clip('a', {
        beats: [{
          n: 1, from: '0:00', to: '0:06', dur: 6,
          text: 'it settles into a two-shot, Peter left, Jordan right',
          cam: 'CU Two-shot on Dr-Jordan',
          grammar: { size: 'cu', bodies: 'two' },
          origin: {
            text: 'it settles into a two-shot, Peter left, Jordan right',
            dur: 6,
            cam: 'CU Two-shot on Dr-Jordan',
            grammar: { size: 'cu', bodies: 'two' },
          },
        }],
      })],
    };
    const next = applyFramingToBeat(show, 'a', saved.framing.id, 1).clips[0].beats[0];
    expect(next.grammar).toMatchObject({ size: 'ws', bodies: 'one' });
    expect(next.cam).toBe('wide of Peter');
    expect(next.text).toMatch(/wide/i);
    expect(next.text).not.toMatch(/two-shot/i);
    expect(next.cam).not.toMatch(/CU Two-shot/i);
  });

  it('does not treat the clip map as a selected storyboard overlay on every beat', () => {
    const saved = upsertFramingReserve(createEmptyDirectorShow(), {
      name: 'CU',
      map: map('https://cdn/cu.png'),
      look: { grammar: { size: 'cu' } },
    });
    const row = clip('a', {
      staging: { ...saved.framing.map, reserveId: saved.framing.id },
    });
    expect(boundFramingId(row, { kind: 'isolated', beatN: 1, mode: 'held' })).toBe(saved.framing.id);
    expect(beatFramingId(row, 1)).toBeUndefined();
    const applied = applyFramingToBeat({ ...saved.show, scenes: [scene], clips: [row] }, 'a', saved.framing.id, 1);
    expect(beatFramingId(applied.clips[0], 1)).toBe(saved.framing.id);
    expect(beatFramingId(revertFramingOnBeat(applied, 'a', 1).clips[0], 1)).toBeUndefined();
  });

  it('stamps every clip in the scene and drops per-shot binds', () => {
    const saved = upsertFramingReserve(createEmptyDirectorShow(), { name: 'master', map: map('https://cdn/master.png') });
    const show = {
      ...saved.show,
      scenes: [scene],
      clips: [
        clip('a', { stagingBinds: { 1: 'old' } }),
        clip('b'),
      ],
    };
    const stamped = applyFraming(show, 'a', saved.framing.id, 'scene');
    expect(stamped.clips[0].staging?.diagramUrl).toBe('https://cdn/master.png');
    expect(stamped.clips[1].staging?.diagramUrl).toBe('https://cdn/master.png');
    expect(stamped.clips[0].stagingBinds).toBeUndefined();
  });

  it('clears a shot bind and falls back to the clip default', () => {
    const wide = upsertFramingReserve(createEmptyDirectorShow(), { name: 'WS', map: map('https://cdn/ws.png') });
    const tight = upsertFramingReserve(wide.show, { name: 'CU', map: map('https://cdn/cu.png') });
    const show = {
      ...tight.show,
      scenes: [scene],
      clips: [clip('a', {
        staging: { ...wide.framing.map, reserveId: wide.framing.id },
        stagingBinds: { 1: tight.framing.id },
        activeVariant: { kind: 'isolated', beatN: 1, mode: 'held' },
      })],
    };
    const cleared = clearFramingBind(show, 'a', { kind: 'isolated', beatN: 1, mode: 'held' });
    expect(boundFramingId(cleared.clips[0], { kind: 'isolated', beatN: 1, mode: 'native' })).toBeUndefined();
    expect(cleared.clips[0].staging?.diagramUrl).toBeUndefined();
    expect(cleared.clips[0].staging?.reserveId).toBeUndefined();
  });

  it('empties Frame and Map stills when clearing this shot', () => {
    const saved = upsertFramingReserve(createEmptyDirectorShow(), { name: 'WS', map: map('https://cdn/ws.png') });
    const show = {
      ...saved.show,
      scenes: [scene],
      clips: [clip('a', {
        staging: {
          ...saved.framing.map,
          reserveId: saved.framing.id,
          sourceFrameUrl: 'https://cdn/take.jpg',
          sourceAssetId: 'asset-1',
          sourceBindKey: '1',
          sourceLook: { grammar: { size: 'ws' } },
        },
        stagingBinds: { full: saved.framing.id },
      })],
    };
    const cleared = clearFramingBind(show, 'a', { kind: 'full' });
    const row = cleared.clips[0];
    expect(row.staging?.sourceFrameUrl).toBeUndefined();
    expect(row.staging?.diagramUrl).toBeUndefined();
    expect(row.staging?.reserveId).toBeUndefined();
    expect(row.stagingBinds).toBeUndefined();
    expect(resolveClipStaging(cleared, row, { kind: 'full' })?.sourceFrameUrl).toBeUndefined();
    expect(resolveClipStaging(cleared, row, { kind: 'full' })?.diagramUrl).toBeUndefined();
    expect(cleared.framingReserve).toHaveLength(1);
  });

  it('adopts an existing clip map onto the storyboard and unsticks a hung generate', () => {
    const show = {
      ...createEmptyDirectorShow(),
      scenes: [scene],
      clips: [clip('a', {
        staging: { ...map('https://cdn/old.png'), status: 'generating' },
      })],
    };
    const adopted = adoptClipFramings(show);
    expect(adopted.framingReserve).toHaveLength(1);
    expect(adopted.clips[0].staging?.status).toBe('ready');
    expect(adopted.clips[0].staging?.reserveId).toBe(adopted.framingReserve?.[0].id);
    expect(adoptClipFramings(adopted)).toBe(adopted);
  });
});

describe('bindStagingDiagram storyboard', () => {
  it('adds a card and binds the active shot when a map finishes', () => {
    const show = bindStagingDiagram({
      show: { ...createEmptyDirectorShow(), scenes: [scene], clips: [clip('a'), clip('b')] },
      clipId: 'a',
      diagramUrl: 'https://cdn/map.png',
      elementId: 'el-map',
      scope: 'clip',
      framingName: '1A · S1',
    });
    expect(show.framingReserve).toHaveLength(1);
    expect(show.framingReserve?.[0].name).toBe('1A · S1');
    expect(show.clips[0].staging?.reserveId).toBe(show.framingReserve?.[0].id);
    expect(show.clips[0].stagingBinds?.full).toBe(show.framingReserve?.[0].id);
    expect(show.clips[1].staging?.diagramUrl).toBeUndefined();
  });
});
