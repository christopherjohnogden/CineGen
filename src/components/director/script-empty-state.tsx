import { useState } from 'react';

type CreateKind = 'screenplay' | 'beatsheet';

interface ScriptEmptyStateProps {
  onNewScreenplay: () => void;
  onNewBeatSheet: () => void;
  onUpload: () => void;
  onCreateFromPrompt: (idea: string, kind: CreateKind, mode: 'draft' | 'brainstorm') => void;
}

export function ScriptEmptyState({ onNewScreenplay, onNewBeatSheet, onUpload, onCreateFromPrompt }: ScriptEmptyStateProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [idea, setIdea] = useState('');
  const [kind, setKind] = useState<CreateKind>('screenplay');

  return (
    <div className="des-wrap">
      <div className="des-card">
        {step === 1 ? (
          <>
            <h1 className="des-h1">Start your script</h1>
            <p className="des-sub">Upload a Final Draft / Fountain file, start a blank document, or tell the assistant what you want to make.</p>
            <div className="des-choices">
              <button type="button" className="des-choice" onClick={onNewScreenplay}><div className="ic"><ScriptStartIcon kind="screenplay" /></div><h3>New Screenplay</h3><p>Blank screenplay with dialogue. Write scenes, characters, action.</p></button>
              <button type="button" className="des-choice" onClick={onNewBeatSheet}><div className="ic"><ScriptStartIcon kind="beatsheet" /></div><h3>New Beat Sheet</h3><p>No dialogue. Detailed beats (action, location, shot, mood) for video prompts.</p></button>
              <button type="button" className="des-choice" onClick={onUpload}><div className="ic"><ScriptStartIcon kind="upload" /></div><h3>Upload</h3><p>.fdx, .fountain, .txt, .md — imported with correct formatting.</p></button>
            </div>
            <div className="des-or">or tell the assistant</div>
            <div className="des-promptbox">
              <textarea
                value={idea}
                placeholder='e.g. "A short film about a thief who returns what she steals" — or — "A video about a city waking up at dawn, no dialogue"'
                onChange={(e) => setIdea(e.target.value)}
              />
              <div className="des-prow">
                <span className="director-tab__chip" onClick={() => setIdea('A short film about ')}>Short film about…</span>
                <span className="director-tab__chip" onClick={() => { setIdea('A video, no dialogue, about '); setKind('beatsheet'); }}>No-dialogue video about…</span>
                <span className="director-tab__chip" onClick={() => setIdea('Help me brainstorm ')}>Help me brainstorm…</span>
                <button type="button" className="director-tab__btn director-tab__btn--accent" style={{ marginLeft: 'auto' }} disabled={!idea.trim()} onClick={() => setStep(2)}>Send ▸</button>
              </div>
            </div>
          </>
        ) : (
          <>
            <button type="button" className="des-back" onClick={() => setStep(1)}>‹ Back</button>
            <p className="des-askq"><span className="des-askq__icon" aria-hidden="true"><ScriptStartIcon kind="assistant" /></span><b>{idea.trim()}</b></p>
            <p className="des-asksub">How do you want to start?</p>
            <div className="des-kindtoggle">
              <button type="button" className={kind === 'screenplay' ? 'on' : ''} onClick={() => setKind('screenplay')}>Screenplay</button>
              <button type="button" className={kind === 'beatsheet' ? 'on' : ''} onClick={() => setKind('beatsheet')}>Beat Sheet</button>
            </div>
            <div className="des-askrow">
              <div className="des-opt" onClick={() => onCreateFromPrompt(idea.trim(), kind, 'draft')}>
                <h4>Draft it</h4><p>Write a first version now — it appears in the {kind === 'beatsheet' ? 'beat sheet' : 'script'} as a diff you can accept or decline.</p>
              </div>
              <div className="des-opt" onClick={() => onCreateFromPrompt(idea.trim(), kind, 'brainstorm')}>
                <h4>Brainstorm first</h4><p>Talk through the story and structure in the chat before anything is written.</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ScriptStartIcon({ kind }: { kind: 'screenplay' | 'beatsheet' | 'upload' | 'assistant' }) {
  if (kind === 'screenplay') {
    return <svg width="30" height="30" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 4h11l5 5v19H8V4Z" /><path d="M19 4v6h5M12 15h8M12 19h8M12 23h5" /></svg>;
  }
  if (kind === 'beatsheet') {
    return <svg width="30" height="30" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="5" y="8" width="22" height="17" rx="2" /><path d="m5 13 22-5M10 9l3 4M17 7l3 4M10 18h5M18 18h4M10 22h8" /></svg>;
  }
  if (kind === 'upload') {
    return <svg width="30" height="30" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M16 21V6M10.5 11.5 16 6l5.5 5.5M7 20v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></svg>;
  }
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="4" /><path d="M9 2v3M15 2v3M8 11h.01M16 11h.01M9 15h6" /></svg>;
}
