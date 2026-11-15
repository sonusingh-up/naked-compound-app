import { readFile, rename, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const sourceArgument = process.argv[2];
if (!sourceArgument || process.argv.length > 3) {
  console.error('Usage: npm run sync-products -- <path-to-products.json>');
  process.exit(2);
}

const source = resolve(sourceArgument);
const destination = resolve('data/products.json');
if (source === destination) {
  console.error('The source path is already data/products.json. Supply the website repository export path.');
  process.exit(2);
}

const contents = await readFile(source);
let catalog;
try {
  catalog = JSON.parse(contents.toString('utf8'));
} catch {
  throw new Error(`Source file is not valid JSON: ${source}`);
}

if (!catalog || typeof catalog !== 'object' || !catalog._meta || typeof catalog._meta.version !== 'string' || !Array.isArray(catalog.products)) {
  throw new Error(`Expected ${basename(source)} to contain _meta.version and a products array.`);
}

const ids = new Set();
for (const [index, product] of catalog.products.entries()) {
  if (!product || typeof product !== 'object' || typeof product.id !== 'string' || !product.id.trim() || typeof product.brand !== 'string' || typeof product.name !== 'string') {
    throw new Error(`Product at index ${index} must have string id, brand, and name fields.`);
  }
  if (ids.has(product.id)) throw new Error(`Duplicate product id at index ${index}: ${product.id}`);
  ids.add(product.id);
}

const temporary = `${destination}.${randomUUID()}.tmp`;
try {
  await writeFile(temporary, contents);
  await rename(temporary, destination);
} catch (error) {
  await import('node:fs/promises').then(({ rm }) => rm(temporary, { force: true }));
  throw error;
}

process.stdout.write(`Synced ${catalog.products.length} products (catalog ${catalog._meta.version}) from ${source} to ${destination}. The source was not modified.\n`);
