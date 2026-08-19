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
              <div className="des-choice" onClick={onNewScreenplay}><div className="ic">📄</div><h3>New Screenplay</h3><p>Blank screenplay with dialogue. Write scenes, characters, action.</p></div>
              <div className="des-choice" onClick={onNewBeatSheet}><div className="ic">🎬</div><h3>New Beat Sheet</h3><p>No dialogue. Detailed beats (action, location, shot, mood) for video prompts.</p></div>
              <div className="des-choice" onClick={onUpload}><div className="ic">⬆️</div><h3>Upload</h3><p>.fdx, .fountain, .txt, .md — imported with correct formatting.</p></div>
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
            <p className="des-askq">🤖 <b>{idea.trim()}</b></p>
            <p className="des-asksub">How do you want to start?</p>
            <div className="des-kindtoggle">
              <button type="button" className={kind === 'screenplay' ? 'on' : ''} onClick={() => setKind('screenplay')}>Screenplay</button>
              <button type="button" className={kind === 'beatsheet' ? 'on' : ''} onClick={() => setKind('beatsheet')}>Beat Sheet</button>
            </div>
            <div className="des-askrow">
              <div className="des-opt" onClick={() => onCreateFromPrompt(idea.trim(), kind, 'draft')}>
                <h4>✍️ Draft it</h4><p>Write a first version now — it appears in the {kind === 'beatsheet' ? 'beat sheet' : 'script'} as a diff you can accept or decline.</p>
              </div>
              <div className="des-opt" onClick={() => onCreateFromPrompt(idea.trim(), kind, 'brainstorm')}>
                <h4>💭 Brainstorm first</h4><p>Talk through the story and structure in the chat before anything is written.</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
