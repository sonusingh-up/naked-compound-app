import { z } from 'zod';
import type { D1Database } from './ai/types';

const searchParamsSchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  min_score: z.coerce.number().min(0).max(10).optional(),
  max_price: z.coerce.number().int().min(0).max(1_000_000).optional(),
  flags: z.string().max(120).optional()
}).strict();

type DbProduct = {
  id: string; brand: string; name: string; score: number | null; grade: string | null; summary: string | null;
  form: string | null; price_inr: number | null; quantity: string | null; price_checked_at: string | null;
  categories: string; review_url: string | null; has_review: number; personally_tested: number;
  flags: string | null; cost_per_dose_inr: number | null;
};

const flagPaths: Record<string, string> = {
  vegetarian: '$.vegetarian',
  fssai: '$.fssai_verified',
  third_party_tested: '$.third_party_tested'
};

export function mapProduct(row: DbProduct) {
  let categories: string[] = [];
  let flags: Record<string, string | number | boolean | null> | null = null;
  try { const parsed: unknown = JSON.parse(row.categories); if (Array.isArray(parsed)) categories = parsed.filter((item): item is string => typeof item === 'string'); } catch { /* malformed catalog metadata stays absent */ }
  try { const parsed: unknown = row.flags ? JSON.parse(row.flags) : null; if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) flags = parsed as Record<string, string | number | boolean | null>; } catch { /* malformed catalog metadata stays absent */ }
  const reviewed = row.score !== null;
  if (!reviewed) return { id: row.id, brand: row.brand, name: row.name, review_state: 'unreviewed' as const };
  return {
    id: row.id, brand: row.brand, name: row.name,
    review_state: 'reviewed' as const,
    review_depth: row.has_review === 1 ? 'full' as const : 'scored' as const,
    score: row.score, grade: row.grade, summary: row.summary,
    form: row.form, price_inr: row.price_inr, price_checked_at: row.price_checked_at,
    quantity: row.quantity, categories, review_url: row.has_review === 1 ? row.review_url : null,
    personally_tested: row.personally_tested === 1, flags,
    cost_per_dose_inr: row.cost_per_dose_inr
  };
}

function ftsQuery(query: string): string {
  const words = query.match(/[\p{L}\p{N}]+/gu)?.slice(0, 8) ?? [];
  return words.map(word => `"${word.replaceAll('"', '""')}"`).join(' OR ');
}

export async function searchProducts(db: D1Database, params: URLSearchParams) {
  const raw = Object.fromEntries(params.entries());
  const parsed = searchParamsSchema.safeParse(raw);
  if (!parsed.success) return { error: 'invalid-query' as const };
  const input = parsed.data;
  const clauses = ['p.score IS NOT NULL'];
  const values: unknown[] = [];
  if (input.q) {
    const match = ftsQuery(input.q);
    if (match) { clauses.push('p.rowid IN (SELECT rowid FROM products_fts WHERE products_fts MATCH ?)'); values.push(match); }
  }
  if (input.category) { clauses.push('EXISTS (SELECT 1 FROM json_each(p.categories) WHERE lower(value) = lower(?))'); values.push(input.category); }
  if (input.min_score !== undefined) { clauses.push('p.score >= ?'); values.push(input.min_score); }
  if (input.max_price !== undefined) { clauses.push('p.price_inr <= ?'); values.push(input.max_price); }
  if (input.flags) {
    const requestedFlags = [...new Set(input.flags.split(',').map(flag => flag.trim()).filter(Boolean))];
    if (requestedFlags.some(flag => !flagPaths[flag])) return { error: 'invalid-query' as const };
    for (const flag of requestedFlags) { clauses.push(`json_extract(p.flags, '${flagPaths[flag]}') = 1`); }
  }
  const rows = await db.prepare(`SELECT p.* FROM products p WHERE ${clauses.join(' AND ')} ORDER BY p.score DESC, p.cost_per_dose_inr IS NULL ASC, p.cost_per_dose_inr ASC, p.id ASC`).bind(...values).all<DbProduct>();
  return { products: rows.results.map(mapProduct) };
}

export async function getProduct(db: D1Database, id: string) {
  const row = await db.prepare('SELECT * FROM products WHERE id = ? LIMIT 1').bind(id).first<DbProduct>();
  if (!row) return null;
  const product = mapProduct(row);
  if (product.review_state !== 'reviewed') {
    return { product, listings: [], alternatives: [] };
  }
  const listings = await db.prepare('SELECT affiliate_url FROM listings WHERE product_id = ? AND affiliate_url IS NOT NULL ORDER BY id ASC').bind(id).all<{ affiliate_url: string }>();
  const primaryCategory = product.categories[0];
  let alternatives: ReturnType<typeof mapProduct>[] = [];
  if (primaryCategory) {
    const altRows = await db.prepare(`SELECT * FROM products p WHERE p.id <> ? AND p.score IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(p.categories) WHERE lower(value) = lower(?)) AND p.score >= ? AND p.price_inr IS NOT NULL AND p.price_checked_at IS NOT NULL AND ? IS NOT NULL AND ? IS NOT NULL AND ABS(p.price_inr - ?) <= ? ORDER BY p.score DESC, p.cost_per_dose_inr IS NULL ASC, p.cost_per_dose_inr ASC, p.id ASC LIMIT 5`)
      .bind(id, primaryCategory, (product.score ?? 0) + 0.5, product.price_inr, row.price_checked_at, product.price_inr, (product.price_inr ?? 0) * 0.3).all<DbProduct>();
    alternatives = altRows.results.map(mapProduct);
  }
  return { product, listings: listings.results.map(row => ({ href: row.affiliate_url })), alternatives };
}
