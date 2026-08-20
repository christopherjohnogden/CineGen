import { useRef, useState } from 'react';
import type { DirectorLookBible, DirectorShow } from '@/types/director';
import { DIRECTOR_GENRES } from '@/types/director';
import {
  addFilmRef,
  emptyLookBible,
  lookNotesAreStale,
  MAX_LOOK_BIBLE_STILLS,
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
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const stale = lookNotesAreStale(show);
  const remaining = Math.max(0, MAX_LOOK_BIBLE_STILLS - bible.moodBoards.length);

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
    if (!files || files.length === 0 || remaining === 0) return;
    const images = Array.from(files)
      .filter((file) => file.type.startsWith('image/'))
      .slice(0, remaining);
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
    <div className="dbible">
      <div className="dbible-refs">
        <div className="dbible-field">
          <span className="director-tab__label">Genre</span>
          <div className="dgen-seg" role="group" aria-label="Genre">
            {DIRECTOR_GENRES.map((genre) => (
              <button
                key={genre.id}
                type="button"
                className={`dgen-seg-btn${show.genre === genre.id ? ' dgen-seg-btn--on' : ''}`}
                aria-pressed={show.genre === genre.id}
                onClick={() => commitRefs({}, genre.id)}
              >
                {genre.label}
              </button>
            ))}
          </div>
        </div>

        <div className="dbible-field">
          <label className="director-tab__label" htmlFor="director-film">Film references</label>
          <div className="dbible-composer">
            <input
              id="director-film"
              value={filmDraft}
              placeholder="Type a title and press Enter"
              onChange={(event) => setFilmDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitFilm();
                }
              }}
            />
            <button type="button" className="dbible-composer-add" onClick={commitFilm} disabled={!filmDraft.trim()}>
              Add
            </button>
          </div>
          {bible.filmRefs.length > 0 && (
            <div className="director-tab__chips">
              {bible.filmRefs.map((film) => (
                <button
                  key={film}
                  type="button"
                  className="director-tab__chip"
                  onClick={() => commitRefs({ filmRefs: bible.filmRefs.filter((entry) => entry !== film) })}
                  title={`Remove ${film}`}
                >
                  {film}
                  <span className="dbible-chip-x" aria-hidden>×</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="dbible-field">
          <span className="director-tab__label">Mood board · {bible.moodBoards.length}/{MAX_LOOK_BIBLE_STILLS}</span>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="director-tab__file-input"
            onChange={(event) => void addStills(event.target.files)}
          />
          <div
            className={`dbible-drop${dragOver ? ' dbible-drop--hot' : ''}`}
            onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              void addStills(event.dataTransfer.files);
            }}
          >
            {bible.moodBoards.length > 0 ? (
              <div className="director-tab__boards dbible-boards">
                {bible.moodBoards.map((still) => (
                  <button
                    key={still.id}
                    type="button"
                    className="director-tab__board dbible-board"
                    title={`Remove ${still.name}`}
                    onClick={() => commitRefs({ moodBoards: bible.moodBoards.filter((entry) => entry.id !== still.id) })}
                  >
                    <img src={still.url} alt={still.name} />
                  </button>
                ))}
                {remaining > 0 && (
                  <button
                    type="button"
                    className="dbible-addtile"
                    onClick={() => inputRef.current?.click()}
                    disabled={uploading}
                  >
                    <span className="dbible-addtile-mark" aria-hidden>+</span>
                    {uploading ? 'Uploading' : 'Add'}
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                className="dbible-empty"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
              >
                <span className="dbible-empty-title">{uploading ? 'Uploading…' : 'Drop stills or click to upload'}</span>
                <span className="dbible-empty-sub">Up to {MAX_LOOK_BIBLE_STILLS} frames. Palette, lighting, and texture only.</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="dbible-doc">
        <div className="dbible-doc-head">
          <div className="dbible-doc-copy">
            <label className="director-tab__label" htmlFor="director-bible-notes">Look notes</label>
            {stale && <span className="dbible-stale">Edited</span>}
          </div>
          <div className="dbible-doc-actions">
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
        </div>
        <textarea
          id="director-bible-notes"
          className="dbible-notes"
          value={bible.notes}
          onChange={(event) => onChange(setLookNotes(show, event.target.value))}
          placeholder="Pick a genre, add films, or drop stills — this updates. Then edit anything you want."
        />
        {error && <p className="director-tab__warn">{error}</p>}
        <p className="dbible-meta">
          {writing
            ? 'Waiting on the CLI…'
            : stale
              ? 'You edited this look. Genre, films, or stills changed — Update from refs to rebuild, or keep your text.'
              : 'Every clip prefix uses these notes. Rewrite with LLM expands them from genre, films, and stills.'}
        </p>
      </div>
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
