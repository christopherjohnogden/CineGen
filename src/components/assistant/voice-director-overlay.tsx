import { useEffect, useMemo, useRef, useState } from 'react';
import type { DirectorShow } from '@/types/director';
import type { WorkspaceState } from '@/types/workspace';
import { getOpenAiApiKey } from '@/lib/utils/api-key';
import {
  applyVoiceDirectorChanges,
  buildVoiceDirectorContext,
  VOICE_DIRECTOR_INSTRUCTIONS,
} from '@/lib/assistant/voice-director';
import {
  VOICE_DIRECTOR_VOICES,
  VoiceDirectorSession,
  type VoiceDirectorVoice,
  type VoiceSessionStatus,
  type VoiceTranscriptEvent,
} from '@/lib/assistant/realtime-voice';

interface VoiceDirectorOverlayProps {
  open: boolean;
  state: WorkspaceState;
  onClose: () => void;
  onApplyDirector: (director: DirectorShow) => void;
  onUndo: () => void;
}

interface TranscriptTurn extends VoiceTranscriptEvent {}

const VOICE_STORAGE_KEY = 'cinegen.voice-director.voice';

function initialVoice(): VoiceDirectorVoice {
  try {
    const stored = window.localStorage.getItem(VOICE_STORAGE_KEY);
    if (VOICE_DIRECTOR_VOICES.includes(stored as VoiceDirectorVoice)) {
      return stored as VoiceDirectorVoice;
    }
  } catch {}
  return 'cedar';
}

function statusLabel(status: VoiceSessionStatus, muted: boolean): string {
  if (muted) return 'Muted';
  if (status === 'connecting') return 'Connecting…';
  if (status === 'thinking') return 'Thinking…';
  if (status === 'speaking') return 'Speaking';
  if (status === 'error') return 'Needs attention';
  if (status === 'closed') return 'Stopped';
  return 'Listening';
}

function targetLabel(state: WorkspaceState): string {
  const show = state.director;
  const clip = show.clips.find((entry) => entry.id === show.selectedClipId);
  const scene = show.scenes.find((entry) => entry.id === show.selectedSceneId);
  if (state.activeTab === 'director' && clip) return `Director · ${clip.title}`;
  if (state.activeTab === 'director' && scene) return `Director · ${scene.label}`;
  if (state.activeTab === 'director') return `Director · ${show.mode}`;
  if (state.activeTab === 'create') {
    const node = state.nodes.find((entry) => entry.selected && entry.type !== 'group');
    if (node) return `Spaces · ${node.data.label}`;
  }
  return state.activeTab.charAt(0).toUpperCase() + state.activeTab.slice(1);
}

export function VoiceDirectorOverlay({
  open, state, onClose, onApplyDirector, onUndo,
}: VoiceDirectorOverlayProps) {
  const [status, setStatus] = useState<VoiceSessionStatus>('closed');
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [restart, setRestart] = useState(0);
  const [voice, setVoice] = useState<VoiceDirectorVoice>(initialVoice);
  const sessionRef = useRef<VoiceDirectorSession | null>(null);
  const stateRef = useRef(state);
  const bottomRef = useRef<HTMLDivElement>(null);
  stateRef.current = state;

  const context = useMemo(() => buildVoiceDirectorContext(state), [state]);
  const instructions = `${VOICE_DIRECTOR_INSTRUCTIONS}\n\nCURRENT CINEGEN PROJECT CONTEXT\n${context}`;

  const appendTranscript = (event: VoiceTranscriptEvent) => {
    setTurns((current) => {
      const index = current.findIndex((turn) => turn.id === event.id && turn.role === event.role);
      if (index < 0) return [...current, event].slice(-40);
      const next = [...current];
      next[index] = {
        ...next[index],
        text: event.final ? event.text : `${next[index].text}${event.text}`,
        final: event.final,
      };
      return next;
    });
  };

  useEffect(() => {
    if (!open) return;
    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      setStatus('error');
      setError('Add an OpenAI API key in Settings, then try Voice Director again.');
      return;
    }
    setError('');
    setMuted(false);
    const session = new VoiceDirectorSession({
      apiKey,
      voice,
      instructions,
      onStatus: setStatus,
      onTranscript: appendTranscript,
      onError: setError,
      onToolCall: async (name, args) => {
        if (name === 'apply_director_changes') {
          const result = applyVoiceDirectorChanges(stateRef.current.director, args);
          if (result.appliedCount > 0) onApplyDirector(result.director);
          const warnings = result.warnings.length > 0 ? ` ${result.warnings.join(' ')}` : '';
          return {
            ok: result.appliedCount > 0,
            message: result.appliedCount > 0
              ? `${result.summary} Applied ${result.appliedCount} change${result.appliedCount === 1 ? '' : 's'}.${warnings}`
              : `${result.summary}${warnings}`,
            appliedCount: result.appliedCount,
            warnings: result.warnings,
          };
        }
        if (name === 'undo_last_voice_change') {
          onUndo();
          return { ok: true, message: 'Undid the most recent CineGen change.' };
        }
        return { ok: false, message: `CineGen does not expose the ${name} action.` };
      },
    });
    sessionRef.current = session;
    void session.connect().catch(() => {});
    return () => {
      session.close();
      if (sessionRef.current === session) sessionRef.current = null;
    };
    // A restart intentionally creates a fresh conversation. Project context updates in-place below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, restart]);

  useEffect(() => {
    if (!open) return;
    sessionRef.current?.updateInstructions(instructions);
  }, [instructions, open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, status]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    sessionRef.current?.setMuted(next);
  };

  const chooseVoice = (nextVoice: VoiceDirectorVoice) => {
    if (nextVoice === voice) return;
    setVoice(nextVoice);
    try { window.localStorage.setItem(VOICE_STORAGE_KEY, nextVoice); } catch {}
    setTurns([]);
    setRestart((value) => value + 1);
  };

  return (
    <div className="vdir" role="dialog" aria-modal="true" aria-label="Voice Director">
      <button type="button" className="vdir__scrim" onClick={onClose} aria-label="Close Voice Director" />
      <section className="vdir__panel">
        <header className="vdir__head">
          <div className={`vdir__pulse vdir__pulse--${status}${muted ? ' vdir__pulse--muted' : ''}`} aria-hidden>
            <span /><span /><span />
          </div>
          <div className="vdir__identity">
            <strong>Voice Director</strong>
            <span>{targetLabel(state)}</span>
          </div>
          <span className={`vdir__status vdir__status--${status}`}>{statusLabel(status, muted)}</span>
          <button type="button" className="vdir__close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="vdir__transcript" aria-live="polite">
          {turns.length === 0 && !error && (
            <div className="vdir__empty">
              <span className="vdir__empty-mark">◉</span>
              <strong>Talk through the scene</strong>
              <p>Brainstorm naturally. Nothing changes until you say “execute it” or “apply that.”</p>
            </div>
          )}
          {turns.map((turn) => (
            <div key={`${turn.role}-${turn.id}`} className={`vdir__turn vdir__turn--${turn.role}`}>
              <span>{turn.role === 'user' ? 'You' : turn.role === 'assistant' ? 'Director' : 'CineGen'}</span>
              <p>{turn.text}</p>
            </div>
          ))}
          {error && (
            <div className="vdir__error">
              <strong>Voice Director couldn’t connect</strong>
              <p>{error}</p>
              {getOpenAiApiKey() && (
                <button type="button" onClick={() => { setTurns([]); setRestart((value) => value + 1); }}>Try again</button>
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <footer className="vdir__controls">
          <button type="button" className={muted ? 'vdir__control vdir__control--active' : 'vdir__control'} onClick={toggleMute} disabled={status === 'error' || status === 'closed'}>
            {muted ? 'Unmute' : 'Mute'}
          </button>
          <label className="vdir__voice" title="Changing the voice starts a new conversation">
            <span>Voice</span>
            <select value={voice} onChange={(event) => chooseVoice(event.target.value as VoiceDirectorVoice)}>
              {VOICE_DIRECTOR_VOICES.map((option) => (
                <option key={option} value={option}>{option.charAt(0).toUpperCase() + option.slice(1)}</option>
              ))}
            </select>
          </label>
          <span className="vdir__hint">⌘⇧Space toggles · Esc closes</span>
          <button type="button" className="vdir__end" onClick={onClose}>End conversation</button>
        </footer>
      </section>
    </div>
  );
}
