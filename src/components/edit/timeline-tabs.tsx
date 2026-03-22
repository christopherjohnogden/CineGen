import { useState, useRef, useEffect } from 'react';
import type { Timeline, TrackKind } from '@/types/timeline';

interface TimelineTabsProps {
  timelines: Timeline[];
  activeTimelineId: string;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onAddTrack: (kind: TrackKind | TrackKind[]) => void;
  snapEnabled: boolean;
  onSnapToggle: () => void;
  onAddMarker?: () => void;
}

const MagnetIcon = () => (
  <svg width="14" height="14" viewBox="0 0 64 64" fill="currentColor">
    <path d="m60.33 34.89-7.21-7.22a1.52 1.52 0 0 0 -2.13 0l-16.86 16.87a10.37 10.37 0 0 1 -14.67-14.67l16.87-16.87a1.52 1.52 0 0 0 0-2.13l-7.22-7.2a1.49 1.49 0 0 0 -2.12 0l-16.87 16.86a23.58 23.58 0 0 0 33.35 33.35l16.86-16.88a1.5 1.5 0 0 0 0-2.12zm-32.28-28 5.09 5.11-4.77 4.77-5.09-5.1zm24.33 33.83-5.1-5.09 4.77-4.77 5.1 5.14z" />
  </svg>
);

export function TimelineTabs({
  timelines,
  activeTimelineId,
  onSwitch,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
  onAddTrack,
  snapEnabled,
  onSnapToggle,
  onAddMarker,
}: TimelineTabsProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) inputRef.current.focus();
  }, [editingId]);

  const startRename = (id: string, currentName: string) => {
    setEditingId(id);
    setEditValue(currentName);
    setContextMenu(null);
  };

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setContextMenu({ id, x: e.clientX, y: e.clientY });
  };

  return (
    <div className="timeline-tabs">
      <div className="timeline-tabs__list">
        {timelines.map((tl) => (
          <button
            key={tl.id}
            className={`timeline-tabs__tab ${tl.id === activeTimelineId ? 'timeline-tabs__tab--active' : ''}`}
            onClick={() => onSwitch(tl.id)}
            onContextMenu={(e) => handleContextMenu(e, tl.id)}
            onDoubleClick={() => startRename(tl.id, tl.name)}
          >
            {editingId === tl.id ? (
              <input
                ref={inputRef}
                className="timeline-tabs__input"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setEditingId(null);
                }}
              />
            ) : (
              tl.name
            )}
            {timelines.length > 1 && editingId !== tl.id && (
              <span
                className="timeline-tabs__close"
                onClick={(e) => { e.stopPropagation(); onDelete(tl.id); }}
                title="Close timeline"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </span>
            )}
          </button>
        ))}
        <button className="timeline-tabs__add" onClick={onCreate} title="New Timeline">
          +
        </button>
      </div>
      <div className="timeline-tabs__track-btns">
        <button
          className={`timeline-tabs__snap ${snapEnabled ? 'timeline-tabs__snap--active' : ''}`}
          onClick={onSnapToggle}
          title={`Snap ${snapEnabled ? 'ON' : 'OFF'} (S)`}
        >
          <MagnetIcon />
          <span>Snap</span>
        </button>
        {onAddMarker && (
          <button
            className="timeline-tabs__snap"
            onClick={onAddMarker}
            title="Add Marker (M)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
              <line x1="4" y1="22" x2="4" y2="15" />
            </svg>
            <span>Marker</span>
          </button>
        )}
      </div>

      {contextMenu && (
        <>
          <div className="timeline-tabs__backdrop" onClick={() => setContextMenu(null)} />
          <div className="timeline-tabs__ctx" style={{ left: contextMenu.x, top: contextMenu.y }}>
            <button onClick={() => startRename(contextMenu.id, timelines.find(t => t.id === contextMenu.id)?.name ?? '')}>
              Rename
            </button>
            <button onClick={() => { onDuplicate(contextMenu.id); setContextMenu(null); }}>
              Duplicate
            </button>
            {timelines.length > 1 && (
              <button onClick={() => { onDelete(contextMenu.id); setContextMenu(null); }}>
                Delete
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
