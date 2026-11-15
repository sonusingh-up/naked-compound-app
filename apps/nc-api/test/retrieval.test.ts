import { describe, expect, it } from 'vitest';
import { retrieveProducts } from '../src/ai/retrieval';
import type { AskFilters, D1Database, D1Statement, Product, AIModelBinding, VectorizeIndex } from '../src/ai/types';

function row(id: string, score: number, updated_at: string) {
  return { id, brand: `Brand ${id}`, name: `Whey ${id}`, score, grade: 'B', summary: 'fixture', form: 'powder', price_inr: 1000, price_checked_at: '2026-11-01', quantity: '500 g', categories: '["whey"]', flags: '{"veg":1,"fssai":1}', cost_per_dose_inr: null, updated_at, has_review: 1 };
}

class Statement implements D1Statement {
  values: unknown[] = [];
  constructor(readonly sql: string, private rows: Map<string, ReturnType<typeof row>>) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async all<T>() {
    if (this.sql.includes('bm25')) return { results: [{ ...this.rows.get('fts-only')!, search_rank: -1 }] as T[] };
    const ids = this.values.filter(value => typeof value === 'string');
    return { results: ids.map(id => this.rows.get(id as string)).filter(Boolean) as T[] };
  }
  async first<T>() { return null as T | null; }
  async run() { return {}; }
}

describe('D1 and Vectorize retrieval', () => {
  it('combines full-text and vector results while filtering unreviewed and over-budget rows', async () => {
    const rows = new Map([['fts-only', row('fts-only', 8.1, '2026-11-01')], ['vector-only', row('vector-only', 7.2, '2026-11-02')]]);
    const statements: Statement[] = [];
    const db: D1Database = { prepare(sql) { const statement = new Statement(sql, rows); statements.push(statement); return statement; } };
    const ai: AIModelBinding = { async run(model, input) { expect(model).toBe('@cf/baai/bge-base-en-v1.5'); expect(input.text).toEqual(['whey']); return { data: [[0.1, 0.2, 0.3]] }; } };
    const vectorize: VectorizeIndex = { async query(vector, options) { expect(vector).toEqual([0.1, 0.2, 0.3]); expect(options.topK).toBe(20); return { matches: [{ id: 'vector-only', score: 0.9 }] }; } };
    const filters: AskFilters = { maxPrice: 3000, category: 'whey', flags: ['veg', 'fssai'] };
    const products: Product[] = await retrieveProducts({ db, ai, vectorize, question: 'whey', filters });
    expect(products.map(product => product.id)).toEqual(['fts-only', 'vector-only']);
    expect(statements[0].sql).not.toContain('p.has_review = 1');
    expect(statements[0].sql).toContain('p.score IS NOT NULL');
    expect(statements[0].sql).toContain('json_each(p.categories)');
    expect(statements[0].values).toEqual(['"whey"', 3000, 'whey']);
  });

  it('falls back to full text if embedding or Vectorize fails', async () => {
    const rows = new Map([['fts-only', row('fts-only', 7.2, '2026-11-01')]]);
    const db: D1Database = { prepare(sql) { return new Statement(sql, rows); } };
    const ai: AIModelBinding = { async run() { throw new Error('model unavailable'); } };
    const vectorize: VectorizeIndex = { async query() { throw new Error('index unavailable'); } };
    const products = await retrieveProducts({ db, ai, vectorize, question: 'whey', filters: { flags: [] } });
    expect(products.map(product => product.id)).toEqual(['fts-only']);
  });
});
