import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRightIcon, CheckIcon, Cross2Icon, MagicWandIcon, ReloadIcon, ResetIcon } from '@radix-ui/react-icons';
import { rewriteStudioPrompt } from '@/lib/studio/rewrite-client';
import type { StudioRewriteRequest } from '@/lib/studio/prompt-rewrite';

type Props = {
  prompt: string;
  kind: 'image' | 'video';
  onApply: (original: string, replacement: string) => void;
};

export function StudioPromptAssistant({ prompt, kind, onApply }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [undo, setUndo] = useState<{ before: string; after: string } | null>(null);
  const [preview, setPreview] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController | null>(null);
  const request = useRef<StudioRewriteRequest | null>(null);
  const latest = useRef(prompt);
  latest.current = prompt;

  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    field.current?.focus();
  }, [open]);

  function close() {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    dialog.current?.close();
    setOpen(false);
    trigger.current?.focus();
  }

  async function updatePrompt() {
    if (controller.current || !feedback.trim()) return;
    const original = latest.current;
    const instructions = feedback.trim();
    if (!request.current || request.current.text !== original || request.current.feedback !== instructions || request.current.kind !== kind) {
      request.current = { requestId: crypto.randomUUID(), kind, text: original, feedback: instructions };
    }
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const rewritten = await rewriteStudioPrompt(request.current, active.signal);
      if (active.signal.aborted) return;
      request.current = null;
      if (latest.current !== original) {
        setError('Your prompt changed while the AI was working. Your edits were kept. Send your message again to use the latest prompt.');
        return;
      }
      onApply(original, rewritten);
      setUndo({ before: original, after: rewritten });
      setFeedback('');
      setPreview(true);
      setNotice('Prompt updated. Review it below or describe another change.');
      field.current?.focus();
    } catch (cause) {
      if (active.signal.aborted) return;
      if (cause && typeof cause === 'object' && 'rewriteFinished' in cause) request.current = null;
      setError(cause instanceof Error ? cause.message : 'The AI could not update your prompt. Try again.');
    } finally {
      if (controller.current === active) {
        controller.current = null;
        setBusy(false);
      }
    }
  }

  const canUndo = undo !== null && prompt === undo.after && !busy;
  function undoChange() {
    if (!undo || !canUndo) return;
    onApply(undo.after, undo.before);
    setUndo(null);
    setNotice('Original prompt restored.');
    setError('');
    request.current = null;
  }

  return <>
    <button ref={trigger} type="button" className="studio-prompt-ai" aria-label="Edit prompt with AI" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <MagicWandIcon aria-hidden="true" /><span>AI</span>
    </button>
    {canUndo && !open && <button type="button" className="studio-prompt-ai-undo" onClick={undoChange} aria-label="Undo AI prompt change"><ResetIcon aria-hidden="true" />Undo</button>}
    {open && createPortal(
      <dialog ref={dialog} className="studio-prompt-editor" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
        onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}
        onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } }}
        onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void updatePrompt(); } }}>
        <header className="studio-prompt-editor__head">
          <div className="studio-prompt-editor__mark"><MagicWandIcon aria-hidden="true" /></div>
          <div><h2 id={`${id}-title`}>Shape your prompt</h2><p id={`${id}-description`}>Tell AI what to change. Keep the rest.</p></div>
          <button type="button" className="studio-prompt-editor__close" aria-label="Close AI prompt editor" onClick={close}><Cross2Icon /></button>
        </header>
        <div className="studio-prompt-editor__body">
          <label htmlFor={`${id}-feedback`}>What would you like to change?</label>
          <textarea ref={field} id={`${id}-feedback`} value={feedback} disabled={busy} rows={4}
            placeholder={kind === 'video' ? 'Make the camera move slower, keep the same four shots, and use softer morning light…' : 'Keep the character and framing, but make the lighting warmer and the background simpler…'}
            onChange={event => setFeedback(event.target.value)} />
          {!notice && <div className="studio-prompt-editor__suggestions" aria-label="Suggested changes">
            {['Make it more cinematic', 'Simplify the wording'].map(suggestion => <button key={suggestion} type="button" disabled={busy} onClick={() => { setFeedback(suggestion); field.current?.focus(); }}>{suggestion}</button>)}
          </div>}
          <div className="studio-prompt-editor__status" aria-live="polite">
            {busy ? <span><ReloadIcon className="studio-prompt-editor__spin" aria-hidden="true" />Updating your prompt…</span>
              : notice ? <span><CheckIcon aria-hidden="true" />{notice}</span> : null}
          </div>
          {error && <p className="studio-prompt-editor__error" role="alert">{error}</p>}
          <details className="studio-prompt-editor__preview" open={preview} onToggle={event => setPreview(event.currentTarget.open)}>
            <summary>Current prompt <span>{prompt.length.toLocaleString()} characters</span></summary>
            <p>{prompt || 'Your new prompt will appear here.'}</p>
          </details>
        </div>
        <footer className="studio-prompt-editor__footer">
          <button type="button" className="studio-prompt-editor__secondary" disabled={!canUndo} onClick={undoChange}><ResetIcon aria-hidden="true" />Undo</button>
          <button type="button" className="studio-prompt-editor__apply" disabled={busy || !feedback.trim()} onClick={() => void updatePrompt()}>
            {busy ? 'Updating…' : 'Update prompt'}<ArrowRightIcon aria-hidden="true" />
          </button>
        </footer>
      </dialog>, document.body)}
  </>;
}
