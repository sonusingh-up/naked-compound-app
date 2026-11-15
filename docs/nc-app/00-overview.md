# Naked Compound app: overview

## One line

Flash.co for supplements, run on Naked Compound's own reviews. You share a product link, scan a barcode or ask a question, and the app gives an honest NC verdict, a better pick and the price per effective dose. No brand pays to appear.

## How it differs from Flash.co

| Flash.co | Naked Compound app |
|---|---|
| Summarises Reddit/YouTube opinions | Uses NC's own reviews, lab-report audits and scoring rubric |
| Covers any product | Covers supplements, protein, nutrition and beauty that NC has reviewed. Unreviewed products go to a review queue. |
| Live price scraping across stores | v1: NC-recorded prices plus affiliate links. Live prices come later via official APIs only. |
| Order and email tracking | Not in scope |

## v1 scope (ship this, nothing more)

1. **Share a link and get a verdict** (the core feature). The iOS Share Extension accepts Amazon.in, Flipkart, Nykaa, HealthKart and allowlisted brand-site URLs. The app shows the NC score card, the one-line verdict, red flags, cost per effective dose, and a "Better pick" when a product in the same primary category scores at least 0.5 points higher and its recorded price is within ±30% of the current product's recorded price.
2. **Ask NC** (AI chat, grounded). Example: "Best whey under ₹3,000 without sucralose." Answers come only from NC-reviewed products, with tappable product cards and citations.
3. **Search and browse.** Categories, filters (score, price, veg, FSSAI, third-party tested), and product detail screens that link to the full review on nakedcompound.in.
4. **Barcode scan.** VisionKit scans the barcode, which is matched against the `listings.gtin` table. With no match, the user sees "Not yet reviewed", a label-reading checklist, and a "Request a review" button that adds the product to the review queue.
5. **Protein calculator** (secondary tab). A future Swift port of `packages/protein-core` with the same rules and shared test vectors. Guest-first, diary data stays on device (SwiftData) and is never sent to the shopping API.
6. **Saved and alerts.** Users save products. A review-update email goes out via Resend when a saved product's score changes (opt-in).

## Not in v1

Live multi-store price comparison, price-drop alerts, Android, order tracking, community reviews, diary cloud sync.

## Design

Follow the current Apple-inspired Liquid Glass direction and repository brand standards in [`02-design.md`](02-design.md). It supersedes conflicting Dribbble styling. The visual checkpoint remains the Today dashboard, food search and portion-entry sheet; do not expand the design to every screen before owner approval.

## Roadmap

- **v1.1:** price-drop alerts (needs a price source, see architecture §7), widgets, a Siri shortcut "Ask Naked Compound".
- **v1.2:** cloud sync of the protein diary (opt-in; any future sync must preserve the local-first and privacy requirements in `01-architecture.md`), Android (Kotlin/Compose or KMP).
- **v2:** brand portal integration with the Brand Review Program. Brands submit products, and those submissions still go through the same editorial review, with no score influence.

## Success metrics

- Time from share to verdict under 2 s (p50) for matched products.
- Match rate of shared links at least 60% at launch (driven by `listings` coverage).
- Zero answers containing a score not found in D1. An automated eval enforces this (see `03-review-standards.md`).
