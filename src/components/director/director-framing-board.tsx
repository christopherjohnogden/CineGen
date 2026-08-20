import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react';
import type { DirectorFraming, DirectorShow } from '@/types/director';
import { toFileUrl } from '@/lib/utils/file-url';
import { framingThumb, uniqueFramingPickerLabels } from '@/lib/director/framing-reserve';

interface DirectorFramingBoardProps {
  framings: DirectorFraming[];
  boundId?: string;
  query: string;
  onQuery: (value: string) => void;
  onPick: (id: string) => void;
  searchRef?: RefObject<HTMLInputElement | null>;
  heading?: string;
}

export function DirectorFramingBoard({
  framings,
  boundId,
  query,
  onQuery,
  onPick,
  searchRef,
  heading = 'Saved framings',
}: DirectorFramingBoardProps) {
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? framings.filter((entry) => entry.name.toLowerCase().includes(needle))
    : framings;
  const [hi, setHi] = useState(0);
  useEffect(() => { setHi(0); }, [query, visible.length]);
  const active = visible[Math.min(hi, Math.max(visible.length - 1, 0))];

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      setHi((n) => Math.min(n + 1, Math.max(visible.length - 1, 0)));
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      setHi((n) => Math.max(n - 1, 0));
    } else if (event.key === 'Enter' && active) {
      event.preventDefault();
      onPick(active.id);
    }
  };

  return (
    <div className="dframe-board">
      <label className="dsl-scenefield">
        <span className="dsl-scenefield-label">{heading}</span>
        {framings.length > 0 && (
          <input
            ref={searchRef}
            value={query}
            placeholder="/ to search · click a card to match this shot"
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={onSearchKey}
          />
        )}
      </label>
      <div className="dframe-strip" role="listbox" aria-label="Saved framings">
        {visible.map((entry) => {
          const thumb = toFileUrl(framingThumb(entry.map));
          return (
            <button
              key={entry.id}
              type="button"
              role="option"
              aria-selected={entry.id === boundId}
              className={`dframe-card${entry.id === boundId ? ' dframe-card--on' : ''}${entry.id === active?.id ? ' dframe-card--hi' : ''}`}
              title={entry.name}
              onClick={() => onPick(entry.id)}
            >
              {thumb
                ? <img src={thumb} alt="" />
                : <span className="dframe-card-empty">No still</span>}
              <span className="dframe-card-name">{entry.name}</span>
            </button>
          );
        })}
        {framings.length === 0 && (
          <div className="dframe-card dframe-card--empty">
            <span className="dframe-card-empty">Liked maps land here</span>
            <span className="dframe-card-name">Make a map, then click a card on another shot</span>
          </div>
        )}
        {framings.length > 0 && visible.length === 0 && (
          <span className="director-tab__meta">No framing matches “{query.trim()}”.</span>
        )}
      </div>
    </div>
  );
}

/** Compact picker on a Shots row — apply a saved framing to this beat only. */
export function DirectorShotFramingPick({
  show,
  framings,
  boundId,
  onPick,
  onClear,
}: {
  show: DirectorShow;
  framings: DirectorFraming[];
  boundId?: string;
  onPick: (id: string) => void;
  onClear?: () => void;
}) {
  if (framings.length === 0) return null;
  const labels = uniqueFramingPickerLabels(show, framings);
  return (
    <div className="dcov-story">
      <span className="dsl-scenefield-label">Storyboard</span>
      <div className="dcov-story-grid" role="listbox" aria-label="Storyboard">
        {framings.map((entry) => {
          const thumb = toFileUrl(framingThumb(entry.map));
          const label = labels.get(entry.id) ?? 'Framing';
          const on = entry.id === boundId;
          return (
            <button
              key={entry.id}
              type="button"
              role="option"
              aria-selected={on}
              className={`dframe-card${on ? ' dframe-card--on' : ''}`}
              title={label}
              onClick={() => (on ? onClear?.() : onPick(entry.id))}
            >
              {thumb
                ? <img src={thumb} alt="" />
                : <span className="dframe-card-empty">No still</span>}
              <span className="dframe-card-name">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
