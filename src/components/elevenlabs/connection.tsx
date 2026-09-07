import { useEffect, useState } from 'react';
import { elevenLabs } from '@/lib/elevenlabs/client';
import type { ElevenLabsVoice } from '@/lib/elevenlabs/types';

export function ElevenLabsConnection({ voiceId, onVoice, showVoices = true, disabled = false }: {
  voiceId?: string; onVoice?: (voice: ElevenLabsVoice) => void; showVoices?: boolean; disabled?: boolean;
}) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string>();
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => { let alive = true; elevenLabs.status().then(s => { if (alive) setConnected(s.connected); }).catch(e => { if (alive) { setConnected(false); setError(e.message); } }); return () => { alive = false; }; }, []);
  useEffect(() => {
    if (!connected || !showVoices) return;
    let alive = true;
    const timer = setTimeout(() => { elevenLabs.voices(search).then(r => { if (alive) { setVoices(r.voices); setCursor(r.cursor); setError(''); } }).catch(e => { if (alive) setError(e.message); }); }, 200);
    return () => { alive = false; clearTimeout(timer); };
  }, [connected, showVoices, search]);
  async function connect() {
    setBusy(true); setError('');
    try { await elevenLabs.connect(secret); setSecret(''); setConnected(true); setSettings(false); }
    catch (e) { setError(e instanceof Error ? e.message : 'Connection failed.'); }
    finally { setBusy(false); }
  }
  return <div className="elevenlabs-connection nodrag nowheel">
    <div className="elevenlabs-connection__heading"><span><span aria-hidden="true">Ⅱ</span> ElevenLabs</span><button type="button" disabled={disabled || busy} onClick={() => setSettings(v => !v)}>{connected ? 'Connected · Manage' : connected === null ? 'Checking…' : 'Connect'}</button></div>
    {(connected === false || settings) && <div className="elevenlabs-connection__setup">
      <p className="character-voice__hint">Connect once to generate here using your ElevenLabs account. Your key is encrypted in CineGen cloud storage.</p>
      <label>ElevenLabs API key<input type="password" autoComplete="off" className="element-modal__input" value={secret} disabled={disabled || busy} onChange={e => setSecret(e.target.value)} placeholder="Paste your ElevenLabs key" /></label>
      <p className="character-voice__hint">Enable Voices read/write, Text to Speech, Voice Generation and Sound Effects for the features you use. Claude’s connector is a separate connection.</p>
      <button className="character-voice__primary" type="button" disabled={!secret.trim() || busy || disabled} onClick={() => void connect()}>{busy ? 'Connecting…' : connected ? 'Update connection' : 'Connect ElevenLabs'}</button>
      {connected && <button className="character-voice__secondary" type="button" disabled={busy || disabled} onClick={() => { setBusy(true); void elevenLabs.disconnect().then(() => { setConnected(false); setVoices([]); }).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>Disconnect</button>}
    </div>}
    {connected && showVoices && <div className="elevenlabs-connection__voices">
      <div className="elevenlabs-connection__heading"><span>Voice</span><button type="button" disabled={disabled} onClick={() => setSearchOpen(v => !v)}>Search voices</button></div>{searchOpen && <input aria-label="Search ElevenLabs voices" className="element-modal__input" placeholder="Search your voices…" value={search} disabled={disabled} onChange={e => setSearch(e.target.value)} />}
      <select aria-label="ElevenLabs voice" className="element-modal__input" value={voiceId || ''} disabled={disabled} onChange={e => { const voice = voices.find(v => v.id === e.target.value); if (voice) onVoice?.(voice); }}><option value="">Choose a voice</option>{voiceId && !voices.some(v => v.id === voiceId) && <option value={voiceId}>Character’s saved voice</option>}{voices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
      {cursor && <button type="button" disabled={busy || disabled} onClick={() => { setBusy(true); void elevenLabs.voices(search, cursor).then(r => { setVoices(v => [...v, ...r.voices]); setCursor(r.cursor); }).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>Load more voices</button>}
    </div>}
    {error && <p className="character-voice__error" role="alert">{error}</p>}
  </div>;
}
