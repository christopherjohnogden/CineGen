import type { Beat, BeatSheet } from '@/lib/director/beatsheet';
import { renumberBeats } from '@/lib/director/beatsheet';
import type { BeatEdit } from '@/lib/director/script-assistant';
import { generateId } from '@/lib/utils/ids';

interface BeatsheetEditorProps {
  beatSheet: BeatSheet;
  selectedBeatId?: string;
  pendingBeatEdits?: BeatEdit[];
  onChange: (bs: BeatSheet) => void;
  onSelect: (beatId: string) => void;
  onAcceptEdits: () => void;
  onDeclineEdits: () => void;
}

export function BeatsheetEditor({ beatSheet, selectedBeatId, pendingBeatEdits, onChange, onSelect, onAcceptEdits, onDeclineEdits }: BeatsheetEditorProps) {
  const beats = beatSheet.beats;
  const patch = (next: Beat[]) => onChange({ beats: renumberBeats(next) });
  const setField = (id: string, field: 'action' | 'location' | 'shot' | 'mood', value: string) =>
    patch(beats.map((b) => (b.id === id ? { ...b, [field]: value } : b)));
  const addBeat = () => {
    const b: Beat = { id: generateId(), n: beats.length + 1, action: '', location: '', shot: '' };
    patch([...beats, b]);
    onSelect(b.id);
  };
  const removeBeat = (id: string) => patch(beats.filter((b) => b.id !== id));
  const move = (id: string, dir: -1 | 1) => {
    const i = beats.findIndex((b) => b.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= beats.length) return;
    const next = [...beats];
    [next[i], next[j]] = [next[j], next[i]];
    patch(next);
  };

  const hasPending = !!pendingBeatEdits && pendingBeatEdits.length > 0;
  const beatIds = new Set(beats.map((b) => b.id));
  const delTargets = new Set((pendingBeatEdits ?? []).filter((e) => e.op === 'replace' || e.op === 'delete').map((e) => e.targetBeatId).filter(Boolean) as string[]);
  const addsFor = (id: string) => (pendingBeatEdits ?? []).find((e) => e.targetBeatId === id && (e.op === 'replace' || e.op === 'insert-after'))?.beats ?? [];
  // Added beats with no existing anchor (no target, or a target that isn't a current beat —
  // e.g. drafting into an empty sheet) render at the top; otherwise they'd be invisible.
  const unanchoredAdds = (pendingBeatEdits ?? [])
    .filter((e) => e.op === 'insert-after' && (!e.targetBeatId || !beatIds.has(e.targetBeatId)))
    .flatMap((e) => e.beats ?? []);

  // A proposed added beat, rendered as a full (read-only) beat card so it matches the real ones.
  const renderAddCard = (n: Beat) => (
    <div key={n.id} className="dbs-card dbs-card--diffadd">
      <div className="dbs-head">
        <span className="dbs-num">+ NEW BEAT</span>
        <input value={n.location} placeholder="INT./EXT. Location" readOnly tabIndex={-1} />
      </div>
      <div className="dbs-fields">
        <div className="full">
          <label className="dbs-flabel">Action — what happens</label>
          <textarea value={n.action} readOnly tabIndex={-1} />
        </div>
        <div>
          <label className="dbs-flabel">Shot / camera</label>
          <input value={n.shot} readOnly tabIndex={-1} />
        </div>
        <div>
          <label className="dbs-flabel">Mood</label>
          <input value={n.mood ?? ''} readOnly tabIndex={-1} />
        </div>
      </div>
    </div>
  );

  const changeCount = pendingBeatEdits?.length ?? 0;
  const diffBar = (sticky: boolean) => (
    <div className={sticky ? 'dxf-stickybar' : 'dbs-diffbar'}>
      <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={onAcceptEdits}>✓ Accept</button>
      <button type="button" className="director-tab__btn" onClick={onDeclineEdits}>✕ Decline</button>
      <span className={sticky ? 'lbl' : 'director-tab__meta'}>assistant edit · {changeCount} change{changeCount === 1 ? '' : 's'}</span>
    </div>
  );

  return (
    <div className="dbs-wrap">
      <div className="dbs-list">
        {hasPending && diffBar(true)}
        {beats.length === 0 && !hasPending && <p className="director-tab__empty">No beats yet — add one, or ask the assistant to draft the beat sheet.</p>}
        {unanchoredAdds.map(renderAddCard)}
        {hasPending && unanchoredAdds.length > 0 && diffBar(false)}
        {beats.map((b) => (
          <div key={b.id}>
            <div className={`dbs-card${delTargets.has(b.id) ? ' dbs-card--diffdel' : ''}${b.id === selectedBeatId ? ' director-tab__item--active' : ''}`} onFocusCapture={() => onSelect(b.id)}>
              <div className="dbs-head">
                <span className="dbs-num">BEAT {b.n}</span>
                <input value={b.location} placeholder="INT./EXT. Location" onChange={(e) => setField(b.id, 'location', e.target.value)} disabled={hasPending} />
                <button type="button" className="director-tab__btn" onClick={() => move(b.id, -1)} disabled={hasPending} title="Move up">↑</button>
                <button type="button" className="director-tab__btn" onClick={() => move(b.id, 1)} disabled={hasPending} title="Move down">↓</button>
                <button type="button" className="director-tab__btn" onClick={() => removeBeat(b.id)} disabled={hasPending} title="Remove">✕</button>
              </div>
              <div className="dbs-fields">
                <div className="full">
                  <label className="dbs-flabel">Action — what happens</label>
                  <textarea value={b.action} onChange={(e) => setField(b.id, 'action', e.target.value)} disabled={hasPending} />
                </div>
                <div>
                  <label className="dbs-flabel">Shot / camera</label>
                  <input value={b.shot} onChange={(e) => setField(b.id, 'shot', e.target.value)} disabled={hasPending} />
                </div>
                <div>
                  <label className="dbs-flabel">Mood</label>
                  <input value={b.mood ?? ''} onChange={(e) => setField(b.id, 'mood', e.target.value)} disabled={hasPending} />
                </div>
              </div>
            </div>
            {addsFor(b.id).map(renderAddCard)}
          </div>
        ))}
        {hasPending && (
          <div className="dbs-diffbar">
            <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={onAcceptEdits}>✓ Accept</button>
            <button type="button" className="director-tab__btn" onClick={onDeclineEdits}>✕ Decline</button>
            <span className="director-tab__meta">assistant edit · {pendingBeatEdits!.length} change{pendingBeatEdits!.length === 1 ? '' : 's'}</span>
          </div>
        )}
      </div>
      {!hasPending && (
        <div className="dbs-add">
          <button type="button" className="director-tab__btn" onClick={addBeat}>+ Add beat</button>
        </div>
      )}
    </div>
  );
}
