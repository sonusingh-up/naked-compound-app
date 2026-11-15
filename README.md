# Naked Compound app

Standalone repository for the Naked Compound app API, web front, design references, and protein-core rules. The separate website repository is the source of reviewed product records; this repository keeps a local catalog mirror at `data/products.json`.

## Requirements

- Node.js 24
- npm

## Commands

```powershell
# Refresh this repository's catalog mirror from a supplied website-repo export
npm run sync-products -- D:\path\to\website-repo\project\data\products.json

# Run all API and Pages-front tests
cd apps/nc-api
npm ci
npm test
npm run typecheck

# Run the Pages front locally with the API service binding
cd ../nc-web
npm run typecheck
npm run dev
```

The sync command only reads the supplied source file and writes `data/products.json`; it never edits the source repository. The API seed script reads this local mirror.

See [AGENTS.md](AGENTS.md) for repository rules and [docs/nc-app/00-overview.md](docs/nc-app/00-overview.md) for product scope.
