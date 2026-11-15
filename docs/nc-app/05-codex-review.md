# Review notes for the standalone app repository

## Product boundaries

The shopping app is a native SwiftUI product with a Cloudflare Worker API and a Netlify front. Protein rules remain in `packages/protein-core` and are shared with the future Swift port through `vectors.json`. Protein diary data is local-first and is never sent to the shopping API.

The website repository is separate. Its catalog can be copied into this repository's `data/products.json` mirror with the root `sync-products` command; edits made here do not flow back to the website repository.

## Decisions to preserve

- Keep the protein calculator as a future native destination; do not wrap another web app in Capacitor.
- Keep `apps/nc-api` scoped to shopping app features. Diary cloud sync is deferred.
- Preserve IndexedDB/SwiftData local-first semantics for diary data, immutable day snapshots, precise sums, explicit unknown values, and no rounding in stored values.
- Use `docs/nc-app/02-design.md` as the visual source of truth. It follows the owner's Apple-inspired Liquid Glass direction and holds the protein checkpoint to Today, food search, and portion entry until visual approval.
- Shared protein-core vectors cover calculate, chooseTarget, contribution, intake, progress, costPer25, and targetOnDate. Vitest must keep exercising them.
- Use repository brand assets and system typography unless an existing licensed brand font is verified. Do not add an unverified font bundle.
- IFCT food data remains excluded pending redistribution-rights verification. Personal label foods are the working food catalog.
- Native iOS build/test requires macOS. Do not claim a native build or device verification from Windows.

## Keep as-is

Preserve adult protein rules and cited sources (ICMR-NIN, PROT-AGE, ISSN, Morton), unsupported-scenario handling, target snapshot semantics, guest-first/no-account defaults, and explicit preview-data labeling. Do not claim clinical suitability or invent nutrition values.
