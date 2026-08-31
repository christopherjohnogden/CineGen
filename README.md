# CineGen Cloud Site

This package publishes CineGen through Codex Sites without changing the Electron application. It imports the browser bridge from `web/src/` and the shared product UI from `src/`, so editor and timeline changes continue to flow to desktop, localhost web, and the hosted site.

## Hosted data

- D1 stores shared project documents and project-list metadata.
- R2 stores browser uploads and project media with byte-range playback.
- The Sites access policy is the membership boundary. Invited visitors intentionally see the same shared project workspace.
- fal.ai, OpenAI, kie.ai, RunPod, and Hugging Face credentials are encrypted in the workspace provider vault. The browser receives connection status only; credentials are injected into provider requests on the server.

The Sites runtime cannot execute computer-installed CLIs, Python models, FFmpeg, or native video modules. Those controls return a clear capability error until a separate authenticated compute service is connected. Manual timeline editing, project persistence, uploads, media playback, and hosted text chat are implemented here.

Topview is the default Director video provider. Topview and Higgsfield MCP sessions are also encrypted per workspace, so one connection is available to every invited teammate. Configure the server-only `CINEGEN_WORKSPACE_PROVIDER_SECRET` before publishing (and keep it stable across deployments). If omitted, the site temporarily falls back to the configured Topview or Higgsfield token secret for compatibility.

## Commands

```bash
npm install
npm run dev
npm test
npm run lint
npm run db:generate
```

Local development runs at `http://localhost:3000` with project-local D1/R2 emulation. The production package is built with `npm run build` and published through Codex Sites.

Do not put project IDs, bucket IDs, credentials, or API keys in `.openai/hosting.json`; it contains only logical binding names and the Sites project ID after the first publish.
