# Architecture

## 1. Services and cost (all free tiers at launch)

| Need | Choice | Free tier (verify before launch) | When you pay |
|---|---|---|---|
| API | Cloudflare Worker `nc-api` | 100k requests/day | Workers Paid $5/mo |
| Web (`app.`) | Netlify (`apps/nc-web`) | Static assets plus Netlify Functions; HTTP API proxy | Netlify plan as needed |
| Database | Cloudflare D1 | 5M rows read/day, 100k rows written/day, 5 GB. Queries fail when the limit is hit (enforced since 1 Sep 2026). | Same $5 plan |
| Images | Cloudflare R2 | 10 GB, zero egress | Beyond 10 GB |
| Semantic search | Cloudflare Vectorize | small free allowance | Scale |
| Auth | Clerk Hobby | 50,000 monthly retained users | Pro $25/mo |
| Email | Resend Free | 3,000/mo, **100/day** cap, 1 domain | Pro $20/mo |
| AI | Google Gemini API, free tier (key from aistudio.google.com). Flash model for chat, Gemini embedding for search. Workers AI fallback. | Free per-project limits, shown in AI Studio → Rate limit (not published as fixed numbers) | Tier 1 needs a billing account. Cache answers and queue to stay inside free limits. |

**Gemini free-tier caveats (must handle):**
- Content sent on the free tier can be used by Google to improve its products. Send only the question and NC product rows, never user IDs, emails or diary data. Disclose "AI answers are generated with Google Gemini" in the privacy policy.
- Limits are per project and change. On HTTP 429: serve from `ai_cache` if possible, otherwise fall back to Workers AI, otherwise return the plain retrieved product list with "AI is busy, here are the matching reviews".
- Check that the chosen model shows "Free of charge" on the Gemini pricing page before setting `GEMINI_MODEL`.

**Cloudflare accounts (confirmed 15 Nov 2026):**
- **App account (new):** naked.business@yahoo.com, account ID `7353a845036995b406e2f7e9a5c99dba`. The Worker, D1, R2 and Vectorize live here.
  - **Production (unchanged):** Worker `nc-api`; D1 `nc-app`, `database_id = 7d55e074-0515-4303-9235-eb38e066dd33`; R2 bucket `nc-images`; Vectorize index `nc-reviews`.
  - **Staging:** Worker `nc-api-staging`; D1 `nc-app-staging`, `database_id = 7d655f11-e7a8-4b5e-8e30-d209d1987664`; R2 bucket `nc-images-staging`; Vectorize index `nc-reviews-staging`.
  - Wrangler environment bindings are defined in `apps/nc-api/wrangler.jsonc`. Keep staging data and uploads isolated from production. Deploy staging with `npx wrangler deploy --env staging`; production deploys require separate owner approval.
  - Staging deployed 15 Nov 2026: `https://nc-api-staging.naked-business-735.workers.dev`, version `a410990d-01cd-4d6e-b950-1baf87f8c1ad`. Migrations `0001.sql` and `0002_api_accounts.sql` applied. D1 contains 616 scored catalog rows. `/v1/products` returns all 616 unique products with HTTP 200: 4 full reviews and 612 NC scores. Eligibility is based on non-null NC score; `has_review` controls article links only.
  - Staging Vectorize uses the `@cf/baai/bge-base-en-v1.5` preset matching the current retrieval implementation. The index is created but embeddings have not been populated by the SQL seed.
  - `apps/nc-web/public/_redirects` publishes staging API/image proxy rules on Netlify. Root `netlify.toml` declares the build, public assets and verdict function directory. Netlify project `nc-app` has ID `84d9c2c1-82fc-4fe2-a118-57dd1ee25171`; dev updates use Deploy Previews. Production promotion requires owner approval.
- **Old account:** holds the `nakedcompound.in` DNS zone (nameservers osmar/bristol.ns.cloudflare.com) and the `brands.nakedcompound.in` Pages project. The website itself is on Vercel. **Codex must not touch this account.**

**Domain decision (owner, 15 Nov 2026):** the `nakedcompound.in` zone stays in the existing website account, the main site stays on Vercel, and `brands.nakedcompound.in` stays on Cloudflare Pages. This app repository does not configure or change the website or its DNS.

The app API uses its `workers.dev` host, and the web front uses Netlify. Domain attachment and DNS are owner-managed and outside this repository's implementation scope.

- **Worker `nc-api` + D1 + R2 + Vectorize** stay in the new account. The API is reached at `https://nc-api.<subdomain>.workers.dev`. The iOS app calls this URL directly (base URL in `.xcconfig`); users never see it. Images are served by the Worker at `/img/*` from the R2 binding.
- **`apps/nc-web` is a Netlify project**. It serves the static app landing page and renders `/v/:id` shared verdicts with a Netlify Function. Published redirects forwards `/v1/*` and `/img/*` requests to `nc-api` using the staging Worker hostname.
- No custom API hostname is configured in v1. The iOS app calls the Worker `workers.dev` URL directly.

Custom-domain and DNS changes require separate owner setup and are not performed by this repository's local build or CI.

## 2. Domains

| Host | Serves |
|---|---|
| `www.nakedcompound.in` | Website (Vercel, unchanged). Also hosts `/.well-known/apple-app-site-association` so `/reviews/*` links open the app. |
| `app.nakedcompound.in` | Netlify front: landing page and `/v/:id` shared verdicts; Netlify proxy forwards `/v1/*` and `/img/*` to the Worker |
| `nc-api.<subdomain>.workers.dev` | Worker API (`/v1/*`, `/img/*`), used by the iOS app |
| `clerk.nakedcompound.in` / `accounts.nakedcompound.in` | Clerk production CNAMEs |
| `mail.nakedcompound.in` | Resend sending domain (SPF/DKIM/DMARC). Keeps root-domain email reputation separate. |

See §1 for the app API and Netlify proxy arrangement.

## 3. Repo layout

```
apps/
  nc-ios/                 Xcode project (SwiftUI)
    NakedCompound/        App target
    ShareExtension/       Share-a-link target
    Packages/NCCore/      Swift package: models, API client, ProteinCore port
  nc-api/                 Worker (already built by Codex)
  nc-web/                 Netlify front: static assets + Netlify Functions
    netlify/functions/    Netlify shared-verdict handler
    src/                  Platform-independent verdict renderer
    public/                Landing page assets
    public/_redirects     Staging API and image proxies
  ../data/products.json  local mirror of the reviewed catalog export
  packages/protein-core/  protein rules and shared test vectors
packages/protein-core/vectors.json   shared test vectors (TS + Swift)
.github/workflows/ios.yml            macOS runner build + tests
.github/workflows/api.yml            API install, Vitest and typecheck; no deployment.
```

## 4. D1 schema (migration 0001)

```sql
CREATE TABLE products (
  id TEXT PRIMARY KEY,               -- products.json id
  brand TEXT NOT NULL, name TEXT NOT NULL,
  score REAL, grade TEXT,            -- NULL = not yet reviewed
  summary TEXT, form TEXT,
  price_inr INTEGER, quantity TEXT, price_checked_at TEXT,
  categories TEXT NOT NULL,          -- JSON array
  review_url TEXT, has_review INTEGER NOT NULL DEFAULT 0,
  personally_tested INTEGER NOT NULL DEFAULT 0,
  image_key TEXT,                    -- R2 key
  flags TEXT,                        -- JSON: veg, fssai, third_party_tested, sweetener, proprietary_blend
  cost_per_dose_inr REAL,            -- precomputed from review data, NULL if unknown
  updated_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE products_fts USING fts5(brand, name, form, summary, content='products', content_rowid='rowid');

CREATE TABLE listings (               -- how shared links / barcodes map to products
  id INTEGER PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  retailer TEXT NOT NULL,            -- amazon_in | flipkart | nykaa | healthkart | brand
  external_id TEXT,                  -- ASIN, FSN/PID, slug
  gtin TEXT,                         -- EAN/UPC from pack
  affiliate_url TEXT,
  UNIQUE(retailer, external_id)
);
CREATE INDEX listings_gtin ON listings(gtin);

CREATE TABLE review_requests (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL,
  user_id TEXT,                      -- Clerk user id, NULL for guests
  source TEXT NOT NULL,              -- share | scan | search | chat
  raw_url TEXT, gtin TEXT, title_guess TEXT,
  votes INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open' -- open | in_review | published | rejected
);

CREATE TABLE users (id TEXT PRIMARY KEY, email_opt_in INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE saved_products (user_id TEXT NOT NULL, product_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id, product_id));
CREATE TABLE score_changes (id INTEGER PRIMARY KEY, product_id TEXT NOT NULL, old_score REAL, new_score REAL, changed_at TEXT NOT NULL, notified INTEGER NOT NULL DEFAULT 0);
CREATE TABLE ai_cache (key TEXT PRIMARY KEY, answer TEXT NOT NULL, product_ids TEXT NOT NULL, created_at TEXT NOT NULL);
```

Seed: `apps/nc-api/scripts/seed-from-products.mjs` reads `data/products.json` (616 rows, fields: id, brand, name, score, grade, summary, form, price_inr, quantity, price_tag, categories, url, has_review, personally_tested) and writes `INSERT` SQL. Refresh the read-only local mirror from a supplied source path with `npm run sync-products -- <path>`. `listings` starts empty and is filled by an admin CSV import (`listings.csv`: product_id, retailer, external_id, gtin, affiliate_url). **Listings coverage drives the match rate. Do this data work before launch.**

## 5. API (v1)

All JSON, validated with Zod, rate-limited per IP and per user.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/v1/resolve` | optional | `{url}` or `{gtin}` → `{status: matched|unreviewed|unknown, product?, betterPick?, requestId?}` |
| GET | `/v1/products?q=&category=&min_score=&max_price=&flags=` | none | Search (FTS5 + filters), ordered by score then price-per-dose |
| GET | `/v1/products/:id` | none | Detail + listings + alternatives |
| POST | `/v1/ask` | optional | `{question, history[]}` → SSE stream. Final event carries `product_ids[]`. |
| POST | `/v1/review-requests` | optional | Create or upvote a request |
| GET/PUT/DELETE | `/v1/me/saved/:productId` | required | Saved list |
| PUT | `/v1/me/preferences` | required | Email opt-in |
| DELETE | `/v1/me` | required | Account deletion: D1 rows + Clerk user + Resend contact. Idempotent. |
| POST | `/v1/webhooks/clerk` | Svix signature | user.created / user.deleted |

Auth: verify the Clerk session JWT in the Worker (issuer, audience, signature via JWKS, expiry). Derive user ID on the server only.

## 6. Link resolution (`/v1/resolve`)

1. Expand short links (`amzn.to`, `fkrt.it`) by following the `Location` header only (HEAD request, max 3 hops). Never read the page body.
2. Parse: Amazon `/dp/{ASIN}` or `/gp/product/{ASIN}`, Flipkart `pid=`, Nykaa `/p/{id}`, HealthKart `/sv/...`, brand domains from an allowlist.
3. Look up `listings(retailer, external_id)`, which gives the product.
4. If there is no listing, fuzzy-match the URL slug words against `products_fts`. If the top hit is a clear winner (bm25 gap threshold), return `matched` with `confidence: "probable"` and let the user confirm. Otherwise return `unknown` and create a `review_request`.
5. Better pick: same primary category, score ≥ current + 0.5, price within ±30%. The highest score wins.

## 7. Prices

v1 shows `price_inr` with "Price checked {date}" from NC data and links out through `affiliate_url`. Live prices come later via Amazon Creators/PA-API (requires Associates eligibility) or retailer affiliate feeds. No scraping.

## 8. AI pipeline (`/v1/ask`)

1. Classify intent (find/compare/explain/off-topic) with a cheap model call or rules.
2. Retrieve: FTS5 + filters parsed from the question (price cap, category, flags) and Vectorize top-k over review summaries. Cap at 12 products.
3. Prompt the model with a system prompt (from `03-review-standards.md`) plus the retrieved rows as JSON. The model must answer only from those rows, cite `[product_id]`, and say "NC hasn't reviewed that yet" when the rows don't cover the question.
4. Post-check: every number in the answer that looks like a score/price must exist in the retrieved rows. If not, regenerate once, then fall back to a plain list.
5. Cache by a normalised question hash for 24 h in `ai_cache`.

Gemini call: `POST https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse` with header `x-goog-api-key: ${GEMINI_API_KEY}`. Use `systemInstruction` for the prompt in `03-review-standards.md`, `temperature: 0.2`, and `responseMimeType: "text/plain"`. Do not enable Google Search grounding, because answers must come only from NC data.

### Worker env and secrets (`wrangler secret put`, in apps/nc-api)

| Name | Type | Notes |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | wrangler.jsonc / CI env | Dedicated NC account |
| `GEMINI_API_KEY` | `wrangler secret put` | From aistudio.google.com → Get API key, in a Google Cloud project used only for NC |
| `GEMINI_MODEL` | var | e.g. current Flash model, confirmed free on the pricing page |
| `GEMINI_EMBED_MODEL` | var | Gemini embedding model |
| `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET` | secret | |
| `RESEND_API_KEY` | secret | |
| Bindings | `DB` (D1 `nc-app`), `IMAGES` (R2 `nc-images`), `VECTORS` (Vectorize `nc-reviews`), `AI` (Workers AI) | |

## 9. iOS app architecture

- MVVM with `@Observable` view models, async/await `APIClient` in `NCCore`.
- SwiftData: `SavedProduct` (offline mirror), protein `Profile`, `TargetEvent`, `Food`, `Entry`, `DaySnapshot`. Preserve the local-first semantics: immutable day snapshots, no rounding, nulls stay null.
- Share Extension: reads URL from `NSExtensionItem`, calls `/v1/resolve`, shows a compact verdict sheet, "Open in app" deep link `nc://product/:id`.
- Universal links: `applinks:app.nakedcompound.in` for `/v/*` (AASA requires the final Apple Team ID and bundle ID). Any link association on the main website requires a separate website-repository change.
- Clerk: `clerk-ios`, Sign in with Apple required if any other social login is offered (App Store 4.8).
