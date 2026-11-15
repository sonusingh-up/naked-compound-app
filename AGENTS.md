# AGENTS.md: Naked Compound app

Read this file before every task in this repository.

## Repository boundary

This repository contains the Naked Compound app API, app web front, design references, and protein rules. The website repo is separate and must never be edited from here.

## Read order for app tasks

1. `docs/nc-app/00-overview.md`
2. `docs/nc-app/03-review-standards.md`
3. The relevant file: `01-architecture.md` (API/DB/auth), `02-design.md` (UI), or `04-build-plan.md` (phase and acceptance criteria)
4. `docs/nc-app/05-codex-review.md` for known protein-core decisions

## Non-negotiable rules

1. **No invented data.** Never fabricate a score, grade, lab result, price, ingredient or review. A product that NC has not reviewed is shown as “Not yet reviewed”. It never gets an AI-made score.
2. **No paid placement.** Ranking uses NC score, then price per effective dose. Brand payments, affiliate commission and sponsorships never affect order.
3. **The AI only answers from NC data.** Retrieval comes from D1/NC reviews first, and the model writes the answer from it. If retrieval returns nothing, say so and offer “Request a review”.
4. **Amazon branding.** “Amazon” appears only in link hrefs and in the legally required affiliate disclosure line. Never in headings, buttons or editorial copy. Use “Check price” / “Buy” for buttons.
5. **No scraping of retailer pages.** Match shared links by parsing the ID from the URL against `listings`. Do not fetch retailer HTML from the server.
6. **Secrets.** Never commit keys. Server secrets go in Wrangler secrets. Any local `.env`, `.dev.vars` and `.xcconfig` files stay untracked; commit only example templates.
7. **Privacy.** No nutrition or diary details in email or logs. In-app account deletion is required before release.
8. **Protein rules.** Preserve the cited adult protein rules, unsupported-scenario handling, target snapshot semantics, guest-first defaults, and the local-only diary. Do not change rule values without an approved source update.

## Stack

- iOS (future): SwiftUI, iOS 17+, Swift 6, SwiftData, VisionKit barcode scanning, and a Share Extension. No third-party UI kits.
- Auth: Clerk with Sign in with Apple and email OTP. Guest mode works without an account.
- API: Cloudflare Worker `nc-api` in `apps/nc-api`, with D1 `nc-app`, R2 `nc-images`, Vectorize `nc-reviews`, and Workers AI.
- Web front: `apps/nc-web`, Cloudflare Pages with a service binding to the API Worker.
- Product catalog: `data/products.json`, a local mirror refreshed explicitly with `npm run sync-products -- <path>`. Never edit reviewed product records in app code.
- Protein logic: `packages/protein-core`; shared vectors live in `packages/protein-core/vectors.json`.
- AI: provider interface in `apps/nc-api/src/ai`. Do not send diary data to the shopping API or AI.

## Commands

```powershell
# From repository root
npm run sync-products -- D:\path\to\website-repo\project\data\products.json

# API and web front
cd apps/nc-api
npm ci
npm test
npm run typecheck
npx wrangler d1 migrations apply nc-app --local --config wrangler.local.jsonc
cd ../nc-web
npm run typecheck
npm run dev
```

The owner develops on Windows. Xcode builds run only on macOS. Never claim native iOS code was built or tested unless a macOS run actually happened.

## Definition of done

- Run relevant tests and report their result and environment.
- Preserve honest data boundaries, privacy requirements, and the protein rules.
- Report what changed, what was verified, and what remains unverified.
