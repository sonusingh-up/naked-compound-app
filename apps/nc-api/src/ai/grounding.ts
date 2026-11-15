import type { Product } from './types';

export type GroundingResult = { valid: true; productIds: string[] } | { valid: false; reason: string };

function numberKey(value: string | number): string {
  return String(value).replaceAll(',', '').replace(/\.0+$/, '').trim();
}

export function validateGrounding(answer: string, retrieved: Product[]): GroundingResult {
  const byId = new Map(retrieved.map(product => [product.id, product]));
  const citations = [...answer.matchAll(/\[([^\]]+)\]/g)].map(match => match[1]);
  const ids = [...new Set(citations)];
  if (ids.some(id => !byId.has(id))) return { valid: false, reason: 'citation-outside-retrieval' };
  if (retrieved.length > 0 && ids.length === 0) return { valid: false, reason: 'missing-product-citation' };

  if (/\bamazon\b|\bflipkart\b|\bnykaa\b|\bhealthkart\b/i.test(answer)) return { valid: false, reason: 'retailer-mentioned' };
  const sentences = answer.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  for (const sentence of sentences) {
    const sentenceLower = sentence.toLocaleLowerCase('en-IN');
    const citedProducts = [...new Set([...sentence.matchAll(/\[([^\]]+)\]/g)].map(match => byId.get(match[1])).filter((product): product is Product => !!product))];
    for (const product of retrieved) {
      for (const name of [product.name, product.brand].filter(Boolean)) {
        if (name.length >= 4 && sentenceLower.includes(name.toLocaleLowerCase('en-IN')) && !citedProducts.some(cited => cited.id === product.id)) {
          return { valid: false, reason: 'uncited-product' };
        }
      }
    }
    const priceClaims = [
      ...[...sentence.matchAll(/₹\s*([\d,]+(?:\.\d+)?)/g)].map(match => match[1]),
      ...[...sentence.matchAll(/\b(?:INR|Rs\.?|rupees?)\s*([\d,]+(?:\.\d+)?)/gi)].map(match => match[1])
    ];
    for (const claim of priceClaims) {
      const value = numberKey(claim);
      if (!citedProducts.some(product => product.price_checked_at !== null && [product.price_inr, product.cost_per_dose_inr].some(known => known !== null && numberKey(known) === value))) {
        return { valid: false, reason: 'unsupported-price' };
      }
    }
    const scoreClaims = [
      ...[...sentence.matchAll(/\b(\d+(?:\.\d+)?)\s*\/\s*10\b/g)].map(match => match[1]),
      ...[...sentence.matchAll(/\bscore\s*(?:of|:)?\s*(\d+(?:\.\d+)?)\b/gi)].map(match => match[1]),
      ...[...sentence.matchAll(/\brated\s+(?:at\s+)?(\d+(?:\.\d+)?)\b/gi)].map(match => match[1]),
      ...[...sentence.matchAll(/\b(\d+(?:\.\d+)?)\s+points?\b/gi)].map(match => match[1])
    ];
    if (scoreClaims.some(value => !citedProducts.some(product => product.score !== null && numberKey(product.score) === numberKey(value)))) {
      return { valid: false, reason: 'unsupported-score' };
    }
    const grades = [...sentence.matchAll(/\bgrade\s+([A-F])\b/gi)].map(match => match[1].toUpperCase());
    if (grades.some(grade => !citedProducts.some(product => product.grade?.toUpperCase() === grade))) {
      return { valid: false, reason: 'unsupported-grade' };
    }
  }
  return { valid: true, productIds: ids };
}

export function deterministicFallback(products: Product[]): { answer: string; productIds: string[] } {
  if (!products.length) return { answer: "Naked Compound hasn't reviewed a product that fits this yet. You can request a review.", productIds: [] };
  const safeProducts = products.filter(product => !/\bamazon\b|\bflipkart\b|\bnykaa\b|\bhealthkart\b/i.test(`${product.brand} ${product.name}`));
  if (!safeProducts.length) return { answer: 'I could not prepare a verified response from the available records. You can request a review.', productIds: [] };
  const answer = [
    'Here are reviewed options from Naked Compound:',
    ...safeProducts.slice(0, 5).map(product => {
      const facts = [
        product.score === null ? null : `NC score ${product.score}/10`,
        product.grade ? `grade ${product.grade}` : null,
        product.price_inr === null || product.price_checked_at === null ? null : `₹${product.price_inr} (checked ${product.price_checked_at})`
      ].filter(Boolean).join(' · ');
      return `- ${product.name}${facts ? ` — ${facts}` : ''} [${product.id}]`;
    })
  ].join('\n');
  return { answer, productIds: safeProducts.slice(0, 5).map(product => product.id) };
}
