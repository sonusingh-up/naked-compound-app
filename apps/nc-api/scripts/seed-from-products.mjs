import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const apiDirectory = dirname(fileURLToPath(import.meta.url)).replace(/[\\/]scripts$/, '');
const repoDirectory = resolve(apiDirectory, '../..');
const path = resolve(repoDirectory, 'data/products.json');
const output = resolve(apiDirectory, '.local-seed.sql');
const input = JSON.parse(await readFile(path, 'utf8'));
const productSchema = z.object({
  id: z.string().min(1), brand: z.string(), name: z.string(),
  score: z.number().min(0).max(10).nullable().optional(), grade: z.string().nullable().optional(),
  summary: z.string().nullable().optional(), form: z.string().nullable().optional(),
  price_inr: z.number().int().nonnegative().nullable().optional(), quantity: z.string().nullable().optional(),
  categories: z.array(z.string()).default([]), url: z.string().url().nullable().optional(),
  has_review: z.boolean().default(false),
  personally_tested: z.union([
    z.boolean(),
    z.object({ bought: z.string().nullable().optional(), used_until: z.string().nullable().optional() }).passthrough(),
    z.null()
  ]).optional()
}).passthrough();
const dataSchema = z.object({ _meta: z.object({ version: z.string() }), products: z.array(productSchema) });
const parsed = dataSchema.parse(input);

function sql(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

const statements = parsed.products.map(product => {
  const reviewed = product.has_review && product.score !== null && product.score !== undefined;
  const personallyTested = typeof product.personally_tested === 'boolean'
    ? product.personally_tested
    : Boolean(product.personally_tested && typeof product.personally_tested === 'object' && product.personally_tested.bought);
  const row = [
    product.id, product.brand, product.name, reviewed ? product.score : null, reviewed ? product.grade ?? null : null,
    reviewed ? product.summary ?? null : null, product.form ?? null, product.price_inr ?? null,
    product.quantity ?? null, null, JSON.stringify(product.categories), product.url ?? null,
    reviewed ? 1 : 0, personallyTested ? 1 : 0, null, null, null, `dataset:${parsed._meta.version}`
  ];
  return `INSERT OR REPLACE INTO products (id, brand, name, score, grade, summary, form, price_inr, quantity, price_checked_at, categories, review_url, has_review, personally_tested, image_key, flags, cost_per_dose_inr, updated_at) VALUES (${row.map(sql).join(', ')});`;
});
await writeFile(output, `BEGIN TRANSACTION;\n${statements.join('\n')}\nCOMMIT;\n`, 'utf8');
process.stdout.write(`Prepared ${statements.length} reviewed-catalog rows in ${output}. No price-check dates or product flags were inferred.\n`);
