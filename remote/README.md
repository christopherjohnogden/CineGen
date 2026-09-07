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

## Inline media displays (server 1.3.0)

- `cinegen_show_reference_elements`: paginated Element reference images and continuity looks; accepts `elementIds`, `type`, `search`, `offset`, and `limit`.
- `cinegen_show_generations`: image/video gallery across all Spaces, with optional `spaceId`, `nodeIds`, `kind`, `offset`, and `limit`.
- `cinegen_job_display`: one result by `nodeId` or durable cloud `requestId`. For request IDs, the durable job status takes precedence over stale node state.

Remote calls require `projectId`. These tools return readable text links and `structuredContent`, and advertise the shared `ui://cinegen/media-viewer-v1.html` resource via `_meta.ui.resourceUri` and the ChatGPT compatibility alias `openai/outputTemplate`. Both cloud and stdio transports implement `resources/list` and `resources/read`. The widget supports MCP Apps and the legacy `window.openai` host bridge, with image detail, native video controls, prompt details, pagination, refresh and links back to CineGen. Active work refreshes every eight seconds while visible, for up to forty checks; opening a detail in the gallery pauses automatic refresh. Refresh never generates media or retries saving. A failed save can be resumed explicitly with the existing `cinegen_get_jobs` tool.

All project data remains behind the existing OAuth and Firebase authorization. The static UI resource contains no project data or credentials. Media URLs must be HTTPS; device-local paths and private-network URLs are not exposed. Inline previews load only from declared CineGen storage/provider domains; other public sources have an Open media link. Files that have not synced remain viewable in CineGen, with an explanation in the widget. No proxy, upload, signing service or new paid generation is introduced by viewing media.

After updating, refresh/reconnect the CineGen connector to reload its tool index and begin a new chat if the old chat retains cached tools. Whether a widget actually renders is controlled by the host: [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview), [ChatGPT UI integration](https://developers.openai.com/plugins/build/chatgpt-ui). The local desktop bridge needs a build containing the new handlers; updating the cloud Worker does not require a new Mac build.
