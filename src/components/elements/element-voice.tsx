import { useRef, useState } from 'react';
import type { ElementVoice } from '@/types/elements';
import { elevenLabsVoiceBrief } from '@/lib/elements/voice';
import { getApiKey } from '@/lib/utils/api-key';

export function ElementVoiceEditor({ name, elementId, voice, onChange, onBusy }: {
  name: string; elementId?: string; voice?: ElementVoice;
  onChange: (voice: ElementVoice | undefined) => void; onBusy: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const update = (patch: Partial<ElementVoice>) => onChange({ description: '', ...voice, ...patch });
  async function upload(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)) { setError('Choose an audio file.'); return; }
    setBusy(true); onBusy(true); setError('');
    try {
      const { url } = await window.electronAPI.elements.upload({ buffer: await file.arrayBuffer(), name: file.name, type: file.type || 'audio/mpeg' }, getApiKey());
      update({ referenceAudio: { id: crypto.randomUUID(), url, createdAt: new Date().toISOString(), source: 'upload' } });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The voice sample could not be uploaded.'); }
    finally { setBusy(false); onBusy(false); }
  }
  async function copyBrief() {
    setError('');
    try { await navigator.clipboard.writeText(elevenLabsVoiceBrief(name, voice, elementId)); setMessage('Copied. Paste into Claude with ElevenLabs and CineGen connected.'); }
    catch { setError('Clipboard access was blocked. Try again from your browser.'); }
  }
  return <section className="character-voice" aria-label="Character voice">
    <header className="character-voice__heading"><span className="character-voice__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6"/></svg></span><div><h4>Give them a voice</h4><p>One vocal identity, across every look and scene.</p></div><span className="character-voice__optional">Optional</span></header>
    <label className="element-modal__label" htmlFor="character-voice-direction">How does this character sound?</label>
    <textarea id="character-voice-direction" className="element-modal__textarea" rows={3} value={voice?.description ?? ''} onChange={e => update({ description: e.target.value })} placeholder="A warm, low voice with a soft Southern accent. Slightly gravelly, measured pace, dry humor. Calm even under pressure." />
    <p className="character-voice__hint">CineGen includes this direction in video prompts when you reference the character.</p>
    <details className="character-voice__connection"><summary>Voice sample & ElevenLabs <span>{voice?.referenceAudio ? 'Sample attached' : voice?.voiceId ? 'Voice linked' : 'Set up'}</span></summary>
      <div className="character-voice__fields">
        <label className="element-modal__label" htmlFor="character-voice-sample">Sample dialogue</label>
        <textarea id="character-voice-sample" className="element-modal__textarea" rows={2} value={voice?.sampleText ?? ''} onChange={e => update({ sampleText: e.target.value })} placeholder="The line you want to hear in their voice…" />
        <button className="character-voice__primary" type="button" onClick={copyBrief}>Copy voice brief for Claude</button>
        <p className="character-voice__hint">Copies a brief for your ElevenLabs MCP. Listen to the previews in Claude, choose a voice, then have Claude save it back to this character.</p>
        <div className="character-voice__row"><label>Voice name<input className="element-modal__input" value={voice?.voiceName ?? ''} onChange={e => update({ voiceName: e.target.value, provider: 'elevenlabs' })} placeholder="Your chosen voice" /></label><label>ElevenLabs voice ID<input className="element-modal__input" value={voice?.voiceId ?? ''} onChange={e => update({ voiceId: e.target.value, provider: 'elevenlabs' })} placeholder="Paste an existing voice ID" /></label></div>
        {voice?.referenceAudio && <div className="character-voice__sample"><audio controls preload="metadata" src={voice.referenceAudio.url} aria-label={`${name || 'Character'} voice sample`} /><button type="button" onClick={() => update({ referenceAudio: undefined })}>Remove sample</button></div>}
        <input ref={input} type="file" accept="audio/*,.mp3,.wav,.m4a" hidden onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" className="character-voice__secondary" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Uploading voice…' : voice?.referenceAudio ? 'Replace audio sample' : 'Upload audio sample'}</button>
      </div>
    </details>
    {message && <p className="character-voice__hint" role="status">{message}</p>}
    {error && <p className="character-voice__error" role="alert">{error}</p>}
  </section>;
}
