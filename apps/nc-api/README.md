# Naked Compound API

Cloudflare Worker for the reviewed supplement catalog and account features. It never reads the protein diary.

## Local development

```powershell
npm ci
npm test
npm run typecheck
npx wrangler d1 migrations apply nc-app --local
npm run dev
```

Apply migrations before starting the Worker. The catalog seed script only reads the reviewed catalog mirror at `data/products.json`; it does not infer price dates, flags, or review claims. Refresh the mirror from an authorized source file with `npm run sync-products -- <path>` from the repository root.

## Required Worker configuration

Set non-secret Clerk verification values in Wrangler `vars` for the Clerk instance:

- `CLERK_ISSUER`: exact JWT `iss` value.
- `CLERK_AUDIENCE`: expected JWT `aud` value.
- `CLERK_AUTHORIZED_PARTIES`: comma-separated app origins allowed by a token's optional `azp` claim.
- `BRAND_HOSTS`: optional comma-separated exact brand domains accepted by `/v1/resolve`.

Configure secrets with `wrangler secret put`:

- `CLERK_JWT_KEY`: Clerk PEM public key used for networkless RS256 verification.
- `CLERK_SECRET_KEY`: server API access for verified primary email lookup and account deletion.
- `CLERK_WEBHOOK_SECRET`: Svix signing secret for Clerk webhooks.
- `RESEND_API_KEY`: create, update, and delete opt-in contacts.
- `AI_CACHE_HMAC_KEY`: Ask cache and IP limiter key.
- `REVIEW_VOTE_HMAC_KEY`: pseudonymous deduplication key for review-request votes.
- `USER_RATE_LIMIT_HMAC_KEY`: pseudonymous key for verified-user rate limits.
- `ANTHROPIC_API_KEY`: optional primary Ask NC provider key.

Do not put secrets in `wrangler.jsonc`, source, or `.dev.vars` committed to the repository. For local work, use an ignored `apps/nc-api/.dev.vars` file.

## v1 routes

- `POST /v1/resolve`: resolve a supported HTTPS product URL or GTIN. URL query parameters and the full URL are not stored.
- `GET /v1/products` and `GET /v1/products/:id`: reviewed catalog search and detail.
- `GET /img/*`: public product images read from the `IMAGES` R2 bucket with cache validators and long-lived cache headers.
- `POST /v1/ask`: grounded streaming Ask NC response.
- `POST /v1/review-requests`: create or vote on an unknown item.
- `GET/PUT/DELETE /v1/me/saved/:productId`, `PUT /v1/me/preferences`, `DELETE /v1/me`: Clerk-authenticated account features.
- `POST /v1/webhooks/clerk`: Svix-verified `user.created` and `user.deleted` handling.

Catalog search only includes products with an NC review and score. Better-pick comparisons require same category, a score improvement of at least 0.5, and dated recorded prices within 30%.
