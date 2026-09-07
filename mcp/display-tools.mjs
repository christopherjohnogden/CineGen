export const MEDIA_RESOURCE_URI = 'ui://cinegen/media-viewer-v1.html';
export const MEDIA_MIME_TYPE = 'text/html;profile=mcp-app';
export const DISPLAY_INSTRUCTIONS = 'Use cinegen_show_reference_elements to visually show Elements, cinegen_show_generations to browse images/videos, and cinegen_job_display to show one result. These read-only tools render inline galleries and video players in MCP Apps-compatible clients; they never generate or spend credits. Prefer them when the user asks to see, preview, watch, or review media. Other clients receive readable media links. Refresh the connector tool index if these display tools are missing.';

const id = { type: 'string', minLength: 1, maxLength: 160 };
const ids = { type: 'array', items: id, minItems: 1, maxItems: 24, uniqueItems: true };
const page = { offset: { type: 'integer', minimum: 0, default: 0 }, limit: { type: 'integer', minimum: 1, maximum: 24, default: 12 } };
const metadata = {
  ui: { resourceUri: MEDIA_RESOURCE_URI, visibility: ['model', 'app'] },
  'openai/outputTemplate': MEDIA_RESOURCE_URI,
  'openai/widgetAccessible': true,
  'openai/toolInvocation/invoking': 'Opening CineGen media…',
  'openai/toolInvocation/invoked': 'CineGen media ready',
};
export const DISPLAY_TOOLS = [
  {
    name: 'cinegen_show_generations', title: 'Show CineGen generations',
    description: 'Display an inline gallery of saved CineGen images and videos, with playback, prompts and accurate generation/saving status. Browses all Spaces unless spaceId is supplied. Use nodeIds to show specific results. Read-only: never starts generation or retries saving. Use when the user asks to see, watch, preview or review their results.',
    inputSchema: { type: 'object', properties: { spaceId: id, nodeIds: ids, kind: { type: 'string', enum: ['image', 'video'] }, ...page }, additionalProperties: false },
  },
  {
    name: 'cinegen_show_reference_elements', title: 'Show CineGen Elements',
    description: 'Display the CineGen Elements reference library as an inline image gallery, including characters, locations, props, vehicles and their saved looks. Filter by elementIds, type or search. This only views existing references; it never edits Elements or generates media.',
    inputSchema: { type: 'object', properties: { elementIds: ids, type: { type: 'string', enum: ['character', 'location', 'prop', 'vehicle'] }, search: { type: 'string', maxLength: 200 }, ...page }, additionalProperties: false },
  },
  {
    name: 'cinegen_job_display', title: 'View CineGen result',
    description: 'Show one CineGen image or video in an inline viewer with playback, prompt and job status. Supply nodeId from a generation response, or requestId for a durable cloud job (requestId lookup requires the remote server; local desktop uses nodeId). Read-only: never generates, spends credits or resumes saving. Use cinegen_get_jobs separately when a save retry is wanted.',
    inputSchema: { type: 'object', properties: { nodeId: id, requestId: id, spaceId: id }, anyOf: [{ required: ['nodeId'] }, { required: ['requestId'] }], additionalProperties: false },
  },
].map(tool => ({ ...tool, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: metadata }));

export const isDisplayTool = name => DISPLAY_TOOLS.some(tool => tool.name === name);

// Remote MCP clients cannot read device-local files or authenticated app routes.
// Never leak those paths or fetch arbitrary URLs from the server just to display them.
export function displayUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') return null;
    const host = url.hostname.toLowerCase();
    if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) return null;
    return url.href;
  } catch { return null; }
}

export const MEDIA_DOMAINS = [
  'https://firebasestorage.googleapis.com', 'https://storage.googleapis.com',
  'https://cinegen-film.vercel.app', 'https://cinegen-kappa.vercel.app',
  'https://cinegen-api.christopherjohnogden.workers.dev',
  'https://*.cloudfront.net', 'https://*.topview.ai', 'https://*.higgsfield.ai',
  'https://*.fal.media',
];
export function previewUrl(value) {
  const url = displayUrl(value);
  if (!url) return null;
  const origin = new URL(url).origin;
  return MEDIA_DOMAINS.some(domain => domain.includes('*.')
    ? origin.endsWith(domain.slice(domain.indexOf('*') + 1))
    : origin === domain) ? url : null;
}

export function displayResult(data) {
  const escape = value => String(value ?? '').replace(/[\[\]<>\n\r]/g, ' ');
  const lines = [String(data.title), `${data.total} item${data.total === 1 ? '' : 's'}${data.total > data.items.length ? ` · showing ${data.offset + 1}–${data.offset + data.items.length}` : ''}.`];
  for (const item of data.items) {
    lines.push(`${escape(item.title)} — ${escape(item.status)}${item.spaceName ? ` · ${escape(item.spaceName)}` : ''}${item.error ? `: ${escape(item.error)}` : ''}`);
    if (item.url) lines.push(`[Open ${item.kind === 'video' ? 'video' : 'image'}](<${item.url.replace(/[<>]/g, encodeURIComponent)}>)`);
    else lines.push(item.unavailableReason || 'No saved media is available yet.');
  }
  if (!data.items.length) lines.push('No matching media found.');
  return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: data };
}
