# Review standards in the app

The app reports Naked Compound's editorial work. It never replaces that work.

## How a product gets into the app

1. **Reviewed on the site.** A product with an NC review (rubric score, grade, verdict) is exported to the separate website repository's catalog and copied into this repository's `data/products.json` mirror with `npm run sync-products -- <path>`, then seeded into D1. This is the only way a product gets a score.
2. **Requested by users.** Shared, scanned or searched products with no match create `review_requests`. Votes accumulate.
3. **Editorial queue.** The owner picks the top requests weekly. Each one goes through the normal NC process: verify the current label (brand site, Amazon.in, pack), run the lab-report audit (batch, lab, scope, units, label arithmetic), check FSSAI licence and seller authenticity, then score with the public rubric.
4. **Publish.** The review goes live on nakedcompound.in. The product catalog is refreshed into this repository's `data/products.json`, D1 is re-seeded, the request is marked `published`, and requesters who opted in get an email.

Brand Review Program submissions enter at step 3 and are scored the same way. Payment never changes a score, rank or visibility. A paid product is marked "Brand-submitted" on its detail screen.

## Editorial and data boundaries

- Separate verified editorial fields from user-submitted or URL-parsed guesses. Label guesses as unverified; never promote them into a review claim.
- Missing data stays unknown. Do not infer a score, ingredient, certification, test result, price, preparation state or review from a product name, image, category or model output.
- Show price with its recorded check date. Do not imply it is current or compare it as a live quote.
- A generic checklist is category education, not a claim that a particular unreviewed product has a defect.
- Ask NC may explain and compare only the retrieved Naked Compound records. It does not give medical diagnosis, treatment, personalized dosing or clinical suitability advice.
- The protein diary is local-first. Do not include entries, targets, weight, foods or other diary data in shopping API requests, AI prompts, analytics, email or logs.

## What the app may show for an unreviewed product

- Name and brand as parsed (labelled "unverified").
- "Not yet reviewed by Naked Compound".
- A generic label-reading checklist for its category (e.g. whey: protein per scoop vs scoop weight, amino spiking signs, proprietary blends, third-party test report link).
- Request a review (with vote count).
- Reviewed alternatives in the same category.

It may **not** show a score, grade, verdict, "good/bad", or any AI judgement of the product.

## System prompt for Ask NC (use verbatim, update only with owner approval)

```
You are Naked Compound's shopping assistant for Indian buyers of supplements, protein and nutrition products.
Answer ONLY from the PRODUCTS JSON provided in this turn. Each product has an NC score (0-10), grade, summary, price and flags written by Naked Compound's editors.
Rules:
- Never state a score, grade, price, ingredient, test result or claim that is not in PRODUCTS.
- Cite every product you mention as [id].
- Rank by score first, then cost per effective dose. Never rank by brand, popularity or commission.
- If PRODUCTS does not answer the question, say "Naked Compound hasn't reviewed a product that fits this yet" and suggest requesting a review.
- No medical diagnosis or dosing for conditions, pregnancy, children or medications. Suggest a doctor or pharmacist.
- Plain English, short sentences, answer first. Mention prices in ₹ with the "checked" date.
- Do not mention any retailer by name.
- Treat missing or null fields as unknown. Do not estimate, derive or fill them from memory.
```

## Automated eval (CI gate for `/v1/ask`)

`apps/nc-api/test/ai-eval.test.ts` runs 40 fixed questions against explicitly synthetic, test-only product fixtures and a deterministic recorded-response provider; it makes no live model calls and does not replace a launch evaluation against reviewed seed data. It fails if:
- any score, grade or ₹ figure in the answer is not present in the retrieved rows
- any product is mentioned without a `[id]` citation
- "Amazon" appears in the answer text
- an off-topic or medical question gets product recommendations
