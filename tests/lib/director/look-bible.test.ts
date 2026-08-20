import { describe, expect, it } from 'vitest';
import { createEmptyDirectorShow } from '@/lib/director/create-show';
import { addFilmRef, applyWrittenLook, compileLookBible, extractScriptText, lookBibleImageUrls, lookNotesAreStale, setLookNotes, syncLookNotes } from '@/lib/director/look-bible';
import { directorFromUnknown } from '@/lib/director/snapshot';
import { seedance25Adapter } from '@/lib/director/video-adapter';
import type { DirectorClip } from '@/types/director';

const clip: DirectorClip = {
  id: '2-1a',
  title: 'Wake',
  seconds: 10,
  sceneId: 's1',
  beats: [{ n: 1, from: '0:00', to: '0:10', dur: 10, text: 'WIDE locked.' }],
  subject: 'he wakes',
  location: 'room',
  style: '',
  constraints: '',
  elementTags: [],
  activeVariant: { kind: 'full' },
  bodyEdits: {},
  takes: [],
};

describe('director script extract', () => {
  it('keeps fountain/markdown text and strips Final Draft XML', () => {
    expect(extractScriptText('scene.md', '# INT. KITCHEN')).toBe('# INT. KITCHEN');
    expect(extractScriptText('show.fdx', '<Text>INT. KITCHEN - NIGHT</Text><Text>JORDAN waits.</Text>'))
      .toContain('INT. KITCHEN - NIGHT');
  });

  it('rejects PDF until a text export is provided', () => {
    expect(() => extractScriptText('script.pdf', '%PDF-1.4')).toThrow(/PDF is not supported/);
  });
});

describe('director look bible', () => {
  it('fills look notes from genre, films, and stills', () => {
    const show = syncLookNotes({
      ...createEmptyDirectorShow(),
      genre: 'noir',
      lookBible: {
        filmRefs: addFilmRef([], 'No Country for Old Men'),
        moodBoards: [{ id: '1', name: 'kitchen-dusk.jpg', url: 'https://example.test/still.jpg' }],
        notes: '',
      },
    });
    expect(show.lookBible.notes).toContain('Genre: noir');
    expect(show.lookBible.notes).toContain('No Country for Old Men');
    expect(show.lookBible.notes).toContain('kitchen-dusk');
    expect(compileLookBible(show)).toBe(show.lookBible.notes);
    expect(lookBibleImageUrls(show)).toEqual(['https://example.test/still.jpg']);

    const request = seedance25Adapter.buildRequest({ show, clip, variant: { kind: 'full' } });
    expect(request.params.genre).toBe('noir');
    expect(request.prompt).toContain('Film references: No Country for Old Men');
  });

  it('keeps edited look notes until force update', () => {
    const filled = syncLookNotes({
      ...createEmptyDirectorShow(),
      genre: 'noir',
      lookBible: { filmRefs: ['Sicario'], moodBoards: [], notes: '' },
    });
    const edited = setLookNotes(filled, `${filled.lookBible.notes}\n\nNo score. Practicals only.`);
    const afterFilm = syncLookNotes({
      ...edited,
      lookBible: { ...edited.lookBible, filmRefs: ['Sicario', 'No Country for Old Men'] },
    });
    expect(afterFilm.lookBible.notes).toContain('No score. Practicals only.');
    expect(afterFilm.lookBible.notes).not.toContain('No Country for Old Men');
    expect(lookNotesAreStale(afterFilm)).toBe(true);

    const updated = syncLookNotes(afterFilm, { force: true });
    expect(updated.lookBible.notes).toContain('No Country for Old Men');
    expect(updated.lookBible.notes).not.toContain('No score. Practicals only.');
  });

  it('keeps an LLM look until the user asks to rebuild from refs', () => {
    const filled = syncLookNotes({
      ...createEmptyDirectorShow(),
      genre: 'noir',
      lookBible: { filmRefs: ['Sicario'], moodBoards: [], notes: '' },
    });
    const written = applyWrittenLook(filled, '24fps. Sodium practicals. Diegetic only.');
    const afterFilm = syncLookNotes({
      ...written,
      lookBible: { ...written.lookBible, filmRefs: ['Sicario', 'Heat'] },
    });
    expect(afterFilm.lookBible.notes).toBe('24fps. Sodium practicals. Diegetic only.');
    expect(lookNotesAreStale(afterFilm)).toBe(true);
  });

  it('fills look bible defaults on old snapshots', () => {
    const loaded = directorFromUnknown({
      sourceText: 'x',
      clipLengthSec: 20,
      breakdown: [],
      scenes: [],
      clips: [],
    });
    expect(loaded.lookBible.filmRefs).toEqual([]);
    expect(loaded.lookBible.moodBoards).toEqual([]);
    expect(loaded.genre).toBe('auto');
  });

  it('caps mood-board stills sent to the look-bible LLM', () => {
    const urls = Array.from({ length: 8 }, (_, i) => `local-media://file/tmp/${i}.jpg`);
    expect(lookBibleImageUrls({
      lookBible: {
        filmRefs: [],
        notes: '',
        moodBoards: urls.map((url, i) => ({ id: String(i), name: `${i}.jpg`, url })),
      },
    })).toEqual(urls.slice(0, 6));
  });
});
