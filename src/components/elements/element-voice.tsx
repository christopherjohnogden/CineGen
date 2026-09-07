import { useRef, useState } from 'react';
import type { ElementVoice } from '@/types/elements';
import type { ElevenLabsPreview } from '@/lib/elevenlabs/types';
import { elevenLabs } from '@/lib/elevenlabs/client';
import { waitForElevenLabsAudio } from '@/lib/elevenlabs/wait';
import { ElevenLabsConnection } from '@/components/elevenlabs/connection';
import { getApiKey } from '@/lib/utils/api-key';

export function ElementVoiceEditor({ name, voice, onChange, onBusy }: {
  name: string; elementId?: string; voice?: ElementVoice;
  onChange: (voice: ElementVoice | undefined) => void; onBusy: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [previews, setPreviews] = useState<ElevenLabsPreview[]>([]);
  const [previewDescription, setPreviewDescription] = useState('');
  const [sampleRequest, setSampleRequest] = useState<string>();
  const update = (patch: Partial<ElementVoice>) => onChange({ description: '', ...voice, ...patch });
  async function work(fn: () => Promise<void>, label: string) {
    setBusy(true); onBusy(true); setError(''); setMessage(label);
    try { await fn(); setMessage(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'ElevenLabs could not finish.'); setMessage(''); }
    finally { setBusy(false); onBusy(false); }
  }
  async function upload(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)) { setError('Choose an audio file.'); return; }
    await work(async () => {
      const { url } = await window.electronAPI.elements.upload({ buffer: await file.arrayBuffer(), name: file.name, type: file.type || 'audio/mpeg' }, getApiKey());
      update({ referenceAudio: { id: crypto.randomUUID(), url, createdAt: new Date().toISOString(), source: 'upload' } });
    }, 'Saving audio…');
  }
  async function design() {
    await work(async () => {
      const description = voice?.description || '';
      const result = await elevenLabs.design(description, voice?.sampleText, voice?.sampleLanguage || 'en');
      setPreviews(result.previews); setPreviewDescription(description);
    }, 'Designing voice previews…');
  }
  async function choose(preview: ElevenLabsPreview) {
    await work(async () => {
      const saved = await elevenLabs.saveVoice(preview.id, name.trim() || 'Character voice', previewDescription, preview.viewStateId);
      update({ provider: 'elevenlabs', voiceId: saved.id, voiceName: saved.name, referenceAudio: { id: crypto.randomUUID(), url: preview.url, source: 'generated', createdAt: new Date().toISOString() } });
      setPreviews([]); setSampleRequest(undefined);
    }, 'Saving this voice…');
  }
  async function sample() {
    await work(async () => {
      const requestId = sampleRequest || crypto.randomUUID(); setSampleRequest(requestId);
      const result = await waitForElevenLabsAudio(sampleRequest ? await elevenLabs.job(requestId) : await elevenLabs.generate({ requestId, kind: 'speech', text: voice?.sampleText || '', voiceId: voice?.voiceId }));
      if (!result.url || result.status !== 'complete') throw new Error(result.error || 'Still creating this sample. Check again to retrieve the same take.');
      update({ referenceAudio: { id: result.assetId, url: result.url, createdAt: new Date().toISOString(), source: 'generated' } });
      setSampleRequest(undefined);
    }, 'Creating your voice sample…');
  }
  return <section className="character-voice" aria-label="Character voice">
    <header className="character-voice__heading"><span className="character-voice__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6"/></svg></span><div><h4>Give them a voice</h4><p>One vocal identity, across every look and scene.</p></div><span className="character-voice__optional">Optional</span></header>
    <fieldset className="elevenlabs-audio__fields" disabled={busy}>
    <label className="element-modal__label" htmlFor="character-voice-direction">How does this character sound?</label>
    <textarea id="character-voice-direction" className="element-modal__textarea" rows={3} value={voice?.description ?? ''} onChange={e => update({ description: e.target.value })} placeholder="A warm, low voice with a soft Southern accent. Slightly gravelly, measured pace, dry humor. Calm even under pressure." />
    <p className="character-voice__hint">CineGen includes this direction in video prompts when you reference the character.</p>
    <details className="character-voice__connection"><summary>Create or choose a voice <span>{voice?.voiceName || (voice?.referenceAudio ? 'Sample attached' : 'ElevenLabs')}</span></summary>
      <div className="character-voice__fields">
        <ElevenLabsConnection disabled={busy} voiceId={voice?.voiceId} onVoice={v => { update({ voiceId: v.id, voiceName: v.name, provider: 'elevenlabs' }); setSampleRequest(undefined); }} />
        <label className="element-modal__label" htmlFor="character-voice-sample">Sample dialogue</label>
        <textarea id="character-voice-sample" className="element-modal__textarea" rows={3} value={voice?.sampleText ?? ''} onChange={e => { update({ sampleText: e.target.value }); setSampleRequest(undefined); }} placeholder="The line you want to hear in their voice…" />
        {voice?.voiceId && <button className="character-voice__primary" type="button" disabled={!voice.sampleText?.trim() || busy} onClick={() => void sample()}>{sampleRequest ? 'Check this voice sample' : 'Generate voice sample'}</button>}
        <label className="element-modal__label" htmlFor="character-voice-language">Voice design language</label>
        <select id="character-voice-language" className="element-modal__input" value={voice?.sampleLanguage || 'en'} onChange={e => update({ sampleLanguage: e.target.value })}>
          <option value="en">English</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option><option value="pt">Portuguese</option><option value="ja">Japanese</option><option value="zh">Chinese</option><option value="ko">Korean</option><option value="it">Italian</option><option value="hi">Hindi</option><option value="ar">Arabic</option>
        </select>
        <button className="character-voice__secondary" type="button" disabled={!voice?.description?.trim() || !voice.sampleText?.trim() || busy} onClick={() => void design()}>Design voices from description</button>
        <p className="character-voice__hint">Listen to previews and choose a voice here. For voice design, write 100–1,000 characters of sample dialogue and choose its language. Generation uses your ElevenLabs credits.</p>
        {previews.map((preview, index) => <div className="elevenlabs-voice-preview" key={preview.id}><span>Voice {index + 1}</span><audio controls preload="metadata" src={preview.url} aria-label={`Voice preview ${index + 1}`} /><button className="character-voice__primary" type="button" disabled={busy} onClick={() => void choose(preview)}>Use this voice</button></div>)}
        {voice?.referenceAudio && <div className="character-voice__sample"><audio controls preload="metadata" src={voice.referenceAudio.url} aria-label={`${name || 'Character'} voice sample`} /><button type="button" onClick={() => update({ referenceAudio: undefined })}>Remove sample</button></div>}
        <input ref={input} type="file" accept="audio/*,.mp3,.wav,.m4a" hidden onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" className="character-voice__secondary" disabled={busy} onClick={() => input.current?.click()}>{voice?.referenceAudio ? 'Replace audio sample' : 'Use an audio file instead'}</button>
      </div>
    </details>
    </fieldset>
    {message && <p className="character-voice__hint" role="status">{message}</p>}
    {error && <p className="character-voice__error" role="alert">{error}</p>}
  </section>;
}
