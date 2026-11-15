# Build plan

Work one phase per Codex task. Each phase lists the prompt to paste into Codex and the acceptance criteria Codex must report against.

## Phase 0: owner setup (no code)

- [ ] **macOS access for iOS builds.** The owner is on Windows. Pick one: a Mac mini/MacBook (best), a cloud Mac (e.g. MacinCloud), or GitHub Actions macOS runners (private repos consume macOS minutes at a higher rate, so check your plan). Without one of these, SwiftUI code cannot be compiled or tested.
- [ ] Apple Developer Program ($99/yr). Reserve bundle ID (proposal: `in.nakedcompound.app`; owner confirms).
- [x] D1 `nc-app` created in the naked.business account (`7d55e074-0515-4303-9235-eb38e066dd33`).
- [x] R2 enabled, bucket `nc-images` created.
- [ ] Configure the app front's Cloudflare Pages project from `apps/nc-web` and any custom domain through owner-managed DNS. Do not modify the separate website repository or its DNS from this repository.
- [ ] Create an API token scoped to the naked.business account only (Workers, D1, R2, Vectorize edit), for Codex/CI.
- [x] App front uses Cloudflare Pages; API uses a Cloudflare Worker service binding.
- [ ] Google AI Studio: create a project used only for NC, get an API key, note which Flash and embedding models show "Free of charge", and check the rate limits page.
- [ ] Clerk app (production instance on `clerk.nakedcompound.in`), enable Apple + email OTP.
- [ ] Resend: verify `mail.nakedcompound.in`.
- [x] Design references are retained under `design/references/`; follow the current Liquid Glass and brand guidance in `docs/nc-app/02-design.md`.
- [ ] Audit available brand assets and font licenses before adding assets to the future native app. Do not generate or bundle assets that conflict with the design spec.
- [ ] Build `listings.csv` for the top 150 products (ASIN, Flipkart PID, GTIN, affiliate URL). This is the biggest driver of match rate.

## Phase 1: API foundation

**Codex prompt:** "Read AGENTS.md and docs/nc-app/01-architecture.md. Create apps/nc-api as a Cloudflare Worker (Hono, Zod, TypeScript strict), account naked.business only. Add migration 0001 exactly as specified, scripts/seed-from-products.mjs reading ../../data/products.json, and a listings CSV importer. Implement GET /v1/products, GET /v1/products/:id and POST /v1/resolve with the URL parsers in src/match/. Vitest for parsers (20+ real-format URLs per retailer), search ordering and better-pick rules. No deployment."

Accept when: tests pass. Seed loads 616 rows. `/v1/resolve` returns matched/unreviewed/unknown correctly for fixture URLs. No retailer HTML is fetched (a test asserts that only HEAD requests are made).

## Phase 2: Ask NC

**Codex prompt:** "Implement POST /v1/ask per 01-architecture.md §8 and the system prompt in 03-review-standards.md. Provider interface with a Gemini implementation (free tier, model from GEMINI_MODEL) and a Workers AI fallback, 429 handling as in §1 caveats, SSE streaming, numeric post-check, ai_cache. Embeddings via GEMINI_EMBED_MODEL into Vectorize. Add test/ai-eval.test.ts with the 40-question eval using recorded model responses."

Accept when: the eval passes. No uncited product appears. No number in an answer is missing from the retrieved rows.

## Phase 3: auth, saved items, email, deletion

Clerk JWT verification middleware, `/v1/me/*`, Clerk webhook (Svix verify), Resend score-change email (cron trigger daily, respects the 100/day free cap with a queue), and idempotent `DELETE /v1/me`.

Accept when: cross-user access tests fail closed, webhook signature tests pass, and deletion is idempotent and leaves no rows.

## Phase 3b: web front (`apps/nc-web`, Cloudflare Pages)

**Implementation:** `apps/nc-web` serves a static landing page and renders `/v/:id` with a Pages Function. Its Pages service binding forwards `/v1/*` and `/img/*` to the Worker. The public asset `_headers` sets a self-only CSP; the shared-verdict response sets its own CSP and security headers. No external Worker hostname is needed in the Pages proxy.

Accept when: Wrangler Pages local development serves the front, `/v1/products` and `/img/*` reach the Worker service binding, shared verdicts display reviewed/unreviewed/error states safely, and the CSP blocks third-party requests. AASA configuration requires the final Apple Team ID and bundle ID; do not publish placeholder identifiers. No DNS changes or deployment in this phase.

## Phase 4: iOS shell + design system

**Codex prompt:** "Read AGENTS.md and docs/nc-app/02-design.md. Create apps/nc-ios (SwiftUI, iOS 17+, Swift 6) with the NCCore Swift package: Theme.swift tokens, typography, and every component in §6 with #Previews (light/dark/XXL). Tab bar with 5 tabs and placeholder screens. Add .github/workflows/ios.yml to build and test on macos-latest."

Accept when: the CI build is green on macOS (link the run), and preview snapshots are attached.

## Phase 5: core features

Verdict screen, unreviewed state, Search, Home, the Share Extension, Scan (VisionKit), Ask chat with streaming, universal links, and Clerk sign-in with guest mode.

Accept when: UI tests cover share → verdict, scan → no match → request review, and ask → product card tap → detail. VoiceOver audit is done on the device or simulator.

## Phase 6: Protein tab

Export `packages/protein-core/vectors.json`, port to `NCCore/ProteinCore.swift`, add SwiftData models, and build the screens from `02-design.md` §5.7.

Accept when: XCTest passes the same vectors as Vitest, and day snapshots stay immutable after a target change.

## Phase 7: release

Privacy policy update (app data, Clerk, Resend, AI provider, affiliate links). App Privacy labels. Account deletion in-app. TestFlight with 20 testers. App Store screenshots. Then deploy `nc-api` (`wrangler deploy`) with owner approval, confirm the Pages deployment of `app.nakedcompound.in`, and configure universal links with the verified Apple identifiers.

## Ongoing (owner, weekly)

Triage `review_requests`, publish reviews, re-run the seed, and extend `listings.csv`. A good candidate for a reusable Claude skill: "review-queue-triage" (pull top requests → lab-report audit → draft review).
