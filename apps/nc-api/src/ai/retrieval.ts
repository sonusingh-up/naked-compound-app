import type { AskFilters, D1Database, Product, AIModelBinding, VectorizeIndex } from './types';

type ProductRow = Omit<Product, 'categories' | 'flags'> & { categories: string | string[]; flags: string | Record<string, unknown> | null; has_review?: number | boolean };

function jsonValue<T>(value: T | string | null, fallback: T): T {
  if (value === null) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function rowToProduct(row: ProductRow): Product {
  const rawFlags = jsonValue<unknown>(row.flags, null);
  const flags = rawFlags && typeof rawFlags === 'object' && !Array.isArray(rawFlags)
    ? Object.fromEntries(Object.entries(rawFlags).filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value))) as Product['flags']
    : null;
  return {
    id: row.id, brand: row.brand, name: row.name, score: row.score, grade: row.grade,
    summary: row.summary?.slice(0, 1000) ?? null, form: row.form, price_inr: row.price_inr,
    price_checked_at: row.price_checked_at, quantity: row.quantity,
    categories: jsonValue(row.categories, []), flags,
    cost_per_dose_inr: row.cost_per_dose_inr, updated_at: row.updated_at
  };
}

function ftsQuery(question: string): string {
  const stop = new Set(['best', 'which', 'what', 'under', 'below', 'within', 'with', 'without', 'for', 'the', 'and', 'are', 'is', 'can', 'you', 'me', 'tell', 'about', 'find', 'compare', 'versus', 'more', 'than', 'less', 'cheap', 'budget', 'price', 'avoid']);
  const terms = [...new Set((question.toLocaleLowerCase('en-IN').match(/[a-z0-9]+/g) ?? []).filter(word => word.length > 1 && !stop.has(word) && !/^\d+$/.test(word)))].slice(0, 10);
  return terms.map(word => `"${word}"`).join(' OR ');
}

function conditions(filters: AskFilters): { sql: string; values: unknown[] } {
  const where: string[] = ['p.score IS NOT NULL'];
  const values: unknown[] = [];
  if (filters.maxPrice !== undefined) { where.push('p.price_inr IS NOT NULL AND p.price_inr <= ?'); values.push(filters.maxPrice); }
  if (filters.category) { where.push('EXISTS (SELECT 1 FROM json_each(p.categories) WHERE value = ?)'); values.push(filters.category); }
  for (const flag of filters.flags) {
    if (flag === 'veg' || flag === 'fssai' || flag === 'third_party_tested') {
      where.push(`json_extract(p.flags, '$.${flag}') = 1`);
    } else if (flag === 'no_sucralose') {
      where.push("json_extract(p.flags, '$.sweetener') IS NOT NULL AND LOWER(json_extract(p.flags, '$.sweetener')) NOT LIKE '%sucralose%'");
    }
  }
  return { sql: where.join(' AND '), values };
}

const selectColumns = `p.id, p.brand, p.name, p.score, p.grade, p.summary, p.form, p.price_inr, p.price_checked_at, p.quantity, p.categories, p.flags, p.cost_per_dose_inr, p.updated_at`;

export async function retrieveProducts(input: {
  db: D1Database; ai?: AIModelBinding; vectorize?: VectorizeIndex;
  question: string; filters: AskFilters
}): Promise<Product[]> {
  const { db, ai, vectorize, question, filters } = input;
  const { sql, values } = conditions(filters);
  const fts = ftsQuery(question);
  const ftsRows = fts ? (await db.prepare(`SELECT ${selectColumns}, bm25(products_fts) AS search_rank FROM products_fts JOIN products p ON p.rowid = products_fts.rowid WHERE products_fts MATCH ? AND ${sql} ORDER BY search_rank LIMIT 20`).bind(fts, ...values).all<ProductRow & { search_rank: number }>()).results : [];
  const vectorRanks = new Map<string, number>();
  if (ai && vectorize) {
    try {
      const embedded = await ai.run('@cf/baai/bge-base-en-v1.5', { text: [question] }) as { data?: number[][] };
      const vector = embedded.data?.[0];
      if (vector?.length) {
        const matches = (await vectorize.query(vector, { topK: 20, returnMetadata: 'all' })).matches ?? [];
        matches.forEach((match, index) => vectorRanks.set(match.id, match.score ?? 1 - index / 20));
      }
    } catch {
      // Semantic retrieval is an enhancement. Keep the D1 full-text results on transient embedding/index errors.
    }
  }
  const vectorIds = [...vectorRanks.keys()].slice(0, 20);
  const vectorRows = vectorIds.length
    ? (await db.prepare(`SELECT ${selectColumns} FROM products p WHERE p.id IN (${vectorIds.map(() => '?').join(',')}) AND ${sql}`).bind(...vectorIds, ...values).all<ProductRow>()).results
    : [];
  const merged = new Map<string, { product: Product; ftsRank: number; vectorRank: number }>();
  for (const row of ftsRows) merged.set(row.id, { product: rowToProduct(row), ftsRank: Number(row.search_rank), vectorRank: vectorRanks.get(row.id) ?? 0 });
  for (const row of vectorRows) {
    const previous = merged.get(row.id);
    merged.set(row.id, { product: rowToProduct(row), ftsRank: previous?.ftsRank ?? Number.POSITIVE_INFINITY, vectorRank: vectorRanks.get(row.id) ?? 0 });
  }
  return [...merged.values()]
    .sort((a, b) => {
      const scoreDiff = (b.product.score ?? -1) - (a.product.score ?? -1);
      if (scoreDiff) return scoreDiff;
      const aCost = a.product.cost_per_dose_inr ?? Number.POSITIVE_INFINITY;
      const bCost = b.product.cost_per_dose_inr ?? Number.POSITIVE_INFINITY;
      if (aCost !== bCost) return aCost - bCost;
      return (b.vectorRank - a.vectorRank) || (a.ftsRank - b.ftsRank);
    })
    .slice(0, 12).map(item => item.product);
}

export async function makeHmacKey(secret: string, value: unknown): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(signed)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createCache(db: D1Database) {
  return {
    async get(key: string): Promise<{ answer: string; productIds: string[] } | null> {
      const row = await db.prepare('SELECT answer, product_ids FROM ai_cache WHERE key = ? AND created_at >= datetime(\'now\', \'-24 hours\')').bind(key).first<{ answer: string; product_ids: string }>();
      if (!row) return null;
      try { return { answer: row.answer, productIds: JSON.parse(row.product_ids) as string[] }; } catch { return null; }
    },
    async put(key: string, answer: string, productIds: string[]): Promise<void> {
      await db.prepare('INSERT INTO ai_cache (key, answer, product_ids, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET answer = excluded.answer, product_ids = excluded.product_ids, created_at = excluded.created_at').bind(key, answer, JSON.stringify(productIds)).run();
    }
  };
}
