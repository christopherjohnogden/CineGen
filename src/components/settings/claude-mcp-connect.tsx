import { useEffect, useState } from 'react';
import type { ClaudeMcpStatus } from '../../../electron';

export function ClaudeMcpConnect() {
  const api = window.electronAPI?.claudeMcp;
  const [status, setStatus] = useState<ClaudeMcpStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let disposed = false;
    if (api) void api.status().then(value => {
      if (!disposed) setStatus(value);
    }).catch(cause => { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { disposed = true; };
  }, [api]);

  async function run(action: 'setup' | 'remove' | 'status' | 'reveal') {
    if (!api) return;
    setBusy(true); setError(''); setMessage('');
    try {
      if (action === 'reveal') await api.reveal();
      else {
        const value = await api[action]();
        setStatus(value);
        if (action === 'setup') setMessage('Setup saved. Fully quit and reopen Claude Desktop, then start a new chat.');
        if (action === 'remove') setMessage('CineGen removed from Claude’s configuration. Restart Claude Desktop to apply.');
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  return (
    <section className="sp-card" id="sp-section-claude">
      <h3 className="sp-card__title">Claude Desktop</h3>
      <p className="sp-card__desc">
        Let Claude work in CineGen: break down scripts, create Elements, generate takes and edit timelines.
        Setup adds CineGen to Claude’s local tools and keeps your other connections.
      </p>
      {!api ? <p className="sp-card__desc">Open the latest CineGen desktop app on your Mac to set up this connection.</p> : <>
        <p className="sp-card__desc" role="status">
          {status ? (status.configured ? (status.needsRepair ? 'Setup needs updating.' : 'Configured for Claude Desktop.') : 'Not set up yet.') : error ? 'Could not check setup.' : 'Checking setup…'}
        </p>
        <div className="sp-card__actions">
          <button className="sp-btn" type="button" disabled={busy || status?.supported === false || status?.serverAvailable === false} onClick={() => void run('setup')}>
            {busy ? 'Working…' : status?.configured ? 'Repair Claude setup' : 'Connect Claude Desktop'}
          </button>
          <button className="sp-btn sp-btn--muted" type="button" disabled={busy} onClick={() => void run('status')}>Check setup</button>
          {status?.configured && <>
            <button className="sp-btn sp-btn--muted" type="button" disabled={busy} onClick={() => void run('reveal')}>Show configuration</button>
            <button className="sp-btn sp-btn--muted" type="button" disabled={busy} onClick={() => void run('remove')}>Disconnect</button>
          </>}
        </div>
        {status?.serverAvailable === false && <p className="sp-card__desc">This build is missing the setup server. Install the latest CineGen Mac build.</p>}
        {status?.supported === false && <p className="sp-card__desc">Automatic setup is currently available on Mac.</p>}
      </>}
      {message && <p className="sp-card__desc" role="status">{message}</p>}
      {error && <p className="sp-card__desc" role="alert">{error}</p>}
      <p className="sp-card__desc">
        After setup, fully quit and reopen Claude Desktop. In Claude, check <strong>Settings → Developer → Local MCP servers</strong> for <strong>cinegen</strong>.
        This local setup is separate from the Connectors directory. Keep CineGen running and use a Claude Desktop chat on this Mac; it does not connect Claude on iPhone, the web or Cowork.
      </p>
      <p className="sp-card__desc">Try asking Claude: “Use CineGen to list my projects.”</p>
    </section>
  );
}
