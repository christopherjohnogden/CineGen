# CineGen on Vercel

Production: https://cinegen-kappa.vercel.app
Project: https://vercel.com/christopher-ogdens-projects-8fd5f6aa/cinegen

Vercel builds the shared CineGen UI using `npm run build:vercel`. The existing Sites/Cloudflare backend continues to own workspace project data, uploaded media and encrypted provider connections. Firebase remains the source of cloud projects shared with Desktop and remote MCP.

Sign in using an approved CineGen Cloud account. The Vercel gateway verifies the Firebase token before setting an HttpOnly, Secure session cookie. Every backend request is revalidated on Cloudflare; caller-supplied identity headers are never forwarded. RPC calls and large uploads go directly to Cloudflare with a Firebase token, and authenticated media playback uses the Vercel gateway with Range headers.

## Deployment

The Vercel project is linked to the CineGen GitHub repository. Production builds use the repository root, the Vite framework, `npm ci --ignore-scripts`, and output `vercel/dist`. Desktop native installation scripts are intentionally skipped for web builds. No provider secret or Firebase administrator key is needed on Vercel.

The backend changes in `site/` must be published through Sites, separately from Vercel. Keep the Sites backend available at its current URL. Changes to its domain or access dispatch policy require updating the gateway and upload origin. New Vercel custom domains must be explicitly approved in `site/lib/server/remote-access.ts` and published before use.

Tests: `node --test tests/vercel/gateway.test.mjs site/tests/rendered-html.test.mjs` after building `site/`.

Desktop rendering and native tools retain their existing hosted capability limits. Real user sign-in, provider billing and generated media require the user's own account connection.
