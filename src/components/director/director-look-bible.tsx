import { useRef, useState } from 'react';
import type { DirectorLookBible, DirectorShow } from '@/types/director';
import { DIRECTOR_GENRES } from '@/types/director';
import {
  addFilmRef,
  emptyLookBible,
  lookNotesAreStale,
  setLookNotes,
  syncLookNotes,
} from '@/lib/director/look-bible';
import { resolveMediaFileUrl } from '@/lib/utils/media-file';
import { generateId } from '@/lib/utils/ids';

interface DirectorLookBibleProps {
  show: DirectorShow;
  writing: boolean;
  error?: string;
  onChange: (show: DirectorShow) => void;
  onWrite: () => void;
  onCancel: () => void;
}

export function DirectorLookBiblePanel({ show, writing, error, onChange, onWrite, onCancel }: DirectorLookBibleProps) {
  const bible = show.lookBible ?? emptyLookBible();
  const [filmDraft, setFilmDraft] = useState('');
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const stale = lookNotesAreStale(show);

  const commitRefs = (patch: Partial<DirectorLookBible>, genre = show.genre) => {
    onChange(syncLookNotes({
      ...show,
      genre,
      lookBible: { ...bible, ...patch },
    }));
  };

  const commitFilm = () => {
    const next = addFilmRef(bible.filmRefs, filmDraft);
    if (next === bible.filmRefs) return;
    setFilmDraft('');
    commitRefs({ filmRefs: next });
  };

  const addStills = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const images = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) return;
    setUploading(true);
    const uploaded = [...bible.moodBoards];
    for (const file of images) {
      try {
        const url = await resolveMediaFileUrl(file);
        uploaded.push({ id: generateId(), name: file.name, url });
      } catch {
        const url = await readDataUrl(file);
        uploaded.push({ id: generateId(), name: file.name, url });
      }
    }
    commitRefs({ moodBoards: uploaded });
    setUploading(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="director-tab__fields">
      <div>
        <label className="director-tab__label" htmlFor="director-genre">Genre</label>
        <select
          id="director-genre"
          value={show.genre}
          onChange={(event) => commitRefs({}, event.target.value)}
        >
          {DIRECTOR_GENRES.map((genre) => (
            <option key={genre.id} value={genre.id}>{genre.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="director-tab__label" htmlFor="director-film">Film references</label>
        <div className="director-tab__row">
          <input
            id="director-film"
            value={filmDraft}
            placeholder="Type a movie and press Enter"
            onChange={(event) => setFilmDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitFilm();
              }
            }}
          />
          <button type="button" className="director-tab__btn" onClick={commitFilm}>Add</button>
        </div>
        {bible.filmRefs.length > 0 && (
          <div className="director-tab__chips">
            {bible.filmRefs.map((film) => (
              <button
                key={film}
                type="button"
                className="director-tab__chip"
                onClick={() => commitRefs({ filmRefs: bible.filmRefs.filter((entry) => entry !== film) })}
                title="Remove"
              >
                {film} ×
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <span className="director-tab__label">Mood board</span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="director-tab__file-input"
          onChange={(event) => void addStills(event.target.files)}
        />
        <button type="button" className="director-tab__btn" onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? 'Uploading…' : 'Upload stills'}
        </button>
        {bible.moodBoards.length > 0 && (
          <div className="director-tab__boards">
            {bible.moodBoards.map((still) => (
              <button
                key={still.id}
                type="button"
                className="director-tab__board"
                title={`Remove ${still.name}`}
                onClick={() => commitRefs({ moodBoards: bible.moodBoards.filter((entry) => entry.id !== still.id) })}
              >
                <img src={still.url} alt={still.name} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="director-tab__label" htmlFor="director-bible-notes">Look notes</label>
        <textarea
          id="director-bible-notes"
          className="director-tab__prompt"
          value={bible.notes}
          onChange={(event) => onChange(setLookNotes(show, event.target.value))}
          placeholder="Pick a genre, add films, or drop stills — this updates. Then edit anything you want."
        />
      </div>

      <div className="director-tab__row">
        {stale && (
          <button
            type="button"
            className="director-tab__btn"
            onClick={() => onChange(syncLookNotes(show, { force: true }))}
          >
            Update from refs
          </button>
        )}
        {writing ? (
          <button type="button" className="director-tab__btn" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={onWrite}>
            Rewrite with LLM
          </button>
        )}
      </div>
      {error && <p className="director-tab__warn">{error}</p>}
      <p className="director-tab__meta">
        {writing
          ? 'Waiting on the CLI…'
          : stale
            ? 'You edited this look. Genre, films, or stills changed — Update from refs to rebuild, or keep your text.'
            : 'This is the look bible. Every clip prefix uses it. Rewrite with LLM expands it; you can still edit after.'}
      </p>
    </div>
  );
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image.'));
    reader.readAsDataURL(file);
  });
}
