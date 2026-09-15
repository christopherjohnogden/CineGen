import { useEffect, useRef } from 'react';
import { passesWithinBudget, type SetSendOptions, type ShapeShotTarget } from '@/lib/sets/shape-shot';

type Destination = 'studio' | 'canvas';
export function SetSendDialog({ target, options, onOptions, destination, onDestination, busy, error, onClose, onSend }: {
  target?: ShapeShotTarget | null;
  options: SetSendOptions;
  onOptions(options: SetSendOptions): void;
  destination: Destination;
  onDestination(destination: Destination): void;
  busy: boolean;
  error: string;
  onClose(): void;
  onSend(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const unavailable = !target ? 'Choose a model in Studio first.' : target.unavailable
    || (options.mode === 'passes' && target.maxReferences < 2 ? 'Scene references need two free slots. Use Current view for a single image.' : '')
    || (destination === 'canvas' && !target.sendToCanvas ? 'Open a Space to send to its canvas.' : '');
  const patch = (value: Partial<SetSendOptions>) => onOptions({ ...options, ...value });
  return <dialog ref={dialog} className="set-send" aria-labelledby="set-send-title" onCancel={event => {
    event.preventDefault(); if (!busy) onClose();
  }}>
    <header className="set-send__header"><div><h2 id="set-send-title">Send this angle</h2>
      <p>Turn your framed view into a new image.</p></div>
      <button type="button" className="sets-view__back" disabled={busy} onClick={onClose} aria-label="Close send options">×</button></header>
    <fieldset disabled={busy} className="set-send__body">
      <label className="set-send__field">Destination<select value={destination} onChange={event => onDestination(event.target.value as Destination)}>
        <option value="studio">Studio — use as the only image reference</option><option value="canvas">Spaces canvas — create a connected generation</option>
      </select></label>
      <div className="set-send__choices" role="group" aria-label="What to send">
        <button type="button" aria-pressed={options.mode === 'view'} onClick={() => patch({ mode: 'view' })}>
          <strong>Current view</strong><span>Only this screenshot</span></button>
        <button type="button" aria-pressed={options.mode === 'passes'} onClick={() => patch({ mode: 'passes' })}>
          <strong>Scene references</strong><span>Background, composition, depth & stand-ins</span></button>
      </div>
      {options.mode === 'view' && <label className="set-send__check"><input type="checkbox" checked={options.includeStandIns}
        onChange={event => patch({ includeStandIns: event.target.checked })} />Include visible stand-ins as placement guides</label>}
      <label className="set-send__check"><input type="checkbox" checked={options.enhance}
        onChange={event => patch({ enhance: event.target.checked })} />Add a prompt to improve image quality</label>
      <p className="set-send__hint">Preserves the camera angle and layout while cleaning up scan artifacts and surface detail.</p>
      {target?.models && <label className="set-send__field">Model<select value={target.modelId ?? ''} onChange={event => target.selectModel?.(event.target.value)}>
        {!target.models.some(model => model.key === target.modelId) && <option value={target.modelId ?? ''}>Choose a reference-capable model</option>}
        {target.models.map(model => <option key={model.key} value={model.key}>{model.label}</option>)}
      </select></label>}
      <div className="set-send__output">{target?.outputControls?.map(control => <label className="set-send__field" key={control.id}>{control.label}
        <select value={control.value} onChange={event => target.setOutputControl?.(control.id, event.target.value)}>
          {control.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>)}</div>
      <label className="set-send__field">Additional direction (optional)<textarea rows={3} value={options.instructions}
        placeholder="e.g. Natural daylight, crisp architectural detail, preserve the room’s materials…"
        onChange={event => patch({ instructions: event.target.value })} /></label>
      <div className="set-send__summary">{target?.label}<br />{target?.width} × {target?.height} · {options.mode === 'view' ? `1 PNG${options.enhance || options.instructions.trim() ? ' + requested prompt text' : ' only · No prompt'}` : `${passesWithinBudget(target?.maxReferences ?? 4).length} PNG references`}</div>
      {options.mode === 'passes' && target && target.maxReferences >= 2 && target.maxReferences < 4 && <p className="set-send__hint">
        {target.maxReferences === 3 ? 'Depth is omitted to fit this model’s available slots.' : 'Depth and isolated stand-ins are omitted to fit this model’s available slots.'}</p>}
      <p className="set-send__hint">{options.mode === 'view' ? 'Sends only this image. Previous reference images and scene-pass instructions are excluded. Prompt text is added only if you enable it or write it above.' : 'Scene references are added alongside your Studio draft.'} Review and generate in the destination.</p>
    </fieldset>
    {(error || unavailable) && <p role="alert" className="sets-view__error">{error || unavailable}</p>}
    <footer className="set-send__footer"><button type="button" className="sets-view__back" disabled={busy} onClick={onClose}>Cancel</button>
      <button type="button" className="sets-view__import" disabled={busy || !!unavailable} onClick={onSend}>
        {busy ? 'Preparing references…' : destination === 'canvas' ? 'Send to Canvas' : 'Send to Studio'}</button></footer>
  </dialog>;
}
