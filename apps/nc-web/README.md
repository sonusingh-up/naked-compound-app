# Naked Compound web front

Cloudflare Pages project `nc-app`. It serves the landing page and server-rendered `/v/:id` verdicts. Requests under `/v1/*` and `/img/*` pass through the `API` service binding to `nc-api`.

Use the Wrangler installation in the API workspace for local development:

```powershell
cd apps/nc-api
npm ci
node node_modules/wrangler/bin/wrangler.js d1 migrations apply nc-app --local --config wrangler.local.jsonc
cd ../nc-web
npm run dev
```

This starts Pages and the API Worker in Wrangler local mode using both configuration files. The local API config deliberately omits remote AI/Vectorize bindings; product routes and R2 are available locally without account credentials. It does not deploy. `npm run typecheck` checks the Pages Functions.
