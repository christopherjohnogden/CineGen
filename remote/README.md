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

## Creative library and inline displays (server 1.6.3)

- `cinegen_show_media`: the full project asset library plus Canvas uploads, including desktop imports. Image/video/audio filters, search, asset IDs, folders and pagination.
- `cinegen_show_reference_elements`: Element reference images and continuity looks, with exact Element/variation/image IDs.
- `cinegen_show_generations`: image/video results across Spaces.
- `cinegen_show_generation_batch`: up to 24 exact `jobs` entries, in caller order. Each accepts `nodeId` or cloud `requestId`, plus optional zero-based `generationIndex`. Missing entries retain their slots; failed results remain visible. `allFound` covers the whole requested batch, including pages not currently visible.
- `cinegen_job_display`: one result by node ID or durable request ID. Durable status takes precedence over stale node state.
- `cinegen_show_film_presets`: 12 illustrated shot, camera and lighting directions, with category/search filters and reusable prompt fragments. Diagrams are composition guides, not provider-generated examples.
- `cinegen_send_to_studio`: a separate saved edit. Accepts `itemIds` from a viewer and a destination `spaceId`; resolves media against the authorized project, adds image/video references to its Studio feed, and reuses existing copies. It never generates or spends credits. Audio/presets can be handed to the assistant instead.

Cloud calls require `projectId`. Display tools return readable text and `structuredContent` and advertise `ui://cinegen/media-viewer-v8.html` through `_meta.ui.resourceUri` and `openai/outputTemplate`. Both transports implement resources/list and resources/read. The stdio server version is 0.6.3. Cached v1/v2/v3/v4/v5/v6/v7 resource URIs also return the fixed viewer.

The browser script is compiled separately by `scripts/build-mcp-viewer.mjs`, then embedded as a string. Both MCP build commands rebuild it automatically. Do not serialize a server function into HTML: Wrangler's name-preserving transform injects server-scope helpers that are unavailable inside the iframe. Startup regression tests run the resource after both minification and name preservation, including delayed/missing tool results and legacy ChatGPT globals. Missing connections/results show an error after 20 seconds, and late valid data can still recover the viewer.

The picker uses a three-column thumbnail grid with names/types over images and a gold Use action on selected media. It loads nine items at a time and appends more rows near the bottom without replacing the scroll container, so touch and wheel scrolling continue without a click. A failed page load offers a retry while keeping the already loaded items. Tapping an Element opens all its saved images in a larger gallery with native horizontal scroll snapping for touch and trackpads, optional wrapping arrows and keyboard navigation, an image count, and a scrollable thumbnail strip. Vertical gestures continue to scroll the details; the gallery does not capture pointers or require focus first. Elements default to one card per Element with its active look; `view: "images"` and `elementIds` expose individual references and other saved looks. Using an Element sends its full active reference pack (exact image IDs/URLs and variation ID), not just its cover. The gallery keeps Use Element scoped to that active pack; Use this image sends only the currently viewed image and its own look. Select individual references opens the reference grid for multiple selection or sending images to Studio. Other galleries retain exact asset/node/take selection.

The collection title opens navigation and optional multi-selection; the search icon reveals filters. The widget uses native document scrolling, with no nested vertical scroll region or focus requirement. Mobile hosts receive the full content height so the chat can scroll through details; fixed host size limits are honored using the iframe document scroll. Preview/back preserves position. More rows append automatically near the bottom of a constrained viewport; expanded hosts also have a Load more control. Media playback, copy/use prompt actions and input references remain in the detailed view. Previews prefer cloud thumbnails/posters and lazily load visible video cards; the server does not create thumbnails or download originals for display.

Selections retain their exact media URL, asset/node/take IDs and Element look. Standard hosts receive `ui/update-model-context` when supported plus a `ui/message` with the full selection; legacy ChatGPT hosts use `sendFollowUpMessage`. Selection prepares the next request and does not itself authorize a paid render. Unsupported hosts get a copyable selection, and rejected messages keep the selection for retry. The only widget tool that changes project state is `cinegen_send_to_studio`, explicitly annotated as a mutation and saved through the existing cloud revision checks. Browsing and refresh are read-only, including durable job snapshots; they never resume a save or call a provider.

Active work refreshes immediately on mount and every eight seconds while visible, including open details, without a five-minute cutoff. Returning to the chat or reconnecting refreshes the saved result again. Unchanged updates preserve the current video element and playback. Empty reference controls no longer cover a running result. Use `cinegen_get_jobs` separately for an explicit save retry. Topview remains the default and Higgsfield requires an explicit user request.

Project data uses the existing OAuth and Firebase authorization. UI resources contain no account data or credentials. Local paths are omitted; media must sync before chat can use it. Previews load only from declared provider/storage domains; other HTTPS sources have an Open media action. No arbitrary-URL proxy is introduced.

After an update, refresh/reconnect the CineGen connector and start a fresh chat if the old chat retains cached tools. Widget rendering and selection support depend on the host: [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview). The cloud Worker update does not require a Mac reinstall; local stdio handlers need an app build containing the changes.
