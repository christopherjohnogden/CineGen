import { MEDIA_RESOURCE_URI, MEDIA_MIME_TYPE, MEDIA_DOMAINS } from './display-tools.mjs';

// Self-contained browser code, embedded in the MCP resource in both transports.
// Uses the MCP Apps postMessage bridge; no tokens, third-party scripts or API fetches.
function mountViewer() {
  const root = document.getElementById('app');
  const pending = new Map();
  let sequence = 0, hostOrigin = '*', ready = false, current, selected = null, busy = false, timer, polls = 0;
  const knownTools = new Set(['cinegen_show_generations', 'cinegen_show_reference_elements', 'cinegen_job_display']);
  const statusNames = { complete: 'Ready', running: 'Generating', submitting: 'Starting', queued: 'Queued', pending: 'Prepared', saving: 'Saving to CineGen', needs_attention: 'Needs attention', failed: 'Failed', not_found: 'Not found' };
  const activeStatuses = new Set(['running', 'submitting', 'queued', 'saving']);
  const element = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const button = (label, action, className = '') => {
    const el = element('button', className, label); el.type = 'button'; el.onclick = action; return el;
  };
  const safeUrl = value => {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
  };
  const notify = (method, params) => window.parent.postMessage({ jsonrpc: '2.0', method, params }, hostOrigin);
  function request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('The chat connection did not respond. Try refreshing this view.')); }, 20000);
      pending.set(id, { resolve, reject, timeout });
      window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, hostOrigin);
    });
  }
  function reportSize() {
    if (ready) notify('ui/notifications/size-changed', { width: document.documentElement.clientWidth, height: Math.ceil(root.getBoundingClientRect().height) });
    window.openai?.notifyIntrinsicHeight?.(Math.ceil(root.getBoundingClientRect().height));
  }
  function showError(message) {
    root.querySelector('.notice')?.remove();
    const notice = element('p', 'notice', message); notice.setAttribute('role', 'alert'); root.append(notice); reportSize();
  }
  async function openLink(value) {
    const url = safeUrl(value); if (!url) return;
    try {
      if (ready) await request('ui/open-link', { url });
      else if (window.openai?.openExternal) window.openai.openExternal({ href: url });
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) { showError(error.message || 'Could not open this link.'); }
  }
  function resultData(result) {
    if (result?.isError) throw new Error(result.content?.find(item => item.type === 'text')?.text || 'CineGen could not load this view.');
    const data = result?.structuredContent || result;
    if (!data || !Array.isArray(data.items) || !data.refresh || !knownTools.has(data.refresh.name)) return null;
    return data;
  }
  function receive(result) {
    try {
      const data = resultData(result); if (!data) return;
      current = data; render(); schedule();
    } catch (error) { showError(error.message); }
  }
  function schedule() {
    clearTimeout(timer);
    if (!current || polls >= 40 || !current.items.some(item => activeStatuses.has(item.status))) return;
    timer = setTimeout(async () => {
      if (document.visibilityState === 'hidden' || selected) { schedule(); return; }
      polls += 1; await refresh({}, true);
    }, 8000);
  }
  async function refresh(changes = {}, automatic = false) {
    if (!current || busy || !knownTools.has(current.refresh.name)) return;
    busy = true;
    const control = root.querySelector('[data-refresh]'); if (control) { control.disabled = true; control.textContent = 'Loading…'; }
    try {
      const args = { ...current.refresh.arguments, ...changes };
      const result = ready ? await request('tools/call', { name: current.refresh.name, arguments: args })
        : window.openai?.callTool ? await window.openai.callTool(current.refresh.name, args)
        : await Promise.reject(new Error('Refresh is unavailable here. Ask your assistant to show this view again.'));
      const data = resultData(result);
      if (!data) throw new Error('CineGen returned an unreadable display result.');
      current = data; if (!automatic) selected = null; render(); schedule();
    } catch (error) { showError(error.message || 'Could not refresh CineGen.'); }
    finally { busy = false; const control = root.querySelector('[data-refresh]'); if (control) { control.disabled = false; control.textContent = '↻ Refresh'; } }
  }
  function badge(item) {
    const status = element('span', `status ${item.status === 'complete' ? 'complete' : activeStatuses.has(item.status) ? 'active' : 'quiet'}`, statusNames[item.status] || item.status);
    return status;
  }
  function media(item, detail) {
    const frame = element('div', `frame ${detail ? 'large' : ''}`);
    const url = safeUrl(item.previewUrl);
    if (!url) {
      frame.append(element('span', 'placeholder-icon', item.kind === 'video' ? '▷' : '▧'));
      frame.append(element('p', 'placeholder', item.unavailableReason || (item.url ? 'Open media to view this source' : statusNames[item.status] || 'Preview unavailable')));
      return frame;
    }
    const view = element(item.kind === 'video' ? 'video' : 'img');
    if (item.kind === 'video') {
      view.controls = detail; view.preload = 'metadata'; view.playsInline = true;
      view.muted = !detail;
    } else { view.alt = item.title; view.loading = 'lazy'; view.referrerPolicy = 'no-referrer'; }
    view.src = url;
    view.onerror = () => {
      frame.replaceChildren(element('span', 'placeholder-icon', '▧'), element('p', 'placeholder', 'Preview unavailable. Refresh this view or open the media.'));
      reportSize();
    };
    frame.append(view);
    if (item.kind === 'video' && !detail) frame.append(element('span', 'play', '▶'));
    return frame;
  }
  function detail(item) {
    const panel = element('section', 'detail');
    if (current.mode !== 'job') panel.append(button('← Back to gallery', () => { selected = null; render(); schedule(); }, 'back'));
    panel.append(media(item, true));
    const heading = element('div', 'item-heading'); heading.append(element('h2', '', item.title), badge(item)); panel.append(heading);
    const facts = [item.spaceName, item.model, item.provider].filter(Boolean);
    if (facts.length) panel.append(element('p', 'meta', facts.join(' · ')));
    if (item.error) panel.append(element('p', 'notice', item.error));
    if (item.prompt) { const prompt = element('details', 'prompt'); prompt.open = true; prompt.append(element('summary', '', current.mode === 'elements' ? 'Description' : 'Prompt'), element('p', '', item.prompt)); panel.append(prompt); }
    const actions = element('div', 'actions');
    if (safeUrl(item.url)) actions.append(button(item.kind === 'video' ? 'Open video ↗' : 'Open image ↗', () => openLink(item.url), 'primary'));
    if (safeUrl(current.projectUrl)) actions.append(button('Open in CineGen ↗', () => openLink(current.projectUrl)));
    if (actions.children.length) panel.append(actions);
    return panel;
  }
  function render() {
    if (!current) return;
    root.querySelectorAll('video').forEach(video => video.pause());
    root.replaceChildren();
    const header = element('header');
    const identity = element('div'); identity.append(element('div', 'brand', 'CINEGEN'), element('h1', '', current.mode === 'job' ? 'Result viewer' : current.title));
    const reload = button('↻ Refresh', () => { polls = 0; refresh(); }); reload.dataset.refresh = ''; header.append(identity, reload); root.append(header);
    const item = current.mode === 'job' ? current.items[0] : current.items.find(item => item.id === selected);
    if (item) root.append(detail(item));
    else {
      const info = element('div', 'collection-info'); info.append(element('p', 'meta', `${current.total} ${current.mode === 'elements' ? 'references' : 'results'}`));
      if (current.projectUrl) info.append(button('Open CineGen ↗', () => openLink(current.projectUrl), 'link'));
      root.append(info);
      const grid = element('div', 'grid');
      if (!current.items.length) grid.append(element('p', 'empty', 'No matching media yet. Your saved results will appear here.'));
      for (const item of current.items) {
        const card = button('', () => { selected = item.id; render(); }, 'card'); card.setAttribute('aria-label', `View ${item.title}`);
        card.append(media(item, false));
        const body = element('div', 'card-body');
        body.append(element('span', 'kind', item.kind === 'video' ? 'VIDEO' : 'IMAGE'), element('h2', '', item.title));
        if (item.spaceName) body.append(element('p', 'meta', item.spaceName));
        body.append(badge(item)); card.append(body); grid.append(card);
      }
      root.append(grid);
      if (current.offset > 0 || current.hasMore) {
        const footer = element('footer');
        const prev = button('← Previous', () => refresh({ offset: Math.max(0, current.offset - current.limit) })); prev.disabled = current.offset === 0;
        const next = button('Next →', () => refresh({ offset: current.offset + current.limit })); next.disabled = !current.hasMore;
        footer.append(prev, element('span', 'meta', `${current.offset + 1}–${current.offset + current.items.length} of ${current.total}`), next); root.append(footer);
      }
    }
    reportSize();
  }
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.jsonrpc !== '2.0') return;
    if (hostOrigin !== '*' && event.origin !== hostOrigin) return;
    const message = event.data;
    if (message.id !== undefined && pending.has(message.id)) {
      const entry = pending.get(message.id); pending.delete(message.id); clearTimeout(entry.timeout);
      if (message.error) entry.reject(new Error(message.error.message || 'The chat host rejected this request.')); else entry.resolve(message.result);
      if (hostOrigin === '*' && event.origin && event.origin !== 'null') hostOrigin = event.origin;
      return;
    }
    if (message.method === 'ui/notifications/tool-result') receive(message.params);
    if (message.method === 'ui/notifications/tool-cancelled') showError('Loading was cancelled.');
    if (message.method === 'ui/resource-teardown') { clearTimeout(timer); root.querySelectorAll('video').forEach(video => video.pause()); window.parent.postMessage({ jsonrpc: '2.0', id: message.id, result: {} }, hostOrigin); }
  });
  window.addEventListener('openai:set_globals', event => { if (event.detail?.globals?.toolOutput) receive(event.detail.globals.toolOutput); });
  if (window.openai?.toolOutput) receive(window.openai.toolOutput);
  new ResizeObserver(reportSize).observe(root);
  request('ui/initialize', { appInfo: { name: 'CineGen Media', version: '1.0.0' }, appCapabilities: { availableDisplayModes: ['inline'] }, protocolVersion: '2026-01-26' })
    .then(() => { ready = true; notify('ui/notifications/initialized', {}); reportSize(); })
    .catch(() => { if (!current) showError('Ask your assistant to show CineGen media again if this view does not load.'); });
}

const css = `
*{box-sizing:border-box}html,body{margin:0;background:#0d0f13;color:#eeeae3;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{color-scheme:dark}#app{padding:22px;max-width:1000px;margin:auto}header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:20px;border-bottom:1px solid #292b31}.brand{font-size:10px;letter-spacing:.26em;font-weight:800;color:#d8a453;margin-bottom:5px}h1{font-size:22px;letter-spacing:-.03em;line-height:1.2;margin:0}h2{margin:5px 0;font-size:15px;font-weight:600;overflow-wrap:anywhere}button{font:inherit;cursor:pointer;color:inherit;background:#20232b;border:1px solid #363941;border-radius:9px;padding:9px 13px;min-height:40px}button:hover{background:#2d3039;border-color:#827059}button:focus-visible,summary:focus-visible{outline:2px solid #e0ac62;outline-offset:3px}button:disabled{opacity:.45;cursor:default}.collection-info{display:flex;justify-content:space-between;align-items:center;margin:14px 0;gap:8px}.meta{color:#b1ada7;font-size:12px;margin:5px 0}.link,.back{background:transparent;border:0;padding:8px 0;color:#e0ac62}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.card{padding:0;text-align:left;overflow:hidden;background:#171a21;border:1px solid #30333a;border-radius:12px;display:flex;flex-direction:column;min-width:0}.frame{position:relative;background:#090b0e;aspect-ratio:16/10;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;width:100%}.frame img,.frame video{width:100%;height:100%;object-fit:cover}.frame.large{aspect-ratio:auto;min-height:180px;max-height:470px;border:1px solid #292c33;border-radius:12px;margin-top:12px}.large img,.large video{width:100%;max-height:470px;object-fit:contain}.card-body{padding:12px 14px;flex:1}.kind{font:700 9px/1.2 ui-monospace,monospace;letter-spacing:.15em;color:#a9a399}.status{display:inline-flex;align-items:center;gap:6px;border-radius:5px;padding:3px 7px;font-size:10px;font-weight:600;margin-top:8px;background:#2a2d34;color:#c5c1ba}.complete{color:#b9cfbe;background:#24302a}.active{color:#efc17b;background:#3a2e20}.active:before{content:'';width:5px;height:5px;border-radius:100%;background:#e1aa57}.quiet{color:#d3b8b0}.play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:42px;height:42px;border:1px solid #ffffff55;background:#121419c9;border-radius:50%;display:grid;place-items:center;font-size:16px;padding-left:2px}.placeholder-icon{font-size:35px;color:#81715b}.placeholder{font-size:11px;text-align:center;color:#b8b0a5;padding:0 14px;max-width:280px}.item-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:16px}.item-heading h2{font-size:18px}.item-heading .status{flex-shrink:0;margin:0}.prompt{margin:18px 0;background:#191c23;border:1px solid #2d3038;border-radius:10px;padding:12px 14px}.prompt summary{cursor:pointer;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#d7b780}.prompt p{line-height:1.7;margin:12px 0 2px;white-space:pre-wrap;overflow-wrap:anywhere}.actions{display:flex;gap:10px;flex-wrap:wrap}.primary{background:#d4a052;color:#151311;border-color:#d4a052;font-weight:650}.primary:hover{background:#e0af68}.notice{border-left:2px solid #d7a362;background:#2a231c;color:#f0d3aa;padding:12px;font-size:12px;overflow-wrap:anywhere}.empty{color:#b1ada7;grid-column:1/-1;padding:35px 10px;text-align:center}footer{display:flex;align-items:center;justify-content:space-between;gap:10px;border-top:1px solid #292b31;margin-top:20px;padding-top:16px}.loading{color:#b1ada7;padding:30px 0;text-align:center}@media(max-width:650px){#app{padding:16px}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}h1{font-size:20px}.card-body{padding:10px}header{gap:10px}.frame.large{max-height:340px}.large img,.large video{max-height:340px}.item-heading{align-items:flex-start}}@media(max-width:340px){.grid{grid-template-columns:1fr}header button{padding:8px;font-size:12px}}`;

const meta = {
  ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: MEDIA_DOMAINS } },
  'openai/widgetDescription': 'CineGen image and video gallery. Users can view references, play videos, inspect prompts, refresh status and open saved media. The widget cannot generate or edit.',
  'openai/widgetPrefersBorder': true,
  'openai/widgetCSP': { connect_domains: [], resource_domains: MEDIA_DOMAINS },
};
export const MEDIA_RESOURCE = { uri: MEDIA_RESOURCE_URI, name: 'CineGen media viewer', description: 'Inline image/video and Element reference gallery.', mimeType: MEDIA_MIME_TYPE, _meta: meta };
export function readMediaResource(uri) {
  if (uri !== MEDIA_RESOURCE_URI) throw new Error('Unknown CineGen UI resource.');
  return { contents: [{ uri: MEDIA_RESOURCE_URI, mimeType: MEDIA_MIME_TYPE, _meta: meta, text: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>CineGen Media</title><style>${css}</style></head><body><main id="app"><div class="brand">CINEGEN</div><p class="loading" role="status">Loading your media…</p></main><script>(${mountViewer.toString()})();</script></body></html>` }] };
}
