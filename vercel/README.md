# CineGen on Vercel

Production: https://cinegen-kappa.vercel.app
Project: https://vercel.com/christopher-ogdens-projects-8fd5f6aa/cinegen

Vercel builds the shared CineGen UI using `npm run build:vercel`. The standalone Cloudflare Worker at https://cinegen-api.christopherjohnogden.workers.dev owns workspace project data (D1), uploaded media (R2), and encrypted provider connections. ChatGPT Sites is retired. Firebase remains the source of cloud projects shared with Desktop and remote MCP.

Sign in using an approved CineGen Cloud account. The Vercel gateway verifies the Firebase token before setting an HttpOnly, Secure session cookie. Every backend request is revalidated on Cloudflare; caller-supplied identity headers are never forwarded. RPC calls and large uploads go directly to Cloudflare with a Firebase token, and authenticated media playback uses the Vercel gateway with Range headers.

## Deployment

The Vercel project is linked to the CineGen GitHub repository. Production builds use the repository root, the Vite framework, `npm ci --ignore-scripts`, and output `vercel/dist`. Desktop native installation scripts are intentionally skipped for web builds. No provider secret or Firebase administrator key is needed on Vercel.

Backend deployments use `backend/wrangler.jsonc`, separately from Vercel. Run `node backend/build.mjs` and `npx wrangler deploy --config backend/wrangler.jsonc` with Cloudflare account access. The server reuses shared modules under `site/lib/server/`; no Sites runtime or service is required. New Vercel custom domains must be explicitly approved in `site/lib/server/remote-access.ts` and published before use. Preserve the provider encryption secret when deploying.

Tests: `node --test tests/vercel/gateway.test.mjs backend/tests/access.test.mjs`.

Desktop rendering and native tools retain their existing hosted capability limits. Real user sign-in, provider billing and generated media require the user's own account connection.
