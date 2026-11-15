import type { AskFilters, Intent } from './types';

const medicalPattern = /\b(pregnan(?:t|cy)|breast.?feed(?:ing)?|child(?:ren)?|kids?|toddler|infant|baby|kid(?:ney)? disease|renal disease|liver disease|heart condition|diabet(?:es|ic)|medication|meds?|medicine|drug interaction|diagnos(?:e|is)|treat(?:ment)?|symptom|side effects?|prescri(?:be|ption)|doctor|medical|safe|unsafe|harmful)\b|\b(?:personalized|my|recommended)\s+(?:dose|dosage)\b|\b(?:dose|dosage)\s+for\s+(?:me|my|a child|children|pregnancy)\b|\bhow much (?:should|can) i\b/i;
const productPattern = /\b(supplement|protein|whey|casein|creatine|omega.?3|fish oil|vitamin|multivitamin|magnesium|zinc|collagen|electrolyte|pre.?workout|amino acid|ashwagandha|product|brand|ingredient|fssai|label|review|nutrition|nutrition(?:al)?|powder|capsule|tablet)\b/i;
const comparePattern = /\b(compare|versus|\bvs\.?\b|better|between|alternative|rank)\b/i;
const explainPattern = /\b(what(?:'s| is| does)|explain|why|how does|meaning of|tell me about)\b/i;
const explicitExplainPattern = /\b(explain|why|how does|meaning of|tell me about)\b/i;
const recommendationPattern = /\b(best|top|recommend|find|suggest|show|available)\b/i;

export function classifyIntent(question: string): Intent {
  if (medicalPattern.test(question)) return 'medical';
  if (!productPattern.test(question)) return 'off-topic';
  if (explicitExplainPattern.test(question)) return 'explain';
  if (comparePattern.test(question)) return 'compare';
  if (recommendationPattern.test(question)) return 'find';
  if (explainPattern.test(question)) return 'explain';
  return 'find';
}

export function refusalFor(intent: Intent): string | null {
  if (intent === 'medical') return 'I can’t provide medical advice or product recommendations for that situation. Please speak with a doctor or pharmacist.';
  if (intent === 'off-topic') return 'I can help with supplements and nutrition products reviewed by Naked Compound. Ask about a product, ingredient, category or budget.';
  return null;
}

const categoryTerms: Array<[RegExp, string]> = [
  [/\bwhey\b/i, 'whey'], [/\bcreatine\b/i, 'creatine'], [/\bomega(?:.?3)?\b|\bfish oil\b/i, 'omega'],
  [/\bvitamin|multivitamin\b/i, 'vitamins'], [/\bashwagandha|adaptogen\b/i, 'adaptogens'], [/\bherbal\b/i, 'herbal']
];

export function parseFilters(question: string): AskFilters {
  const priceText = question.match(/\b(?:under|below|within|max(?:imum)?|less than)\s*(?:₹|rs\.?\s*)?([\d,]+)\b/i)?.[1];
  const price = priceText ? Number(priceText.replaceAll(',', '')) : undefined;
  const category = categoryTerms.find(([pattern]) => pattern.test(question))?.[1];
  const flags: string[] = [];
  if (/\b(vegetarian|veg)\b/i.test(question)) flags.push('veg');
  if (/\b(fssai|licensed)\b/i.test(question)) flags.push('fssai');
  if (/\b(third.?party tested|lab tested|tested)\b/i.test(question)) flags.push('third_party_tested');
  if (/\b(no sucralose|without sucralose|avoid sucralose)\b/i.test(question)) flags.push('no_sucralose');
  return { maxPrice: price && Number.isSafeInteger(price) && price > 0 ? price : undefined, category, flags };
}
