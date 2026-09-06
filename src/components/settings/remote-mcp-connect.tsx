import { useState } from 'react';

export const REMOTE_MCP_URL = 'https://cinegen-remote.christopherjohnogden.workers.dev/mcp';

export function RemoteMcpConnect() {
  const [message, setMessage] = useState('');
  return <section className="sp-card" id="sp-section-remote-mcp">
    <h3 className="sp-card__title">Claude & ChatGPT on the go</h3>
    <p className="sp-card__desc">Work on cloud projects while CineGen is closed. Add this URL as a custom connector in Claude or supported ChatGPT accounts, then sign in with the same CineGen Cloud account you use here.</p>
    <div className="sp-field">
      <label className="sp-field__label" htmlFor="remote-mcp-url">Connection URL</label>
      <input id="remote-mcp-url" className="sp-field__input sp-field__input--mono" readOnly value={REMOTE_MCP_URL} onFocus={event => event.currentTarget.select()} />
    </div>
    <div className="sp-card__actions">
      <button className="sp-btn sp-btn--accent" type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(REMOTE_MCP_URL); setMessage('Connection URL copied.'); }
        catch { setMessage('Select the connection URL above and copy it.'); }
      }}>Copy connection URL</button>
    </div>
    <p className="sp-card__desc">Scripts, shotlists, Elements, Spaces and timeline edits save to your cloud projects. Add a fal.ai key during connection to generate images and videos in the background. Desktop exports and other providers still need the app.</p>
    <p className="sp-card__desc">Set up Claude’s connector on the web, then use it on mobile. ChatGPT custom MCP apps are currently web-only and require a supported plan with developer mode.</p>
    <p className="sp-card__desc">Sync local projects from Cloud Account first. Reopen a project to load remote changes; a newer version is protected from stale saves.</p>
    {message && <p className="sp-card__desc" role="status">{message}</p>}
  </section>;
}
