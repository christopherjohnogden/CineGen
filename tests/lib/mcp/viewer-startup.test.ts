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
  window.Date = Date as any;
  const host = { postMessage: vi.fn() };
  Object.defineProperty(window, 'parent', { value: host });
  window.ResizeObserver = class { observe() {} disconnect() {} } as any;
  window.console.error = vi.fn();
  Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', { value() { return { height: 800, width: 390 }; } });
  Object.defineProperty(window.document, 'visibilityState', { value: 'visible', configurable: true });
  window.HTMLMediaElement.prototype.pause = vi.fn();
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
    for (const uri of ['ui://cinegen/media-viewer-v1.html', 'ui://cinegen/media-viewer-v2.html', 'ui://cinegen/media-viewer-v3.html', 'ui://cinegen/media-viewer-v4.html', 'ui://cinegen/media-viewer-v5.html', 'ui://cinegen/media-viewer-v6.html']) {
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

  it('revalidates a cached running batch while its detail is open and shows the finished video', async () => {
    const view = mount(); await view.initialize();
    const running = { ...page, mode: 'batch', items: [{ id: 'video-job', title: 'Seedance 2.5', kind: 'video', status: 'running', url: null, createdAt: new Date(Date.now() - 85000).toISOString() }], total: 1,
      refresh: { name: 'cinegen_show_generation_batch', arguments: { projectId: 'fixture', jobs: [{ requestId: 'existing-paid-job' }] } } };
    view.send({ method: 'ui/notifications/tool-result', params: { structuredContent: running } });
    (view.document.querySelector('.tile-preview') as HTMLButtonElement).click();
    expect(view.document.querySelector('.selection-bar')).toBeNull();
    expect(view.document.querySelector('.result-player .generation-label-text')?.textContent).toBe('Generating');
    expect(view.document.querySelector('.generation-clock')?.textContent).toBe('1:25');
    expect(view.document.querySelector('.result-player .generation-prism')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    const calls = () => view.host.postMessage.mock.calls.filter(([m]) => m.method === 'tools/call');
    expect(calls()).toHaveLength(1);
    expect(calls()[0][0].params).toEqual({ name: running.refresh.name, arguments: running.refresh.arguments });
    const done = { ...running, items: [{ ...running.items[0], status: 'complete', url: 'https://firebasestorage.googleapis.com/finished.mp4', previewUrl: 'https://firebasestorage.googleapis.com/finished.mp4' }] };
    view.send({ id: calls()[0][0].id, result: { structuredContent: done } });
    await vi.advanceTimersByTimeAsync(0);
    expect(view.document.querySelector('.detail video')?.getAttribute('src')).toContain('finished.mp4');
    expect(view.document.querySelector('.generation-loading')).toBeNull();
    expect(view.document.querySelector('.generation-clock')).toBeNull();
    expect(view.document.querySelector('.status')?.textContent).toBe('Ready');
    const video = view.document.querySelector('video');
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    view.window.dispatchEvent(new view.window.Event('pageshow'));
    expect(calls()).toHaveLength(2);
    view.send({ id: calls()[1][0].id, result: { structuredContent: done } }); await vi.advanceTimersByTimeAsync(0);
    expect(view.document.querySelector('video')).toBe(video);
    expect(view.host.postMessage.mock.calls.some(([m]) => m.params?.name === 'cinegen_generate')).toBe(false);
  });

  it('keeps elapsed time across polls and backgrounding without rebuilding the player or making extra requests', async () => {
    const view = mount(); vi.setSystemTime(new Date('2026-09-07T16:00:00Z')); await view.initialize();
    const data = { ...page, mode: 'job', items: [{ id: 'elapsed-video', title: 'Seedance 2.5', kind: 'video', status: 'running', url: null,
      createdAt: '2026-09-06T10:00:00Z', startedAt: Date.now() - 125000 }], total: 1,
      refresh: { name: 'cinegen_job_display', arguments: { nodeId: 'elapsed-video' } } };
    view.send({ method: 'ui/notifications/tool-result', params: { structuredContent: data } });
    const clock = view.document.querySelector('.generation-clock') as HTMLTimeElement;
    const player = view.document.querySelector('.result-player');
    expect(clock.textContent).toBe('2:05');
    await vi.advanceTimersByTimeAsync(1000);
    expect(clock.textContent).toBe('2:06');
    const calls = () => view.host.postMessage.mock.calls.filter(([m]) => m.method === 'tools/call');
    expect(calls()).toHaveLength(1);
    view.send({ id: calls()[0][0].id, result: { structuredContent: data } }); await vi.advanceTimersByTimeAsync(0);
    expect(view.document.querySelector('.generation-clock')).toBe(clock);
    expect(view.document.querySelector('.result-player')).toBe(player);
    expect(clock.closest('[role="timer"]')?.getAttribute('aria-live')).toBe('off');
    Object.defineProperty(view.document, 'visibilityState', { value: 'hidden', configurable: true });
    view.document.dispatchEvent(new view.window.Event('visibilitychange'));
    vi.setSystemTime(Date.now() + 61 * 60000);
    expect(clock.textContent).toBe('2:06');
    Object.defineProperty(view.document, 'visibilityState', { value: 'visible', configurable: true });
    view.document.dispatchEvent(new view.window.Event('visibilitychange'));
    expect(clock.textContent).toBe('1:03:06'); expect(clock.dateTime).toBe('PT3786S');
    view.send({ id: 'teardown-elapsed', method: 'ui/resource-teardown', params: {} });
    const count = calls().length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(clock.textContent).toBe('1:03:06'); expect(calls()).toHaveLength(count);
  });

  it.each([undefined, 'invalid-date', '2026-09-07T17:00:00Z'])('handles absent, invalid and future job times: %s', async createdAt => {
    const view = mount(); vi.setSystemTime(new Date('2026-09-07T16:00:00Z')); await view.initialize();
    view.send({ method: 'ui/notifications/tool-result', params: { structuredContent: { ...page, mode: 'job', total: 1,
      items: [{ id: 'video-time', title: 'Seedance 2.5', kind: 'video', status: 'saving', url: null, createdAt }],
      refresh: { name: 'cinegen_job_display', arguments: { nodeId: 'video-time' } },
    } } });
    expect(view.document.querySelector('.generation-clock')?.textContent ?? null).toBe(createdAt?.startsWith('2026') ? '0:00' : null);
    expect(view.document.querySelector('.generation-label-text')?.textContent).toBe('Saving to CineGen');
  });

  it.each([
    ['queued', 'Queued'], ['submitting', 'Starting'], ['saving', 'Saving to CineGen'],
    ['pending', null], ['failed', null], ['needs_attention', null], ['complete', null],
  ])('only animates a video awaiting output: %s', async (status, label) => {
    const view = mount(); await view.initialize();
    view.send({ method: 'ui/notifications/tool-result', params: { structuredContent: {
      ...page, mode: 'job', items: [{ id: 'video-job', title: 'Seedance 2.5', kind: 'video', status, url: null }], total: 1,
      refresh: { name: 'cinegen_job_display', arguments: { nodeId: 'video-job' } },
    } } });
    expect(view.document.querySelector('.generation-loading')?.textContent ?? null).toBe(label);
  });

  it('keeps result information collapsed and expands it without replacing or pausing the player', async () => {
    const view = mount(); await view.initialize({ platform: 'mobile' });
    const item = { id: 'film', kind: 'video', title: 'Seedance 2.5', status: 'complete', model: 'Seedance 2.5', provider: 'topview',
      prompt: 'A camera moves through the scene.', resolution: '1080', aspectRatio: '16:9', duration: 30,
      url: 'https://firebasestorage.googleapis.com/film.mp4', previewUrl: 'https://firebasestorage.googleapis.com/film.mp4',
      references: [{ title: 'Vehicle', kind: 'image', url: 'https://firebasestorage.googleapis.com/car.png', previewUrl: 'https://firebasestorage.googleapis.com/car.png' }] };
    view.send({ method: 'ui/notifications/tool-result', params: { structuredContent: { ...page, mode: 'job', items: [item], total: 1,
      projectUrl: 'https://cinegen-film.vercel.app/', refresh: { name: 'cinegen_job_display', arguments: { nodeId: 'film' } } } } });
    const video = view.document.querySelector('video')!;
    video.currentTime = 12;
    const pause = vi.spyOn(video, 'pause');
    const toggles = [...view.document.querySelectorAll<HTMLButtonElement>('.result-toggle')];
    expect(toggles.map(button => button.getAttribute('aria-expanded'))).toEqual(['false', 'false', 'false']);
    expect([...view.document.querySelectorAll<HTMLElement>('.result-panel')].every(panel => panel.hidden)).toBe(true);
    for (const toggle of toggles) {
      toggle.click();
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(view.document.getElementById(toggle.getAttribute('aria-controls')!)?.hidden).toBe(false);
      expect(view.document.querySelectorAll('.result-panel:not([hidden])')).toHaveLength(1);
      expect(view.document.querySelector('video')).toBe(video);
      expect(video.currentTime).toBe(12);
    }
    expect(pause).not.toHaveBeenCalled();
    expect(view.document.querySelector('.result-facts')?.textContent).toContain('1080');
    expect(view.document.querySelector('.result-actions')?.textContent).toContain('Open video');
    toggles[2].click(); expect(view.document.querySelectorAll('.result-panel:not([hidden])')).toHaveLength(0);
    expect(view.host.postMessage.mock.calls.some(([m]) => m.method === 'tools/call')).toBe(false);
  });

  it('keeps checking beyond five minutes, retries connection failures, and resumes after backgrounding', async () => {
    const view = mount(); await view.initialize();
    const running = { ...page, items: [{ ...page.items[0], status: 'running' }] };
    view.send({ method: 'ui/notifications/tool-result', params: { structuredContent: running } });
    const calls = () => view.host.postMessage.mock.calls.filter(([m]) => m.method === 'tools/call');
    for (let i = 0; i < 43; i++) {
      await vi.advanceTimersByTimeAsync(i ? 8000 : 1);
      expect(calls()).toHaveLength(i + 1);
      view.send({ id: calls().at(-1)[0].id, ...(i === 2 ? { error: { message: 'Network lost' } } : { result: { structuredContent: running } }) });
      await vi.advanceTimersByTimeAsync(0);
    }
    Object.defineProperty(view.document, 'visibilityState', { value: 'hidden', configurable: true });
    await vi.advanceTimersByTimeAsync(16000); expect(calls()).toHaveLength(43);
    Object.defineProperty(view.document, 'visibilityState', { value: 'visible', configurable: true });
    view.document.dispatchEvent(new view.window.Event('visibilitychange')); expect(calls()).toHaveLength(44);
  });

  it('lets mobile hosts expand to the full document instead of trapping details in nested scrolling', async () => {
    const view = mount(); await view.initialize({ platform: 'mobile' }); view.result();
    const sizes = view.host.postMessage.mock.calls.filter(([m]) => m.method === 'ui/notifications/size-changed');
    expect(sizes.at(-1)[0].params.height).toBe(800);
    const content = view.document.querySelector('.content')!;
    expect(view.window.getComputedStyle(content).overflowY).not.toBe('auto');
    expect(view.window.getComputedStyle(view.document.documentElement).overflowY).toBe('auto');
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
    const content = () => view.document.documentElement;
    expect(view.document.querySelector('.content')?.hasAttribute('tabindex')).toBe(false);
    content().scrollTop = 217;
    (view.document.querySelectorAll('.card-view')[3] as HTMLButtonElement).click();
    expect(view.document.querySelectorAll('.card.is-selected')).toHaveLength(1);
    expect(content().scrollTop).toBe(217);
    expect(view.document.querySelector('.card-use')?.textContent).toBe('Use');
    expect(view.document.querySelector('.selection-bar')).toBeNull();
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
    (view.document.querySelector('.card-use') as HTMLButtonElement).click();
    const message = view.host.postMessage.mock.calls.find(([m]) => m.method === 'ui/message')?.[0];
    const selection = JSON.parse(message.params.content[0].text.split('\n').at(-1));
    expect(selection.selections.map((item: any) => item.imageId)).toEqual(['reference-2']);
    expect(selection.generationAuthorized).toBe(false);
    expect(view.host.postMessage.mock.calls.some(([m]) => m.method === 'tools/call')).toBe(false);
    view.send({ id: message.id, result: {} }); await vi.advanceTimersByTimeAsync(0);
    expect(view.document.querySelectorAll('.is-selected')).toHaveLength(0);
  });
  it('loads subsequent rows on scroll without a click or replacing the active scroller', async () => {
    const view = mount(); await view.initialize();
    const items = Array.from({ length: 27 }, (_, i) => ({ ...page.items[0], id: `ref-${i}`, title: `Reference ${i}` }));
    const data = { ...page, items: items.slice(0, 9), total: 27, limit: 9, hasMore: true };
    view.send({ method: 'ui/notifications/tool-result', params: { structuredContent: data } });
    const content = view.document.documentElement;
    Object.defineProperties(content, { clientHeight: { value: 400 }, scrollHeight: { value: 800, configurable: true } });
    content.scrollTop = 280;
    view.window.dispatchEvent(new view.window.Event('scroll'));
    view.window.dispatchEvent(new view.window.Event('scroll'));
    const calls = () => view.host.postMessage.mock.calls.filter(([m]) => m.method === 'tools/call');
    expect(calls()).toHaveLength(1);
    expect(calls()[0][0].params.arguments).toMatchObject({ offset: 9, limit: 9, elementIds: ['charger'] });
    Object.defineProperty(content, 'scrollHeight', { value: 1200, configurable: true });
    view.send({ id: calls()[0][0].id, result: { structuredContent: { ...data, items: items.slice(9, 18), offset: 9 } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(view.document.querySelectorAll('.card')).toHaveLength(18);
    expect(view.document.documentElement).toBe(content);
    expect(content.scrollTop).toBe(280);
    expect(view.document.querySelector('.pagination')).toBeNull();
    content.scrollTop = 730; view.window.dispatchEvent(new view.window.Event('scroll'));
    expect(calls()).toHaveLength(2);
    expect(calls()[1][0].params.arguments.offset).toBe(18);
    view.send({ id: calls()[1][0].id, result: { structuredContent: { ...data, items: items.slice(18), offset: 18, hasMore: false } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(view.document.querySelectorAll('.card')).toHaveLength(27);
    expect(view.document.querySelector('.library-count')?.textContent).toBe('27 of 27');
    view.window.dispatchEvent(new view.window.Event('scroll')); expect(calls()).toHaveLength(2);
  });
  it('keeps failed loading retryable and ignores an old page after changing collections', async () => {
    const view = mount(); await view.initialize();
    const data = { ...page, hasMore: true, total: 30 };
    view.send({ method: 'ui/notifications/tool-result', params: { structuredContent: data } });
    const content = view.document.documentElement;
    Object.defineProperties(content, { clientHeight: { value: 400 }, scrollHeight: { value: 410 } });
    content.scrollTop = 5;
    view.window.dispatchEvent(new view.window.Event('scroll'));
    const calls = () => view.host.postMessage.mock.calls.filter(([m]) => m.method === 'tools/call');
    view.send({ id: calls()[0][0].id, error: { message: 'Connection lost' } }); await vi.advanceTimersByTimeAsync(0);
    view.window.dispatchEvent(new view.window.Event('scroll')); expect(calls()).toHaveLength(1);
    expect(view.document.querySelector('.library-footer')?.textContent).toContain('Retry');
    (view.document.querySelector('.library-footer button') as HTMLButtonElement).click();
    expect(calls()).toHaveLength(2);
    view.send({ method: 'ui/notifications/tool-result', params: { structuredContent: { ...page, items: [page.items[0]], total: 1 } } });
    view.send({ id: calls()[1][0].id, result: { structuredContent: { ...data, items: page.items, offset: 7 } } }); await vi.advanceTimersByTimeAsync(0);
    expect(view.document.querySelectorAll('.card')).toHaveLength(1);
  });
  it('uses an Element’s full active look instead of treating its cover as the selected reference', async () => {
    const view = mount(); await view.initialize({}, { message: { text: {} } });
    const item = { ...page.items[0], elementCard: true, elementId: 'charger', variationId: 'weathered', referenceCount: 3,
      references: page.items.slice(0, 3).map(item => ({ id: item.id, imageId: item.imageId, url: item.url })) };
    view.send({ method: 'ui/notifications/tool-result', params: { structuredContent: { ...page, items: [item], total: 1 } } });
    (view.document.querySelector('.card-view') as HTMLButtonElement).click();
    expect(view.document.querySelector('.element-gallery')).not.toBeNull();
    (view.document.querySelector('.element-actions .primary') as HTMLButtonElement).click();
    const request = view.host.postMessage.mock.calls.find(([m]) => m.method === 'ui/message')?.[0];
    const selection = JSON.parse(request.params.content[0].text.split('\n').at(-1));
    expect(selection.selections[0]).toMatchObject({ elementId: 'charger', variationId: 'weathered', url: null });
    expect(selection.selections[0].referenceImages.map((ref: any) => ref.imageId)).toEqual(['reference-0', 'reference-1', 'reference-2']);
    expect(selection.generationAuthorized).toBe(false);
  });
  it('browses all Element images with arrows, thumbnails and keyboard while preserving the active reference pack', async () => {
    const view = mount(); await view.initialize({}, { message: { text: {} } });
    const images = page.items.map((item, index) => ({ ...item, variationId: index < 3 ? 'hero' : 'weathered', variationName: index < 3 ? 'Hero' : 'Weathered' }));
    const item = { ...page.items[0], elementCard: true, variationId: 'hero', variationName: 'Hero', referenceCount: 3, references: images.slice(0, 3), galleryImages: images };
    view.send({ method: 'ui/notifications/tool-result', params: { structuredContent: { ...page, items: [item], total: 1 } } });
    const click = (selector: string) => (view.document.querySelector(selector) as HTMLButtonElement).click();
    const count = () => view.document.querySelector('.gallery-count')?.textContent;
    click('.card-view'); expect(count()).toBe('1 / 7');
    expect(view.document.querySelectorAll('.gallery-thumbnail')).toHaveLength(7);
    click('[aria-label="Previous image"]'); expect(count()).toBe('7 / 7');
    expect(view.document.querySelector('.gallery-look')?.textContent).toBe('Weathered');
    click('[aria-label="Next image"]'); expect(count()).toBe('1 / 7');
    click('[aria-label="View image 4 · Weathered"]'); expect(count()).toBe('4 / 7');
    view.document.querySelector('.gallery-stage')?.dispatchEvent(new view.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(count()).toBe('5 / 7');
    expect(view.document.querySelectorAll('.gallery-picture img')[4]?.getAttribute('src')).toBe(images[4].previewUrl);
    expect(view.document.querySelector('.element-use-note')?.textContent).toContain('3 references from Hero');
    click('.use-gallery-image');
    const message = view.host.postMessage.mock.calls.find(([m]) => m.method === 'ui/message')?.[0];
    const selection = JSON.parse(message.params.content[0].text.split('\n').at(-1));
    expect(selection.selections[0]).toMatchObject({ imageId: 'reference-4', variationId: 'weathered', url: images[4].url });
    expect(selection.generationAuthorized).toBe(false);
    view.send({ id: message.id, result: {} }); await vi.advanceTimersByTimeAsync(0);
    expect(count()).toBe('5 / 7');
    click('.back'); click('.card-view'); expect(count()).toBe('5 / 7');
    expect(view.host.postMessage.mock.calls.some(([m]) => m.method === 'tools/call')).toBe(false);
  });
  it('updates the selected reference from native horizontal scrolling without a pointer-down or focus click', async () => {
    const view = mount(); await view.initialize();
    const item = { ...page.items[0], elementCard: true, references: page.items, galleryImages: page.items };
    view.send({ method: 'ui/notifications/tool-result', params: { structuredContent: { ...page, items: [item], total: 1 } } });
    (view.document.querySelector('.card-view') as HTMLButtonElement).click();
    const picture = view.document.querySelector('.gallery-picture') as HTMLElement;
    Object.defineProperty(picture, 'clientWidth', { value: 300 });
    const count = () => view.document.querySelector('.gallery-count')?.textContent;
    picture.scrollLeft = 300; picture.dispatchEvent(new view.window.Event('scroll')); expect(count()).toBe('2 / 7');
    view.document.querySelector('.content')?.dispatchEvent(new view.window.Event('scroll')); expect(count()).toBe('2 / 7');
    picture.scrollLeft = 1190; picture.dispatchEvent(new view.window.Event('scroll')); expect(count()).toBe('5 / 7');
    expect(view.document.querySelectorAll('.gallery-thumbnail')[4].getAttribute('aria-pressed')).toBe('true');
    expect(view.document.activeElement).not.toBe(picture);
    (view.document.querySelector('[aria-label="Next image"]') as HTMLButtonElement).click();
    expect(picture.scrollLeft).toBe(1500); expect(count()).toBe('6 / 7');
  });
  it('handles single, unavailable and empty Element images without trapping navigation', async () => {
    const view = mount(); await view.initialize();
    const show = (images: any[]) => { const item = { ...page.items[0], elementCard: true, galleryImages: images, references: images, referenceCount: images.length }; view.send({ method: 'ui/notifications/tool-result', params: { structuredContent: { ...page, items: [item], total: 1 } } }); if (view.document.querySelector('.card-view')) (view.document.querySelector('.card-view') as HTMLButtonElement).click(); };
    show([page.items[0]]);
    expect(view.document.querySelector('[aria-label="Next image"]')?.hasAttribute('hidden')).toBe(true);
    show([page.items[0], { ...page.items[1], url: null, previewUrl: null }]);
    (view.document.querySelector('[aria-label="Next image"]') as HTMLButtonElement).click();
    expect(view.document.querySelector('.use-gallery-image')?.hasAttribute('disabled')).toBe(true);
    (view.document.querySelector('[aria-label="Previous image"]') as HTMLButtonElement).click();
    expect(view.document.querySelector('.use-gallery-image')?.hasAttribute('disabled')).toBe(false);
    view.document.querySelector('.gallery-picture img')?.dispatchEvent(new view.window.Event('error'));
    expect(view.document.querySelector('.gallery-picture')?.textContent).toContain('Preview unavailable');
    expect(view.document.querySelector('[aria-label="Next image"]')).not.toBeNull();
    show([]); expect(view.document.querySelector('.element-gallery')?.textContent).toContain('no images yet');
    expect(view.document.querySelector('.use-gallery-image')?.hasAttribute('disabled')).toBe(true);
  });
});
