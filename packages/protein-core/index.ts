import type { Category, Entry, Guidance, Target, TargetEvent, Unit } from '../shared-types';

export const RULE_VERSION = 'nc-adult-2026-11-v1';
export const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'] as const;
export const RULES = {
  adult: { low: 0.83, high: 0.83, label: 'Everyday health', description: 'Healthy adults, 18–65', source: 'ICMR-NIN 2020', url: 'https://www.nin.res.in/rdabook/brief_note.pdf' },
  older: { low: 1, high: 1.2, label: 'Over 65', description: 'Healthy older adults', source: 'PROT-AGE 2013', url: 'https://doi.org/10.1016/j.jamda.2013.05.021' },
  active: { low: 1.4, high: 2, label: 'Regular exercise', description: 'Consistent exercise or sport', source: 'ISSN 2017', url: 'https://doi.org/10.1186/s12970-017-0177-8' },
  muscle: { low: 1.6, high: 2.2, label: 'Resistance training', description: 'Training to build muscle', source: 'Morton 2018', url: 'https://doi.org/10.1136/bjsports-2017-097608' }
} as const;

export function numberInput(value: string): number {
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) throw new Error('Enter a valid number.');
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('Enter a finite number.');
  return n;
}
export function weightKg(value: string, unit: Unit): number {
  const weight = numberInput(value);
  const kg = unit === 'lb' ? weight / 2.20462 : weight;
  if (kg < 25 || kg > 300) throw new Error('Enter a weight between 25 and 300 kg (55.1155–661.386 lb).');
  return kg;
}
export function calculate(value: string, unit: Unit, category: Category): Guidance {
  const kg = weightKg(value, unit);
  const rule = RULES[category];
  return { low: kg * rule.low, high: kg * rule.high, kg, category, version: RULE_VERSION };
}
export function chooseTarget(guidance: Guidance | null, grams: number | null, mode: Target['mode']): void {
  if (mode === 'none') { if (grams !== null) throw new Error('Target-free tracking must not have a target.'); return; }
  if (grams === null || !Number.isFinite(grams) || grams <= 0 || grams > 1000) throw new Error('Enter a target above 0 and at most 1,000 g. This is an input limit, not a recommendation.');
  if (mode === 'selected' && (!guidance || grams < guidance.low || grams > guidance.high)) throw new Error('Choose within the calculated range, or select a manual target.');
}
export function contribution(protein: number | null, reference: number, grams: number): number | null {
  if (!Number.isFinite(reference) || reference <= 0 || !Number.isFinite(grams) || grams <= 0 || grams > 10000) throw new Error('Portion must be above 0 and at most 10,000 g.');
  if (protein === null) return null;
  if (!Number.isFinite(protein) || protein < 0) throw new Error('Nutrient value must be nonnegative.');
  return protein * grams / reference;
}
export function intake(entries: Entry[]): { grams: number; unknown: number } {
  return entries.reduce((sum, entry) => {
    const value = contribution(entry.food.protein, entry.food.referenceGrams, entry.grams);
    return { grams: sum.grams + (value ?? 0), unknown: sum.unknown + (value === null ? 1 : 0) };
  }, { grams: 0, unknown: 0 });
}
export function progress(total: number, target: number | null) {
  return { remaining: target === null ? null : Math.max(0, target - total), fraction: target === null ? 0 : Math.min(1, Math.max(0, total / target)) };
}
export function costPer25(price: number, packageGrams: number, proteinPer100: number | null): number | null {
  if (proteinPer100 === null || ![price, packageGrams, proteinPer100].every(Number.isFinite) || price < 0 || packageGrams <= 0 || proteinPer100 <= 0) return null;
  return price * 2500 / (packageGrams * proteinPer100);
}
export function localDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function shiftDate(date: string, offset: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return localDate(new Date(year, month - 1, day + offset, 12));
}
export function targetOnDate(events: TargetEvent[], date: string): TargetEvent | null {
  return events.filter(event => event.date <= date).sort((a, b) => b.date.localeCompare(a.date) || b.revision - a.revision)[0] ?? null;
}
export function display(value: number): string {
  return value.toLocaleString('en-IN', { maximumFractionDigits: 1 });
}
