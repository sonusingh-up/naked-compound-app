import { describe, expect, it } from 'vitest';
import { answerQuestion } from '../src/ai/ask';
import { classifyIntent, parseFilters } from '../src/ai/classify';
import { deterministicFallback, validateGrounding } from '../src/ai/grounding';
import { makeHmacKey } from '../src/ai/retrieval';
import type { AskDependencies, Product } from '../src/ai/types';

// Synthetic, test-only records. Never used by the production seed or deployed catalog.
const fixture: Product = {
  id: 'fixture-reviewed-whey', brand: 'Fixture Nutrition', name: 'Fixture Whey Isolate',
  score: 7.9, grade: 'B', summary: 'Test-only record for grounded response evaluation.', form: 'powder',
  price_inr: 1299, price_checked_at: '2026-11-01', quantity: '500 g', categories: ['whey'],
  flags: { veg: true, fssai: true, third_party_tested: false, sweetener: 'none' },
  cost_per_dose_inr: 18, updated_at: '2026-11-01T00:00:00.000Z'
};
const fixtureCatalog: Product[] = [
  fixture,
  { ...fixture, id: 'fixture-reviewed-creatine', brand: 'Fixture Nutrition', name: 'Fixture Creatine', score: 8.4, grade: 'A', price_inr: 999, categories: ['creatine'], cost_per_dose_inr: 4 },
  { ...fixture, id: 'fixture-reviewed-omega', brand: 'Fixture Nutrition', name: 'Fixture Omega', score: 7.2, grade: 'B', price_inr: 899, categories: ['omega'], cost_per_dose_inr: 12 },
  { ...fixture, id: 'fixture-reviewed-vitamin', brand: 'Fixture Nutrition', name: 'Fixture Vitamin', score: 7.6, grade: 'B', price_inr: 499, categories: ['vitamins'], cost_per_dose_inr: 5 },
  { ...fixture, id: 'fixture-reviewed-magnesium', brand: 'Fixture Nutrition', name: 'Fixture Magnesium', score: 7.4, grade: 'B', price_inr: 599, categories: ['minerals'], cost_per_dose_inr: 6 },
  { ...fixture, id: 'fixture-reviewed-collagen', brand: 'Fixture Nutrition', name: 'Fixture Collagen', score: 6.9, grade: 'C', price_inr: 1199, categories: ['protein'], cost_per_dose_inr: 22 }
];

const questions: Array<{ question: string; intent: 'find' | 'compare' | 'explain' | 'off-topic' | 'medical' }> = [
  { question: 'Recommend a whey protein under ₹3,000', intent: 'find' },
  { question: 'Find a creatine supplement', intent: 'find' },
  { question: 'Suggest an omega 3 product', intent: 'find' },
  { question: 'Which vitamin products are reviewed?', intent: 'find' },
  { question: 'Find a magnesium supplement', intent: 'find' },
  { question: 'Any reviewed collagen powder?', intent: 'find' },
  { question: 'Show me an electrolyte product', intent: 'find' },
  { question: 'Find a vegetarian protein supplement', intent: 'find' },
  { question: 'Do you have FSSAI licensed whey?', intent: 'find' },
  { question: 'Find a third party tested creatine', intent: 'find' },
  { question: 'Compare whey protein and creatine', intent: 'compare' },
  { question: 'Which is better, whey or casein?', intent: 'compare' },
  { question: 'Compare omega 3 supplements', intent: 'compare' },
  { question: 'What is the best reviewed vitamin?', intent: 'find' },
  { question: 'Which magnesium product is better?', intent: 'compare' },
  { question: 'Rank reviewed creatine products', intent: 'compare' },
  { question: 'Find an alternative to my current whey', intent: 'compare' },
  { question: 'Compare two protein powder options', intent: 'compare' },
  { question: 'Which supplement has the better value?', intent: 'compare' },
  { question: 'Best omega 3 under ₹2,000 versus fish oil', intent: 'compare' },
  { question: 'What is whey protein?', intent: 'explain' },
  { question: 'Explain the difference between creatine forms', intent: 'explain' },
  { question: 'What is omega 3?', intent: 'explain' },
  { question: 'Why does a whey label show scoop weight?', intent: 'explain' },
  { question: 'Tell me about protein powder labels', intent: 'explain' },
  { question: 'What does an FSSAI licence mean on a supplement?', intent: 'explain' },
  { question: 'Explain cost per effective dose for creatine', intent: 'explain' },
  { question: 'What is a third party tested supplement?', intent: 'explain' },
  { question: 'How does Naked Compound review vitamins?', intent: 'explain' },
  { question: 'Why compare protein products by their NC reviews?', intent: 'explain' },
  { question: 'Which whey should I take during pregnancy?', intent: 'medical' },
  { question: 'Is creatine safe for a 5 year old?', intent: 'medical' },
  { question: 'Recommend a supplement with my kidney disease', intent: 'medical' },
  { question: 'Can I take whey with my medication?', intent: 'medical' },
  { question: 'Diagnose my symptoms and suggest a vitamin', intent: 'medical' },
  { question: 'What is the weather in Mumbai?', intent: 'off-topic' },
  { question: 'Write a JavaScript function to sort numbers', intent: 'off-topic' },
  { question: 'Who won yesterday’s cricket match?', intent: 'off-topic' },
  { question: 'Recommend a movie for tonight', intent: 'off-topic' },
  { question: 'Tell me a joke about trains', intent: 'off-topic' }
];

function recordedAnswer(products: Product[]): string {
  return products.map(product => `${product.name} scores ${product.score}/10, grade ${product.grade}, and costs ₹${product.price_inr} (checked ${product.price_checked_at}) [${product.id}].`).join('\n');
}

function fixturesFor(question: string): Product[] {
  const q = question.toLowerCase();
  const matches = fixtureCatalog.filter(product => product.categories.some(category => q.includes(category)) ||
    (product.id.includes('whey') && /protein|casein|whey/.test(q)) ||
    (product.id.includes('magnesium') && /magnesium/.test(q)) ||
    (product.id.includes('collagen') && /collagen/.test(q)));
  const selected = matches.length ? matches : fixtureCatalog;
  return selected.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 4);
}

function dependencies(overrides: Partial<AskDependencies> = {}): AskDependencies {
  return {
    retrieve: async () => [fixture],
    generate: async () => recordedAnswer([fixture]),
    cacheSecret: 'test-only-hmac-secret',
    ...overrides
  };
}

describe('Ask NC recorded 40-question evaluation', () => {
  it.each(questions)('$intent: $question', async ({ question, intent }) => {
    expect(classifyIntent(question)).toBe(intent);
    let calls = 0;
    const expected = intent === 'medical' || intent === 'off-topic' ? [] : fixturesFor(question);
    const result = await answerQuestion({ question, history: [] }, dependencies({
      retrieve: async () => expected,
      generate: async () => { calls++; return recordedAnswer(expected); }
    }));
    if (intent === 'medical' || intent === 'off-topic') {
      expect(result.productIds).toEqual([]);
      expect(calls).toBe(0);
    } else {
      expect(result.productIds).toEqual(expected.map(product => product.id));
      for (const product of expected) expect(result.answer).toContain(`[${product.id}]`);
      expect(validateGrounding(result.answer, expected).valid).toBe(true);
      expect(calls).toBe(1);
    }
  });
});

describe('editorial grounding and deterministic failure behavior', () => {
  it('retries a hallucinated numeric claim once and then uses only fixture fields', async () => {
    let calls = 0;
    const result = await answerQuestion({ question: 'Recommend a whey supplement', history: [] }, dependencies({ generate: async () => {
      calls++;
      return calls === 1 ? `${fixture.name} scores 9.8/10. [${fixture.id}]` : 'Fixture Whey Isolate costs ₹999. [fixture-reviewed-whey]';
    } }));
    expect(calls).toBe(2);
    expect(result.answer).toContain('7.9/10');
    expect(result.answer).toContain('₹1299');
    expect(validateGrounding(result.answer, [fixture]).valid).toBe(true);
  });

  it('rejects ungrounded citations, uncited known names, retailer names and unsupported grades', () => {
    expect(validateGrounding('Unknown item [not-retrieved]', [fixture]).valid).toBe(false);
    expect(validateGrounding('Fixture Whey Isolate looks good.', [fixture]).valid).toBe(false);
    expect(validateGrounding(`Fixture Whey Isolate sold on Amazon [${fixture.id}]`, [fixture]).valid).toBe(false);
    expect(validateGrounding(`Fixture Whey Isolate is grade A [${fixture.id}]`, [fixture]).valid).toBe(false);
    expect(validateGrounding('The records look useful.', [fixture]).valid).toBe(false);
  });

  it('returns a no-review response and no citations for empty retrieval', async () => {
    const result = await answerQuestion({ question: 'Recommend a reviewed vitamin', history: [] }, dependencies({ retrieve: async () => [] }));
    expect(result.answer).toContain("Naked Compound hasn't reviewed");
    expect(result.productIds).toEqual([]);
  });

  it('never caches answers when prior-turn context changes meaning', async () => {
    let writes = 0;
    const cache = { get: async () => null, put: async () => { writes++; } };
    await answerQuestion({ question: 'Recommend whey', history: [{ role: 'user', content: 'I prefer unflavoured.' }] }, dependencies({ cache }));
    expect(writes).toBe(0);
  });

  it('uses keyed HMAC cache keys that change with retrieval data', async () => {
    const first = await makeHmacKey('test-key', { question: 'whey', products: [['a', 'v1']] });
    const changed = await makeHmacKey('test-key', { question: 'whey', products: [['a', 'v2']] });
    expect(first).not.toBe(changed);
    expect(first).not.toContain('whey');
  });

  it('parses explicit filters without guessing absent criteria', () => {
    expect(parseFilters('Best vegetarian whey under ₹3,000 without sucralose')).toEqual({ maxPrice: 3000, category: 'whey', flags: ['veg', 'no_sucralose'] });
    expect(parseFilters('Tell me about supplements')).toEqual({ maxPrice: undefined, category: undefined, flags: [] });
  });

  it('builds fallback recommendations only from retrieved products and available fields', () => {
    const fallback = deterministicFallback([fixture]);
    expect(fallback.answer).toContain('₹1299');
    expect(fallback.answer).toContain(`[${fixture.id}]`);
    expect(fallback.productIds).toEqual([fixture.id]);
    const filtered = deterministicFallback([{ ...fixture, brand: 'Amazon Basics' }]);
    expect(filtered.productIds).toEqual([]);
    expect(filtered.answer).not.toContain('Amazon');
  });
});
