import type { D1Database } from './ai/types';
import { mapProduct } from './catalog';
import { castReviewVote } from './accounts';

const retailerHosts: Record<string, string[]> = {
  amazon_in: ['amazon.in'], flipkart: ['flipkart.com'], nykaa: ['nykaa.com'], healthkart: ['healthkart.com']
};
const shortHostRetailer: Record<string, string> = { 'amzn.to': 'amazon_in', 'fkrt.it': 'flipkart' };
const identifierPattern = /^[A-Za-z0-9_-]{1,128}$/;

type ParsedLink = { retailer: string; externalId: string; titleGuess: string | null; source: 'url' | 'gtin' };
type ResolveResult = { status: 'matched' | 'unreviewed' | 'unknown'; product?: unknown; betterPick?: unknown; requestId?: string; confidence?: 'probable' };
type ResolvableProduct = Record<string, unknown> & { has_review: number; score: number | null; price_inr: number | null; categories: string };

function isPrivateHost(host: string): boolean {
  const value = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local') || value.endsWith('.internal')) return true;
  if (value.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return true;
  return false;
}

function supportedHost(host: string, brandHosts: string[]): { retailer: string; isShort: boolean } | null {
  if (isPrivateHost(host)) return null;
  if (shortHostRetailer[host]) return { retailer: shortHostRetailer[host], isShort: true };
  for (const [retailer, hosts] of Object.entries(retailerHosts)) {
    if (hosts.some(base => host === base || host.endsWith(`.${base}`))) return { retailer, isShort: false };
  }
  const brandHost = brandHosts.find(base => host === base || host.endsWith(`.${base}`));
  return brandHost ? { retailer: 'brand', isShort: false } : null;
}

function validateUrl(raw: string, brandHosts: string[]): { url: URL; retailer: string; isShort: boolean } | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const supported = supportedHost(host, brandHosts);
    return supported ? { url, ...supported } : null;
  } catch { return null; }
}

async function expandShortUrl(raw: string, hosts: string[]): Promise<{ url: URL; retailer: string } | null> {
  let current = raw;
  for (let hop = 0; hop <= 3; hop++) {
    const parsed = validateUrl(current, hosts);
    if (!parsed) return null;
    if (!parsed.isShort) return { url: parsed.url, retailer: parsed.retailer };
    if (hop === 3) return null;
    let response: Response;
    try { response = await fetch(parsed.url, { method: 'HEAD', redirect: 'manual', headers: { accept: '*/*' } }); }
    catch { return null; }
    if (response.status < 300 || response.status >= 400) return null;
    const location = response.headers.get('location');
    if (!location) return null;
    try { current = new URL(location, parsed.url).toString(); } catch { return null; }
    // Validate each Location before making the next request.
    const next = validateUrl(current, hosts);
    if (!next) return null;
  }
  return null;
}

function titleFromPath(pathname: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { decoded = pathname; }
  const words = decoded.split('/').filter(Boolean)
    .map(part => part.replace(/[-_]+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim())
    .filter(part => part.length > 1 && !/^(dp|gp|product|p|sv)$/i.test(part)).slice(-5);
  const title = words.join(' ').replace(/\s+/g, ' ').slice(0, 120).trim();
  return title || null;
}

function parseProductLink(url: URL, retailer: string, allowedBrandHosts: string[]): ParsedLink | null {
  let externalId: string | null = null;
  if (retailer === 'amazon_in') externalId = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Za-z0-9]{10})(?:\/|$)/i)?.[1] ?? null;
  if (retailer === 'flipkart') externalId = url.searchParams.get('pid');
  if (retailer === 'nykaa') externalId = url.pathname.match(/\/p\/([A-Za-z0-9_-]{1,128})(?:\/|$)/i)?.[1] ?? null;
  if (retailer === 'healthkart') externalId = url.pathname.match(/\/sv\/([A-Za-z0-9_-]{1,128})(?:\/|$)/i)?.[1] ?? null;
  if (retailer === 'brand') {
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!allowedBrandHosts.some(base => host === base || host.endsWith(`.${base}`))) return null;
    externalId = url.pathname.split('/').filter(Boolean).at(-1)?.slice(0, 128) ?? null;
  }
  if (!externalId || !identifierPattern.test(externalId)) return null;
  return { retailer, externalId, titleGuess: titleFromPath(url.pathname), source: 'url' };
}

async function createReviewRequest(db: D1Database, input: ParsedLink, userId: string | null, voterKey: string | null): Promise<string> {
  const existing = input.source === 'gtin'
    ? await db.prepare("SELECT id FROM review_requests WHERE status = 'open' AND gtin = ? ORDER BY created_at ASC LIMIT 1").bind(input.externalId).first<{ id: string }>()
    : await db.prepare("SELECT id FROM review_requests WHERE status = 'open' AND retailer = ? AND external_id = ? ORDER BY created_at ASC LIMIT 1").bind(input.retailer, input.externalId).first<{ id: string }>();
  if (existing) {
    if (voterKey) await castReviewVote(db, existing.id, voterKey, userId);
    return existing.id;
  }
  if (!voterKey) return '';
  const proposedId = crypto.randomUUID();
  await db.prepare('INSERT OR IGNORE INTO review_requests (id, created_at, user_id, source, retailer, external_id, gtin, title_guess, votes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)')
    .bind(proposedId, new Date().toISOString(), userId, input.source, input.source === 'gtin' ? null : input.retailer, input.source === 'gtin' ? null : input.externalId, input.source === 'gtin' ? input.externalId : null, input.titleGuess).run();
  const request = input.source === 'gtin'
    ? await db.prepare("SELECT id FROM review_requests WHERE status = 'open' AND gtin = ? ORDER BY created_at ASC LIMIT 1").bind(input.externalId).first<{ id: string }>()
    : await db.prepare("SELECT id FROM review_requests WHERE status = 'open' AND retailer = ? AND external_id = ? ORDER BY created_at ASC LIMIT 1").bind(input.retailer, input.externalId).first<{ id: string }>();
  if (!request) return '';
  await castReviewVote(db, request.id, voterKey, userId);
  return request.id;
}

async function productByListing(db: D1Database, retailer: string, externalId: string) {
  return db.prepare('SELECT p.* FROM listings l JOIN products p ON p.id = l.product_id WHERE l.retailer = ? AND l.external_id = ? LIMIT 1').bind(retailer, externalId).first<ResolvableProduct>();
}

async function betterPick(db: D1Database, product: ResolvableProduct) {
  let categories: string[] = [];
  try { const value: unknown = JSON.parse(product.categories); if (Array.isArray(value)) categories = value.filter((v): v is string => typeof v === 'string'); } catch { /* no category means no comparable alternative */ }
  if (!categories[0] || product.score === null || product.price_inr === null || typeof product.price_checked_at !== 'string') return null;
  const row = await db.prepare(`SELECT * FROM products p WHERE p.id <> ? AND p.score >= ? AND p.price_inr IS NOT NULL AND p.price_checked_at IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(p.categories) WHERE lower(value) = lower(?)) AND ABS(p.price_inr - ?) <= ? ORDER BY p.score DESC, p.cost_per_dose_inr IS NULL ASC, p.cost_per_dose_inr ASC LIMIT 1`)
    .bind(product.id, product.score + 0.5, categories[0], product.price_inr, product.price_inr * 0.3).first<ResolvableProduct>();
  return row ? mapProduct(row as never) : null;
}

async function findProbable(db: D1Database, title: string | null): Promise<ResolvableProduct | null> {
  if (!title) return null;
  const words = title.match(/[\p{L}\p{N}]+/gu)?.slice(0, 8) ?? [];
  if (!words.length) return null;
  const match = words.map(word => `"${word.replaceAll('"', '""')}"`).join(' OR ');
  const rows = await db.prepare('SELECT p.*, bm25(products_fts) AS rank FROM products_fts JOIN products p ON p.rowid = products_fts.rowid WHERE products_fts MATCH ? AND p.score IS NOT NULL ORDER BY rank ASC LIMIT 2').bind(match).all<ResolvableProduct & { rank: number }>();
  const first = rows.results[0];
  if (!first || first.rank > -3 || (rows.results[1] && rows.results[1].rank - first.rank < 1)) return null;
  return first;
}

export async function resolveLink(db: D1Database, input: { url?: string; gtin?: string }, userId: string | null, voterKey: string | null, brandHostsCsv = ''): Promise<ResolveResult> {
  const brandHosts = brandHostsCsv.split(',').map(host => host.trim().toLowerCase()).filter(host => /^[a-z0-9.-]+$/.test(host) && !isPrivateHost(host));
  let row: ResolvableProduct | null = null;
  let parsed: ParsedLink | null = null;
  if (input.gtin) {
    const gtin = input.gtin;
    row = await db.prepare('SELECT p.* FROM listings l JOIN products p ON p.id = l.product_id WHERE l.gtin = ? LIMIT 1').bind(gtin).first<ResolvableProduct>();
    if (!row) parsed = { retailer: 'barcode', externalId: gtin, titleGuess: null, source: 'gtin' };
  } else if (input.url) {
    let resolved = validateUrl(input.url, brandHosts);
    if (!resolved) return { status: 'unknown' };
    if (resolved.isShort) {
      const expanded = await expandShortUrl(input.url, brandHosts);
      if (!expanded) return { status: 'unknown' };
      resolved = { url: expanded.url, retailer: expanded.retailer, isShort: false };
    }
    parsed = parseProductLink(resolved.url, resolved.retailer, brandHosts);
    if (!parsed) return { status: 'unknown' };
    row = await productByListing(db, parsed.retailer, parsed.externalId);
  }
  if (row) {
    const product = mapProduct(row as never);
    if (product.review_state !== 'reviewed') return { status: 'unreviewed', product };
    return { status: 'matched', product, betterPick: await betterPick(db, row) ?? undefined };
  }
  const probable = parsed?.source === 'url' ? await findProbable(db, parsed.titleGuess) : null;
  if (probable) return { status: 'matched', confidence: 'probable', product: mapProduct(probable as never), betterPick: await betterPick(db, probable) ?? undefined };
  if (!parsed) return { status: 'unknown' };
  const requestId = await createReviewRequest(db, parsed, userId, voterKey);
  return requestId ? { status: 'unknown', requestId } : { status: 'unknown' };
}

export const resolveInputRules = {
  url: (value: string) => value.length <= 2048 && value.startsWith('https://'),
  gtin: (value: string) => /^\d{8,14}$/.test(value)
};
