import { MEDIA_RESOURCE_URI, MEDIA_MIME_TYPE, MEDIA_DOMAINS } from './display-tools.mjs';

import { MEDIA_VIEWER_SCRIPT } from './media-viewer-script.mjs';

import { css } from './media-viewer-styles.mjs';

const meta = {
  ui: { prefersBorder: false, permissions: { clipboardWrite: {} }, csp: { connectDomains: [], resourceDomains: MEDIA_DOMAINS } },
  'openai/widgetDescription': 'CineGen creative library: browse media and Elements, review exact batches, choose film presets, send selections to chat, or add saved references to a Studio Space. No generation starts from this widget.',
  'openai/widgetPrefersBorder': false, 'openai/widgetCSP': { connect_domains: [], resource_domains: MEDIA_DOMAINS },
};
export const MEDIA_RESOURCE = { uri: MEDIA_RESOURCE_URI, name: 'CineGen creative library', description: 'Interactive media, references, film presets and batch review.', mimeType: MEDIA_MIME_TYPE, _meta: meta };
export function readMediaResource(uri) {
  if (![MEDIA_RESOURCE_URI, 'ui://cinegen/media-viewer-v17.html', 'ui://cinegen/media-viewer-v16.html', 'ui://cinegen/media-viewer-v15.html', 'ui://cinegen/media-viewer-v14.html', 'ui://cinegen/media-viewer-v13.html', 'ui://cinegen/media-viewer-v12.html', 'ui://cinegen/media-viewer-v11.html', 'ui://cinegen/media-viewer-v10.html', 'ui://cinegen/media-viewer-v9.html', 'ui://cinegen/media-viewer-v8.html', 'ui://cinegen/media-viewer-v7.html', 'ui://cinegen/media-viewer-v6.html', 'ui://cinegen/media-viewer-v5.html', 'ui://cinegen/media-viewer-v4.html', 'ui://cinegen/media-viewer-v3.html', 'ui://cinegen/media-viewer-v2.html', 'ui://cinegen/media-viewer-v1.html'].includes(uri)) throw new Error('Unknown CineGen UI resource.');
  return { contents: [{ uri, mimeType: MEDIA_MIME_TYPE, _meta: meta, text: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>CineGen Creative Library</title><style>${css}</style></head><body><main id="app"><div class="brand">CINEGEN</div><p class="loading" role="status">Loading your library…</p><div class="skeleton"></div></main><script>${MEDIA_VIEWER_SCRIPT}</script></body></html>` }] };
}
