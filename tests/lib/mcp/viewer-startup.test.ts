// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { build, transform } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import { compileMcpViewer } from '../../../scripts/build-mcp-viewer.mjs';

let api: any;
const windows: JSDOM[] = [];
const page = {
  mode: 'elements', title: 'Reference Elements', projectId: 'fixture',
  items: Array.from({ length: 7 }, (_, i) => ({ id: `charger-${i}`, title: `1970 Charger R/T — ${i + 1}`,
    kind: 'image', status: 'complete', elementId: 'charger', imageId: `reference-${i}`,
    url: `https://firebasestorage.googleapis.com/fixture-${i}.png`,
    previewUrl: `https://firebasestorage.googleapis.com/fixture-${i}.png` })),
  total: 7, offset: 0, limit: 24, hasMore: false,
  refresh: { name: 'cinegen_show_reference_elements', arguments: { elementIds: ['charger'] } },
};

beforeAll(async () => {
  // Exercise BOTH build stages: our minified worker, then Wrangler's keepNames
  // transform. Evaluating only the source missed the production __name crash.
  const first = await build({ entryPoints: ['mcp/media-viewer.mjs'], bundle: true, write: false,
    format: 'cjs', platform: 'browser', target: 'es2022', minify: true });
  const second = await transform(first.outputFiles[0].text, { keepNames: true, target: 'es2022' });
  const module = { exports: {} };
  runInNewContext(second.code, { module, exports: module.exports });
  api = module.exports;
});
afterEach(() => { for (const dom of windows.splice(0)) dom.window.close(); vi.useRealTimers(); });

function mount({ preloaded = false, uri = api.MEDIA_RESOURCE.uri } = {}) {
  vi.useFakeTimers();
  const html = api.readMediaResource(uri).contents[0].text;
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://widget.example/' });
  windows.push(dom);
  const window = dom.window;
  const host = { postMessage: vi.fn() };
  Object.defineProperty(window, 'parent', { value: host });
  window.ResizeObserver = class { observe() {} disconnect() {} } as any;
  window.console.error = vi.fn();
  if (preloaded) (window as any).openai = { toolOutput: page };
  for (const script of window.document.scripts) window.eval(script.textContent!);
  const send = (data: any, source: any = host) => window.dispatchEvent(new window.MessageEvent('message', {
    source, origin: 'https://chat.example', data: { jsonrpc: '2.0', ...data },
  }));
  const initialize = async (hostContext = {}, hostCapabilities = {}) => {
    const call = host.postMessage.mock.calls.find(([message]) => message.method === 'ui/initialize')?.[0];
    expect(call).toBeDefined();
    send({ id: call.id, result: { protocolVersion: '2026-01-26', hostCapabilities, hostContext, hostInfo: { name: 'Fixture host', version: '1' } } });
    await vi.advanceTimersByTimeAsync(0);
  };
  const result = () => send({ method: 'ui/notifications/tool-result', params: { structuredContent: page } });
  return { window, document: window.document, host, initialize, send, result };
}

describe('deployed MCP viewer startup', () => {
  it('keeps the checked-in browser artifact in sync with its source', async () => {
    expect(await readFile('mcp/media-viewer-script.mjs', 'utf8')).toBe(await compileMcpViewer());
  });

  it('starts after the deployment transforms and renders all seven Element references', async () => {
    const view = mount();
    await view.initialize();
    expect(view.host.postMessage.mock.calls.some(([message]) => message.method === 'ui/notifications/initialized')).toBe(true);
    view.result();
    expect(view.document.querySelectorAll('.card')).toHaveLength(7);
    expect(view.document.querySelectorAll('img')).toHaveLength(7);
    expect(view.document.body.textContent).toContain('1970 Charger R/T');
    expect(view.document.querySelector('.loading')).toBeNull();
    expect(view.window.console.error).not.toHaveBeenCalled();
  });

  it('serves the fixed script to hosts still using a cached resource URI', async () => {
    for (const uri of ['ui://cinegen/media-viewer-v1.html', 'ui://cinegen/media-viewer-v2.html', 'ui://cinegen/media-viewer-v3.html']) {
      expect(api.readMediaResource(uri).contents[0].uri).toBe(uri);
      const view = mount({ uri }); await view.initialize(); view.result();
      expect(view.document.querySelectorAll('.card')).toHaveLength(7);
    }
  });

  it('accepts a result before the initialize response without reverting to a loading error', async () => {
    const view = mount(); view.result(); await view.initialize();
    await vi.advanceTimersByTimeAsync(21000);
    expect(view.document.querySelectorAll('.card')).toHaveLength(7);
    expect(view.document.querySelector('[role="alert"]')).toBeNull();
  });

  it('renders preloaded and later legacy ChatGPT tool output without requiring a standard bridge', async () => {
    const preloaded = mount({ preloaded: true });
    const later = mount();
    later.window.dispatchEvent(new later.window.CustomEvent('openai:set_globals', { detail: { globals: { toolOutput: page } } }));
    await vi.advanceTimersByTimeAsync(21000);
    for (const view of [preloaded, later]) {
      expect(view.document.querySelectorAll('.card')).toHaveLength(7);
      expect(view.document.querySelector('[role="alert"]')).toBeNull();
    }
  });

  it('shows an actionable message when connected but never given data, and recovers on a late result', async () => {
    const view = mount(); await view.initialize();
    await vi.advanceTimersByTimeAsync(20001);
    expect(view.document.querySelector('[role="alert"]')?.textContent).toContain('did not deliver your library');
    expect(view.document.querySelector('.skeleton')).toBeNull();
    view.result();
    expect(view.document.querySelectorAll('.card')).toHaveLength(7);
    expect(view.document.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows an error if the host never connects', async () => {
    const view = mount(); await vi.advanceTimersByTimeAsync(20001);
    expect(view.document.body.textContent).toContain('Ask your assistant to show this media again');
    expect(view.document.querySelector('.loading')).toBeNull();
  });

  it('makes unreadable results and cancelled loads visible', async () => {
    const view = mount(); await view.initialize();
    view.send({ method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text: 'Unexpected response' }] } });
    expect(view.document.querySelector('[role="alert"]')?.textContent).toContain('readable CineGen view');
    view.send({ method: 'ui/notifications/tool-cancelled', params: {} });
    expect(view.document.querySelector('[role="alert"]')?.textContent).toContain('cancelled');
  });

  it('ignores untrusted windows and cleans up the startup timeout on teardown', async () => {
    const view = mount(); await view.initialize();
    view.send({ method: 'ui/notifications/tool-result', params: { structuredContent: page } }, view.window);
    expect(view.document.querySelectorAll('.card')).toHaveLength(0);
    view.send({ id: 'close', method: 'ui/resource-teardown', params: {} });
    await vi.advanceTimersByTimeAsync(21000);
    expect(view.document.querySelector('[role="alert"]')).toBeNull();
    expect(view.host.postMessage).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 'close', result: {} }, 'https://chat.example');
  });

  it('uses host height limits and responds to orientation/context changes without resizing loops', async () => {
    const view = mount(); await view.initialize({ containerDimensions: { maxHeight: 420 } }); view.result();
    expect(view.document.querySelector('#app')?.getAttribute('style')).toContain('--viewer-height: 420px');
    const sizes = () => view.host.postMessage.mock.calls.filter(([m]) => m.method === 'ui/notifications/size-changed');
    expect(sizes().at(-1)?.[0].params.height).toBe(420);
    const count = sizes().length;
    view.send({ method: 'ui/notifications/host-context-changed', params: { containerDimensions: { maxHeight: 420 } } });
    expect(sizes()).toHaveLength(count);
    view.send({ method: 'ui/notifications/host-context-changed', params: { containerDimensions: { height: 360 }, safeAreaInsets: { bottom: 12 } } });
    expect(sizes().at(-1)?.[0].params.height).toBe(360);
    expect(view.document.querySelector('#app')?.getAttribute('style')).toContain('--safe-bottom: 12px');
  });

  it('selects exact references directly and preserves scroll when returning from a preview', async () => {
    const view = mount(); await view.initialize(); view.result();
    const content = () => view.document.querySelector('.content') as HTMLElement;
    expect(content().getAttribute('tabindex')).toBe('0');
    content().scrollTop = 217;
    (view.document.querySelectorAll('.card-view')[3] as HTMLButtonElement).click();
    expect(view.document.querySelectorAll('.card.is-selected')).toHaveLength(1);
    expect(content().scrollTop).toBe(217);
    expect(view.document.querySelector('.selection-count')?.textContent).toBe('1 selected');
    (view.document.querySelectorAll('.tile-preview')[3] as HTMLButtonElement).click();
    expect(view.document.querySelector('.detail h2')?.textContent).toContain('1970 Charger R/T — 4');
    (view.document.querySelector('.back') as HTMLButtonElement).click();
    expect(content().scrollTop).toBe(217);
    expect(view.document.querySelectorAll('.card-view')[3].getAttribute('aria-pressed')).toBe('true');
    (view.document.querySelectorAll('.card-view')[3] as HTMLButtonElement).click();
    expect(view.document.querySelectorAll('.is-selected')).toHaveLength(0);
  });

  it('sends the selected image IDs once without authorizing a generation', async () => {
    const view = mount(); await view.initialize({}, { message: { text: {} } }); view.result();
    (view.document.querySelectorAll('.card-view')[2] as HTMLButtonElement).click();
    (view.document.querySelector('.selection-main .primary') as HTMLButtonElement).click();
    const message = view.host.postMessage.mock.calls.find(([m]) => m.method === 'ui/message')?.[0];
    const selection = JSON.parse(message.params.content[0].text.split('\n').at(-1));
    expect(selection.selections.map((item: any) => item.imageId)).toEqual(['reference-2']);
    expect(selection.generationAuthorized).toBe(false);
    expect(view.host.postMessage.mock.calls.some(([m]) => m.method === 'tools/call')).toBe(false);
    view.send({ id: message.id, result: {} }); await vi.advanceTimersByTimeAsync(0);
    expect(view.document.querySelectorAll('.is-selected')).toHaveLength(0);
  });
});
