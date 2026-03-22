import type { Track } from '@/types/timeline';

interface TrackHeaderProps {
  track: Track;
  onUpdate: (updates: Partial<Pick<Track, 'muted' | 'solo' | 'locked' | 'visible' | 'volume'>>) => void;
  onRemove: () => void;
}

/* SVG icon helper — matches lucide-style icons */
const Ico = ({ children }: { children: React.ReactNode }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export function TrackHeader({ track, onUpdate, onRemove }: TrackHeaderProps) {
  void onRemove;

  return (
    <div
      className={`track-header track-header--${track.kind}`}
      onContextMenu={(e) => { e.preventDefault(); }}
    >
      <span className="track-header__color" style={{ backgroundColor: track.color }} />
      <span className="track-header__name">{track.name}</span>
      <div className="track-header__controls">
        {track.kind === 'video' ? (
          <>
            <button
              className={`track-header__btn ${!track.visible ? 'track-header__btn--active' : ''}`}
              onClick={() => onUpdate({ visible: !track.visible })}
              title={track.visible ? 'Hide' : 'Show'}
            >
              <Ico>
                {track.visible ? (
                  <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>
                ) : (
                  <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></>
                )}
              </Ico>
            </button>
            <button
              className={`track-header__btn ${track.locked ? 'track-header__btn--active' : ''}`}
              onClick={() => onUpdate({ locked: !track.locked })}
              title={track.locked ? 'Unlock' : 'Lock'}
            >
              <Ico>
                {track.locked ? (
                  <><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></>
                ) : (
                  <><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 019.9-1" /></>
                )}
              </Ico>
            </button>
          </>
        ) : (
          <>
            <button
              className={`track-header__btn track-header__btn--mute ${track.muted ? 'track-header__btn--active' : ''}`}
              onClick={() => onUpdate({ muted: !track.muted })}
              title={track.muted ? 'Unmute' : 'Mute'}
            >
              <Ico>
                {track.muted ? (
                  <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>
                ) : (
                  <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 010 7.07" /></>
                )}
              </Ico>
            </button>
            <button
              className={`track-header__btn track-header__btn--solo ${track.solo ? 'track-header__btn--active' : ''}`}
              onClick={() => onUpdate({ solo: !track.solo })}
              title={track.solo ? 'Unsolo' : 'Solo'}
            >
              S
            </button>
            <button
              className="track-header__btn"
              title={`Volume: ${Math.round(track.volume * 100)}%`}
            >
              <Ico>
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                {track.volume > 0 && <path d="M15.54 8.46a5 5 0 010 7.07" />}
                {track.volume > 0.5 && <path d="M19.07 4.93a10 10 0 010 14.14" />}
              </Ico>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
