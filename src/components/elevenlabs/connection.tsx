import { useEffect, useState } from 'react';
import { elevenLabs } from '@/lib/elevenlabs/client';
import type { ElevenLabsVoice } from '@/lib/elevenlabs/types';

export function ElevenLabsConnection({ voiceId, voiceName, onVoice, showVoices = true, disabled = false, compact = false }: {
  voiceId?: string; voiceName?: string; onVoice?: (voice: ElevenLabsVoice) => void; showVoices?: boolean; disabled?: boolean; compact?: boolean;
}) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [connection, setConnection] = useState<'mcp' | 'api-key'>();
  const [manualKey, setManualKey] = useState(false);
  const [attempt, setAttempt] = useState<string>();
  const [authorizationUrl, setAuthorizationUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string>();
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => { let alive = true; elevenLabs.status().then(s => { if (alive) { setConnected(s.connected); setConnection(s.connection); } }).catch(e => { if (alive) { setConnected(false); setError(e.message); } }); return () => { alive = false; }; }, []);
  useEffect(() => {
    if (!connected || !showVoices) return;
    let alive = true;
    const timer = setTimeout(() => { elevenLabs.voices(search).then(r => { if (alive) { setVoices(r.voices); setCursor(r.cursor); setError(''); } }).catch(e => { if (alive) setError(e.message); }); }, 200);
    return () => { alive = false; clearTimeout(timer); };
  }, [connected, connection, showVoices, search]);
  useEffect(() => {
    if (!attempt) return;
    let active = true, timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + 600000;
    const check = async () => {
      try {
        const status = await elevenLabs.authStatus(attempt);
        if (!active) return;
        if (status.connected) { setConnected(true); setConnection('mcp'); setSettings(false); setAttempt(undefined); setAuthorizationUrl(''); setBusy(false); return; }
        if (status.error) { setError(status.error); setAttempt(undefined); setBusy(false); return; }
      } catch { /* A transient mobile connection failure does not restart sign-in. */ }
      if (!active) return;
      if (Date.now() >= deadline) { setError('Sign-in expired. Connect ElevenLabs again.'); setAttempt(undefined); setBusy(false); return; }
      timer = setTimeout(() => void check(), 2000);
    };
    void check();
    return () => { active = false; clearTimeout(timer); };
  }, [attempt]);
  async function connectMcp() {
    // Open synchronously in the click handler, before any authentication request.
    const popup = window.electronAPI?.elevenlabs ? null : window.open('about:blank', '_blank');
    if (popup) { popup.opener = null; popup.document.title = 'Connect ElevenLabs'; popup.document.body.textContent = 'Opening ElevenLabs sign-in…'; }
    setBusy(true); setError('');
    try {
      const login = await elevenLabs.authLogin();
      setAttempt(login.attempt); setAuthorizationUrl(!popup && !window.electronAPI?.elevenlabs ? login.authorizationUrl : '');
      if (popup) popup.location.replace(login.authorizationUrl);
    } catch (e) { popup?.close(); setBusy(false); setError(e instanceof Error ? e.message : 'Connection failed.'); }
  }
  async function connect() {
    setBusy(true); setError('');
    try { await elevenLabs.connect(secret); setSecret(''); setConnected(true); setConnection('api-key'); setSettings(false); }
    catch (e) { setError(e instanceof Error ? e.message : 'Connection failed.'); }
    finally { setBusy(false); }
  }
  const chosen = voices.find(v => v.id === voiceId);
  return <div className={`elevenlabs-connection nodrag nowheel${compact ? ' elevenlabs-connection--compact' : ''}`}>
    <div className="elevenlabs-connection__heading"><span><span aria-hidden="true">Ⅱ</span> ElevenLabs</span><button type="button" aria-label="ElevenLabs connection settings" disabled={disabled || busy || connected === null} onClick={() => setSettings(v => !v)}>{connected ? connection === 'mcp' ? 'MCP connected · Manage' : 'Connected · Manage' : connected === null ? 'Checking…' : 'Connect'}</button></div>
    {(connected === false || settings) && <div className="elevenlabs-connection__setup">
      <p className="character-voice__hint">Sign in once to use ElevenLabs in CineGen.</p>
      <button className="character-voice__primary" type="button" disabled={busy || disabled} onClick={() => void connectMcp()}>{busy && attempt ? 'Waiting for ElevenLabs…' : connection === 'mcp' && connected ? 'Reconnect ElevenLabs' : 'Connect ElevenLabs'}</button>
      {attempt && <p className="character-voice__hint">Finish signing in in the ElevenLabs tab, then return here. {authorizationUrl && <a href={authorizationUrl} target="_blank" rel="noreferrer">Open sign-in</a>} <button type="button" onClick={() => { void elevenLabs.authCancel(attempt).then(() => { setAttempt(undefined); setBusy(false); setAuthorizationUrl(''); }).catch(e => setError(e.message)); }}>Cancel</button></p>}
      {!attempt && <button type="button" disabled={busy || disabled} onClick={() => setManualKey(v => !v)}>Use an API key instead</button>}
      {manualKey && <>
        <label>ElevenLabs API key<input type="password" autoComplete="off" className="element-modal__input" value={secret} disabled={disabled || busy} onChange={e => setSecret(e.target.value)} placeholder="Paste your ElevenLabs key" /></label>
        <p className="character-voice__hint">Optional API connection. Stored encrypted.</p>
        <button className="character-voice__secondary" type="button" disabled={!secret.trim() || busy || disabled} onClick={() => void connect()}>Connect with API key</button>
      </>}
      {connected && <button className="character-voice__secondary" type="button" disabled={busy || disabled} onClick={() => { setBusy(true); void elevenLabs.disconnect().then(() => { setConnected(false); setVoices([]); }).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>Disconnect</button>}
    </div>}
    {connected && showVoices && <div className="elevenlabs-connection__voices">
      <div className="elevenlabs-connection__heading"><span>Voice</span><button type="button" disabled={disabled} onClick={() => setSearchOpen(v => !v)}>Search voices</button></div>{searchOpen && <input aria-label="Search ElevenLabs voices" className="element-modal__input" placeholder="Search your voices…" value={search} disabled={disabled} onChange={e => setSearch(e.target.value)} />}
      <select aria-label="ElevenLabs voice" className="element-modal__input" value={voiceId || ''} disabled={disabled} onChange={e => { const voice = voices.find(v => v.id === e.target.value); if (voice) onVoice?.(voice); }}><option value="">Choose a voice</option>{voiceId && !voices.some(v => v.id === voiceId) && <option value={voiceId}>{voiceName || 'Character’s saved voice'}</option>}{voices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
      {compact && chosen?.previewUrl && <audio controls preload="none" src={chosen.previewUrl} aria-label={`Preview ${chosen.name}`} />}
      {cursor && <button type="button" disabled={busy || disabled} onClick={() => { setBusy(true); void elevenLabs.voices(search, cursor).then(r => { setVoices(v => [...v, ...r.voices]); setCursor(r.cursor); }).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>Load more voices</button>}
    </div>}
    {error && <p className="character-voice__error" role="alert">{error}</p>}
  </div>;
}
