# CineGen Web

CineGen Web is the browser build of the desktop editor. It uses the same React editor, timeline, workflow, and project UI from [`../src`](../src); `web/src/platform` supplies the browser transport, while `web/server` replaces Electron IPC, SQLite/media workers, and native integrations with browser-safe HTTP services.

That means most UI changes should be made once in `src/` and will appear in both desktop and web builds. Platform-specific work belongs in `electron/` or `web/`. The two builds share source code, not project data.

## Run locally

Prerequisites: Node.js 18+ and npm. Run these commands from the repository root:

```bash
npm install
npm --prefix web install
npm --prefix web run dev
```

Open <http://localhost:5174>. The development command starts:

- Vite on `localhost:5174` for the shared React UI.
- The CineGen web server on `127.0.0.1:8787`; Vite proxies `/api` and `/media` to it.

To run either side separately:

```bash
npm --prefix web run dev:server  # API and media server, port 8787
npm --prefix web run dev:client  # Vite client, port 5174
```

Keep the API on port `8787` during Vite development because that proxy target is fixed in `web/vite.config.ts`.

## Build and start

```bash
npm --prefix web run build
NODE_ENV=production npm --prefix web run start
```

Open <http://127.0.0.1:8787>. `start` serves both `web/dist` and the API. `npm --prefix web run preview` uses port `4174`, but previews only the built frontend; use `start` for the complete application.

## Test

```bash
npm --prefix web test
npm --prefix web run typecheck
node --test web/server/*.test.mjs web/server/services/*.test.mjs
```

The first command covers the browser adapter and web entry point. The Node test command covers the server, security boundaries, and desktop-parity handlers. Run the root `npm test` suite as well when changing shared code under `src/`.

## Configuration

The scripts do not automatically load dotenv files. For a local shell configuration:

```bash
cp web/.env.example web/.env.local
set -a
source web/.env.local
set +a
npm --prefix web run dev
```

`web/.env.local` matches the repository's `*.local` ignore rule. Do not commit secrets.

Common server settings:

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | HTTP bind address. Keep it loopback-only for local use. |
| `PORT` | `8787` | Web/API server port. |
| `CINEGEN_WEB_DATA_ROOT` | `web/.data` | Isolated web projects, media, caches, and job state. |
| `CINEGEN_WEB_MAX_JSON_BYTES` | `67108864` | Maximum JSON request size. |
| `CINEGEN_WEB_MAX_UPLOAD_BYTES` | `4294967296` | Maximum browser upload size. |
| `CINEGEN_PUBLIC_BASE_URL` | unset | Public HTTPS origin used when a cloud provider must fetch web media directly. |
| `CINEGEN_ARTLIST_CLIENT_ID` | unset | Optional Artlist-issued OAuth client ID, useful for localhost testing. |
| `CINEGEN_ARTLIST_CLIENT_SECRET` | unset | Optional server-only secret for an Artlist-issued confidential client. |
| `CINEGEN_ARTLIST_CLIENT_METADATA_URL` | unset | Public HTTPS OAuth client metadata document used when the callback runs on a different origin. |
| `CINEGEN_ARTLIST_TOKEN_SECRET` | generated locally | Stable server-only key material for encrypting Artlist refresh tokens. |
| `CINEGEN_TOPVIEW_TOKEN_SECRET` | generated locally | Stable server-only key material for encrypting Topview OAuth tokens. Required for multi-instance deployments. |
| `CINEGEN_FFMPEG_PATH` | `ffmpeg` | Optional FFmpeg override for acoustic analysis. Export and core media jobs use bundled static binaries. |

fal.ai, kie.ai, and RunPod keys are entered in CineGen Settings. The browser sends them with the individual operation; the server forwards them to the selected provider and does not persist them. There are intentionally no fal/kie/RunPod key variables in `.env.example`.

Optional server-side integrations are configured with the variables below. See [`.env.example`](.env.example) for the complete list.

- LLMs: `CINEGEN_OLLAMA_URL`, `CINEGEN_CLAUDE_CODE_PATH`, `CINEGEN_CODEX_PATH`, `CINEGEN_GEMINI_PATH`.
- Higgsfield CLI: `CINEGEN_HIGGSFIELD_BIN` (or `CINEGEN_HIGGSFIELD_PATH`), `CINEGEN_HIGGSFIELD_CWD`, timeout settings, and the opt-in `CINEGEN_HIGGSFIELD_ALLOW_AUTH_COMMANDS`.
- Transcription: `CINEGEN_TRANSCRIPTION_ENDPOINT`, `CINEGEN_TRANSCRIPTION_WORKER_URL`, `CINEGEN_TRANSCRIPTION_WORKER_API_KEY`.
- Local models: `CINEGEN_{LTX,QWEN_EDIT,LAYER_DECOMPOSE,WHISPERX}_{REPO,PYTHON,SCRIPT}`.
- SAM 3: either `CINEGEN_SAM3_BASE_URL` plus optional `CINEGEN_SAM3_API_KEY`, or `CINEGEN_SAM3_PYTHON`, `CINEGEN_SAM3_SCRIPT`, and optional `CINEGEN_SAM3_CWD`.

## Data isolation

Web data defaults to `web/.data`; desktop data remains in the Electron application-data directory and is not read or modified by the web server. Set an absolute `CINEGEN_WEB_DATA_ROOT` to keep separate development or deployment datasets. Browser uploads are copied beneath that data root and exposed as `/media/...` URLs—raw desktop filesystem paths are rejected.

## Capability behavior

- Editing, timelines, project management, media import/processing, sync, export, cloud workflows, vision, hosted cut planning, and browser event streams have web server implementations.
- The **Director** tab is the same `src/` UI on web; breakdown/shotlist LLM jobs use the web LLM RPC, and Seedance 2.5 generation uses the server-side Higgsfield CLI when configured. Director show state persists in the project snapshot (`director`) and in the sqlite workflow extra blob.
- The hosted cut workflow uses deterministic project-index retrieval; desktop-only story-graph/local reranking is not run on the server.
- Ollama and Claude Code/Codex/Gemini CLI chat run on the server when their runtimes are reachable. Missing tools are reported as unavailable; CLI visual references remain unsupported.
- Higgsfield generation and Quick Edit use a server-side Higgsfield CLI when configured. Device login/logout is disabled unless explicitly enabled on a trusted local server.
- Artlist video generation uses Artlist's remote MCP directly from the web server. OAuth tokens are encrypted server-side, and Director element images are forwarded as generation references. Hosted HTTPS deployments publish `/api/artlist/oauth/client-metadata`; localhost needs an Artlist-issued client ID or a public client metadata URL because Artlist disables anonymous dynamic client registration.
- Topview video generation uses Topview's official remote MCP. Sign-in opens Topview OAuth in a popup, credentials remain encrypted server-side, and Director element images are uploaded as named omni references. Topview is the default Director video provider; its model and allowed duration, resolution, aspect ratio, and audio settings are selected and validated from Topview's live generation configuration.
- LTX, Qwen Edit, Layer Decompose, WhisperX, local transcription, and SAM 3 require the corresponding runtime or worker configuration. Missing integrations fail with a clear capability message instead of falling back to arbitrary commands.
- Native AVFoundation playback, desktop file dialogs, and arbitrary local paths remain desktop-only. The web build uses browser playback and uploads instead.
- Local web media up to 90 MB can be staged to fal.ai per request. Larger provider inputs require a correctly secured public `CINEGEN_PUBLIC_BASE_URL`.

## Security and deployment

This server is designed for trusted localhost development. It binds to `127.0.0.1` by default and allows browser CORS only from localhost origins. It does **not** provide user authentication, tenant isolation, authorization, TLS termination, quotas, or production-grade CSRF protection.

Do not set `HOST=0.0.0.0`, expose port `8787`, or publish `CINEGEN_PUBLIC_BASE_URL` directly to the internet as-is. A public deployment needs an authenticated TLS reverse proxy, access controls for `/api`, `/media`, and event streams, strict origin policy, secret management, rate/body limits appropriate to the deployment, and isolated persistent storage. Treat any configured local runtime or CLI as code executed with the web-server account's permissions.
