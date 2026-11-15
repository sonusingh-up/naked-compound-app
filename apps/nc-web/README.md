# Naked Compound web front

Netlify project nc-app hosts the static landing page and a Netlify Function at /v/:id. The API stays on Cloudflare Workers. Root netlify.toml sets the publish directory to apps/nc-web/public and the function directory to apps/nc-web/netlify/functions.

Run npm run build and npm run typecheck here. From the repository root, run npx netlify dev for local routing and function emulation. Install API dependencies first for the shared TypeScript checker.

public/_redirects proxies /v1/* and /img/* to the staging Worker. The verdict function fetches that public staging API directly, avoiding recursion into Netlify preview login protection. It preserves server-rendered metadata, escaping, review-depth labels and error states. Neither path requires Cloudflare credentials on Netlify.

Push dev for the connected Deploy Preview. Do not push main, promote a production deployment, change DNS or switch the production backend without owner approval. Preview access remains protected by Netlify team login. AASA awaits verified Apple identifiers.
