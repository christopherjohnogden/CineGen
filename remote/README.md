# CineGen remote MCP

Live endpoint: https://cinegen-remote.christopherjohnogden.workers.dev/mcp

Add a custom connector in Claude's web settings and sign in with the same CineGen Cloud email/password used by the app and website. The connector can then be used from Claude mobile. ChatGPT requires an account/workspace with custom MCP apps and developer mode on the web; OpenAI currently documents custom MCP apps as web-only.

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
