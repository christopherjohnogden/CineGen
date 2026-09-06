# CineGen Cloudflare backend

Production API: https://cinegen-api.christopherjohnogden.workers.dev
Frontend: https://cinegen-kappa.vercel.app

Cloudflare account: `02423324d517a83d37732f9d451e20fe`.
D1: `cinegen-workspace` (`312e74f8-4966-4eb3-a774-deea07296b35`).
R2: `cinegen-workspace-media`.
Required secret: `CINEGEN_HIGGSFIELD_TOKEN_SECRET`; it also protects existing provider-vault records. Never rotate without re-encrypting stored credentials.

Firebase continues to provide sign-in, shared cloud projects, and cloud media storage. The independent `cinegen-remote` MCP Worker remains unchanged. Vercel serves the UI and proxies authenticated media; RPC and uploads go directly to this Worker. Media passes through Vercel during playback but is not persisted there.

Build with `node backend/build.mjs`, test with `node --test backend/tests/access.test.mjs tests/vercel/gateway.test.mjs`, then deploy with `npx wrangler deploy --config backend/wrangler.jsonc`. Preserve existing Worker secrets. Shared server implementation lives in `site/lib/server/`, with no dependency on the Sites hosting service.

Migration on 2026-09-06 preserved 0 project rows, 1 Elements library, 2 provider records, and 1 media object. Exact row comparison, media SHA-256 verification, and credential decryption passed. Private rollback snapshots are excluded under `.migration/`; do not publish them. The transfer endpoints were removed after verification.
