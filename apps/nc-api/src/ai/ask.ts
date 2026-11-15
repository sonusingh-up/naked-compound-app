import { classifyIntent, parseFilters, refusalFor } from './classify';
import { deterministicFallback, validateGrounding } from './grounding';
import { makeHmacKey } from './retrieval';
import { makeUserPrompt, SYSTEM_PROMPT } from './prompt';
import type { AskDependencies, AskInput, AskResult, Product } from './types';

function normalizeQuestion(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-IN').replace(/[^\p{L}\p{N}₹]+/gu, ' ').trim().slice(0, 1000);
}

export async function answerQuestion(input: AskInput, dependencies: AskDependencies): Promise<AskResult> {
  const intent = classifyIntent(input.question);
  const refusal = refusalFor(intent);
  if (refusal) return { answer: refusal, productIds: [], cached: false };
  const filters = parseFilters(input.question);
  const products = (await dependencies.retrieve(input.question, filters)).filter(product => product.score !== null).slice(0, 12);
  if (!products.length) return { ...deterministicFallback([]), cached: false };

  const cacheKey = dependencies.cacheSecret && input.history.length === 0
    ? await makeHmacKey(dependencies.cacheSecret, {
      question: normalizeQuestion(input.question), filters,
      products: products.map(product => [product.id, product.updated_at])
    })
    : null;
  if (cacheKey && dependencies.cache) {
    try {
      const cached = await dependencies.cache.get(cacheKey);
      if (cached) {
        const grounding = validateGrounding(cached.answer, products);
        const cachedIdsMatch = grounding.valid && JSON.stringify(cached.productIds) === JSON.stringify(grounding.productIds);
        if (grounding.valid && cachedIdsMatch) return { answer: cached.answer, productIds: grounding.productIds, cached: true };
      }
    } catch { /* cache failure must not prevent a grounded answer */ }
  }

  const userPrompt = makeUserPrompt(input.question, products);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const answer = await dependencies.generate(SYSTEM_PROMPT, userPrompt, input.history);
      const grounding = validateGrounding(answer, products);
      if (!grounding.valid) continue;
      if (cacheKey && dependencies.cache) {
        try { await dependencies.cache.put(cacheKey, answer, grounding.productIds); } catch { /* answer is valid without cache persistence */ }
      }
      return { answer, productIds: grounding.productIds, cached: false };
    } catch { break; }
  }

  const fallback = deterministicFallback(products);
  return { ...fallback, cached: false };
}

export function citationIdsForAnswer(answer: string, products: Product[]): string[] {
  const check = validateGrounding(answer, products);
  return check.valid ? check.productIds : [];
}
