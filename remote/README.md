# CineGen remote MCP

Live endpoint: https://cinegen-remote.christopherjohnogden.workers.dev/mcp

Add a custom connector in Claude's web settings and sign in with the same CineGen Cloud email/password used by the app and website. The connector can then be used from Claude mobile. ChatGPT requires an account/workspace that supports custom MCP connections. Connector availability and inline UI support depend on the host and device.

Sync local or Sites-only projects to CineGen Cloud first. Remote edits use Firebase user permissions and save to the same project revision format and shared Elements library. Reopen a project to read remote changes. Optimistic revision checks reject stale writes.

Tools support project creation/listing, script and Director data edits, Elements, Spaces, assets and timelines, plus Topview and explicitly requested Higgsfield image/video jobs. Generation uses the existing provider connections in the CineGen website; no fal key is needed. Topview is the default. Higgsfield is never selected automatically, including after a Topview failure. Jobs continue through Durable Object alarms after the client closes and save media to Firebase Storage. Retry a generation with the same requestId to avoid duplicate submissions. Ambiguous paid submissions stop for inspection in fal.ai history.

Desktop export/rendering, arbitrary Canvas execution, Director batch generation are not implemented remotely. References must already exist in project assets or Elements. Project edits are capped at 8 MiB of serialized state and generated uploads at 90 MiB. Old remote revisions are retained; monitor Firestore storage for heavily edited projects.

## Operations

- `npm ci && npm test && npm run build` in this directory.
- Deploy `dist/worker.js` with the bindings in `wrangler.jsonc` to the existing Worker. Keep the existing OAuth KV namespace and Durable Object migration history.
- `OAUTH_KV` stores OAuth registrations and encrypted connection grants. `JOBS` stores active job credentials and removes credentials on terminal status.
- `ALLOWED_EMAILS` is an explicit server-side allowlist. It does not grant Firebase project permissions.
- No Firebase admin key is used. Tokens are checked against the CineGen Firebase project, and user-authenticated Firestore/Storage requests enforce existing rules.
- Disconnect in the assistant to revoke its OAuth grant. Already queued jobs finish using their saved connection unless the Firebase session or provider key is revoked.

Tests cover MCP protocol calls, native snapshot read-back, shared library concurrency guards, argument validation, ambiguous submission handling and a simulated full background generation. Live discovery/unauthenticated access/consent were checked; real user sign-in and paid generation require the user's connection.

## Spaces Studio creation

Use `cinegen_studio_create` to prepare Studio items without starting generation or spending credits. Supply a prompt, optional destination `spaceId`, model name/node type, `inputs` keyed by model field IDs, and optional Element names. Remote calls also require `projectId`. Use `cinegen_list_node_types` to discover preparation models and controls. These items carry Studio metadata, retain their prompt and settings, and can be placed on Canvas later.

Use `cinegen_generate` for actual Studio generation. Remote unattended generation uses Topview by default. Pass `provider: "higgsfield"` only when the user explicitly requests it. `cinegen_list_models` reads the connected provider catalog. Legacy fal jobs already queued before this change can finish, but new fal jobs are not exposed. `cinegen_nodes` remains the explicit Canvas creation path. Reconnect the MCP client to refresh its tool list after an update.

## Creative library and inline displays (server 1.5.0)

- `cinegen_show_media`: the full project asset library plus Canvas uploads, including desktop imports. Image/video/audio filters, search, asset IDs, folders and pagination.
- `cinegen_show_reference_elements`: Element reference images and continuity looks, with exact Element/variation/image IDs.
- `cinegen_show_generations`: image/video results across Spaces.
- `cinegen_show_generation_batch`: up to 24 exact `jobs` entries, in caller order. Each accepts `nodeId` or cloud `requestId`, plus optional zero-based `generationIndex`. Missing entries retain their slots; failed results remain visible. `allFound` covers the whole requested batch, including pages not currently visible.
- `cinegen_job_display`: one result by node ID or durable request ID. Durable status takes precedence over stale node state.
- `cinegen_show_film_presets`: 12 illustrated shot, camera and lighting directions, with category/search filters and reusable prompt fragments. Diagrams are composition guides, not provider-generated examples.
- `cinegen_send_to_studio`: a separate saved edit. Accepts `itemIds` from a viewer and a destination `spaceId`; resolves media against the authorized project, adds image/video references to its Studio feed, and reuses existing copies. It never generates or spends credits. Audio/presets can be handed to the assistant instead.

Cloud calls require `projectId`. Display tools return readable text and `structuredContent` and advertise `ui://cinegen/media-viewer-v4.html` through `_meta.ui.resourceUri` and `openai/outputTemplate`. Both transports implement resources/list and resources/read. The stdio server version is 0.5.0. Cached v1/v2/v3 resource URIs also return the fixed viewer.

The browser script is compiled separately by `scripts/build-mcp-viewer.mjs`, then embedded as a string. Both MCP build commands rebuild it automatically. Do not serialize a server function into HTML: Wrangler's name-preserving transform injects server-scope helpers that are unavailable inside the iframe. Startup regression tests run the resource after both minification and name preservation, including delayed/missing tool results and legacy ChatGPT globals. Missing connections/results show an error after 20 seconds, and late valid data can still recover the viewer.

The widget uses a thumbnail picker with two columns on phones, three on medium widths, and four on desktop. Tapping a thumbnail selects it; the separate preview button opens full media and details. Returning from preview preserves the gallery scroll position. A bounded, keyboard-focusable region supports touch/wheel scrolling, with a visible scroll cue and pagination. It honors MCP host container height limits and constrains itself to the actual iframe height even when the host clips it. Header controls and the selection bar stay visible; Studio destination controls expand only when requested. The widget includes separate media/Elements/results/presets collections, video/audio playback, copy/use prompt actions, input references and available dimensions, aspect ratio, resolution and duration. It prefers existing cloud thumbnails/posters and lazily loads visible video cards; sources without a separate preview retain their original media. It does not create thumbnail files or download originals on the server for display.

Selections retain their exact media URL, asset/node/take IDs and Element look. Standard hosts receive `ui/update-model-context` when supported plus a `ui/message` with the full selection; legacy ChatGPT hosts use `sendFollowUpMessage`. Selection prepares the next request and does not itself authorize a paid render. Unsupported hosts get a copyable selection, and rejected messages keep the selection for retry. The only widget tool that changes project state is `cinegen_send_to_studio`, explicitly annotated as a mutation and saved through the existing cloud revision checks. Browsing and refresh are read-only, including durable job snapshots; they never resume a save or call a provider.

Active work refreshes every eight seconds while visible, up to forty checks; opening a gallery detail pauses polling. Use `cinegen_get_jobs` separately for an explicit save retry. Topview remains the default and Higgsfield requires an explicit user request.

Project data uses the existing OAuth and Firebase authorization. UI resources contain no account data or credentials. Local paths are omitted; media must sync before chat can use it. Previews load only from declared provider/storage domains; other HTTPS sources have an Open media action. No arbitrary-URL proxy is introduced.

After an update, refresh/reconnect the CineGen connector and start a fresh chat if the old chat retains cached tools. Widget rendering and selection support depend on the host: [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview). The cloud Worker update does not require a Mac reinstall; local stdio handlers need an app build containing the changes.
