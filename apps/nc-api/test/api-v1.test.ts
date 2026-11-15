import { describe, expect, it } from 'vitest';
import { createApiApp } from '../src';
import { verifySvixRequest } from '../src/accounts';
import { verifyClerkSession } from '../src/auth';
import type { D1Database, D1Statement, Env } from '../src/ai/types';

const product = {
  id: 'p1', brand: 'NC Brand', name: 'Whey Isolate', score: 8.2, grade: 'A', summary: 'Reviewed summary', form: 'powder',
  price_inr: 2400, quantity: '1 kg', price_checked_at: '2026-10-20', categories: '["Whey Protein"]', review_url: 'https://nakedcompound.in/review/p1',
  has_review: 1, personally_tested: 0, flags: null, cost_per_dose_inr: 62
};

class MockD1 implements D1Database {
  readonly calls: Array<{ sql: string; values: unknown[] }> = [];
  private createdRequestId: string | null = null;
  constructor(private readonly row: Record<string, unknown> | null = product) {}
  prepare(sql: string): D1Statement {
    const call = { sql, values: [] as unknown[] };
    this.calls.push(call);
    const statement = {
      bind: (...values: unknown[]) => { call.values = values; return statement; },
      first: async <T>() => {
        if (sql.includes('FROM listings l JOIN products')) return this.row as T | null;
        if (sql.includes('SELECT * FROM products WHERE')) return this.row as T | null;
        if (sql.includes('SELECT id FROM products')) return this.row ? { id: this.row.id } as T : null;
        if (sql.includes('SELECT id FROM review_requests')) return this.createdRequestId ? { id: this.createdRequestId } as T : null;
        if (sql.includes('INSERT INTO review_request_votes')) return { request_id: call.values[0] } as T;
        if (sql.includes('SELECT id, votes, status')) return { id: call.values[0], votes: 1, status: 'open' } as T;
        if (sql.includes('SELECT 1 AS saved')) return null;
        if (sql.includes('SELECT resend_contact_id')) return null;
        return null;
      },
      all: async <T>() => {
        if (sql.includes('SELECT p.* FROM products p WHERE')) return { results: [this.row].filter(Boolean) as T[] };
        if (sql.includes('products_fts MATCH')) return { results: [] as T[] };
        return { results: [] as T[] };
      },
      run: async () => {
        if (sql.includes('INSERT OR IGNORE INTO review_requests')) this.createdRequestId = String(call.values[0]);
        return { success: true };
      }
    };
    return statement as D1Statement;
  }
}

function protectedEnv(db = new MockD1()) {
  return {
    DB: db,
    USER_LIMITER: { limit: async () => ({ success: true }) },
    USER_RATE_LIMIT_HMAC_KEY: 'local-test-rate-key',
    REVIEW_VOTE_HMAC_KEY: 'local-test-vote-key',
    ASK_LIMITER: { limit: async () => ({ success: true }) },
    AI_CACHE_HMAC_KEY: 'local-test-cache-key'
  } satisfies Partial<Env>;
}

const testVerifier = async (token: string) => token === 'valid' ? { userId: 'user_123' } : null;

describe('v1 catalog and account routes', () => {
  it('only returns reviewed products from search and orders by score then effective dose', async () => {
    const db = new MockD1();
    const app = createApiApp(undefined, testVerifier);
    const response = await app.request('/v1/products?q=whey&category=Whey%20Protein&min_score=7&max_price=3000&flags=vegetarian', {}, { ...protectedEnv(db), DB: db });
    expect(response.status).toBe(200);
    const json = await response.json() as { products: Array<{ id: string; review_state: string; score: number }> };
    expect(json.products[0]).toMatchObject({ id: 'p1', review_state: 'reviewed', score: 8.2 });
    const sql = db.calls[0].sql;
    expect(sql).toContain('p.has_review = 1');
    expect(sql).toContain('p.score IS NOT NULL');
    expect(sql).toContain('ORDER BY p.score DESC, p.cost_per_dose_inr');
    expect(db.calls[0].values).toContain('"whey"');
  });

  it('does not expose score, price, flags, or editorial claims for an unreviewed detail', async () => {
    const unreviewed = { ...product, score: 9.9, grade: 'A+', summary: 'unapproved claim', price_inr: 1, has_review: 0, flags: '{"fssai_verified":true}' };
    const app = createApiApp(undefined, testVerifier);
    const response = await app.request('/v1/products/unreviewed', {}, { ...protectedEnv(new MockD1(unreviewed)), DB: new MockD1(unreviewed) });
    const json = await response.json() as { product: Record<string, unknown> };
    expect(json.product).toEqual({ id: 'p1', brand: 'NC Brand', name: 'Whey Isolate', review_state: 'unreviewed' });
  });

  it('derives save ownership from the verified session and ignores caller user-id headers', async () => {
    const db = new MockD1();
    const app = createApiApp(undefined, testVerifier);
    const response = await app.request('/v1/me/saved/p1', {
      method: 'PUT', headers: { authorization: 'Bearer valid', 'x-user-id': 'attacker' }
    }, { ...protectedEnv(db), DB: db });
    expect(response.status).toBe(200);
    const insert = db.calls.find(call => call.sql.includes('INSERT OR IGNORE INTO saved_products'));
    expect(insert?.values).toEqual(['user_123', 'p1', expect.any(String)]);
  });

  it('requires a verified user for saved products and fails closed when auth is absent', async () => {
    const app = createApiApp(undefined, testVerifier);
    const response = await app.request('/v1/me/saved/p1', {}, protectedEnv());
    expect(response.status).toBe(401);
  });

  it('rejects unsafe shared URLs without querying the catalog', async () => {
    const db = new MockD1();
    const app = createApiApp(undefined, testVerifier);
    const response = await app.request('/v1/resolve', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://127.0.0.1/private' })
    }, { ...protectedEnv(db), DB: db });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'unknown' });
    expect(db.calls).toHaveLength(0);
  });

  it('streams public image objects from R2 and returns cache validators', async () => {
    const db = new MockD1();
    const app = createApiApp(undefined, testVerifier);
    const env = {
      ...protectedEnv(db), DB: db,
      IMAGES: { get: async (key: string) => key === 'products/p1.png' ? {
        body: new Response('image-bytes').body!, size: 11, httpEtag: '"p1-v1"', uploaded: new Date('2026-11-15T00:00:00Z'), httpMetadata: { contentType: 'image/png' }
      } : null }
    };
    const response = await app.request('/img/products/p1.png', {}, env);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toContain('s-maxage=604800');
    expect(await response.text()).toBe('image-bytes');
    const cached = await app.request('/img/products/p1.png', { headers: { 'if-none-match': '"p1-v1"' } }, env);
    expect(cached.status).toBe(304);
  });

  it('persists only parsed link identifiers, never the submitted URL or its query', async () => {
    const db = new MockD1(null);
    const app = createApiApp(undefined, testVerifier);
    const rawUrl = 'https://www.amazon.in/dp/B012345678?campaign=private-token';
    const response = await app.request('/v1/resolve', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: rawUrl })
    }, { ...protectedEnv(db), DB: db });
    expect(response.status).toBe(200);
    const savedRequest = db.calls.find(call => call.sql.includes('INSERT OR IGNORE INTO review_requests'));
    expect(savedRequest?.values).toContain('B012345678');
    expect(db.calls.flatMap(call => call.values).join('|')).not.toContain(rawUrl);
    expect(db.calls.flatMap(call => call.values).join('|')).not.toContain('private-token');
  });
});

function base64Url(bytes: Uint8Array): string {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function signedJwt(claims: Record<string, unknown>, privateKey: CryptoKey): Promise<string> {
  const head = base64Url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const body = base64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const data = new TextEncoder().encode(`${head}.${body}`);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, data);
  return `${head}.${body}.${base64Url(new Uint8Array(signature))}`;
}

describe('session and webhook verification', () => {
  it('verifies Clerk signature, issuer, audience, expiry and authorized party', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
    const publicKey = `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...spki))}\n-----END PUBLIC KEY-----`;
    const env = { CLERK_JWT_KEY: publicKey, CLERK_ISSUER: 'https://clerk.example', CLERK_AUDIENCE: 'nc-app', CLERK_AUTHORIZED_PARTIES: 'https://app.example' } as Env;
    const now = Math.floor(Date.now() / 1000);
    const valid = await signedJwt({ iss: env.CLERK_ISSUER, aud: env.CLERK_AUDIENCE, sub: 'user_123', azp: 'https://app.example', exp: now + 120, nbf: now - 1 }, pair.privateKey);
    expect(await verifyClerkSession(valid, env)).toEqual({ userId: 'user_123' });
    const wrongOrigin = await signedJwt({ iss: env.CLERK_ISSUER, aud: env.CLERK_AUDIENCE, sub: 'user_123', azp: 'https://evil.example', exp: now + 120 }, pair.privateKey);
    expect(await verifyClerkSession(wrongOrigin, env)).toBeNull();
    const expired = await signedJwt({ iss: env.CLERK_ISSUER, aud: env.CLERK_AUDIENCE, sub: 'user_123', exp: now - 1 }, pair.privateKey);
    expect(await verifyClerkSession(expired, env)).toBeNull();
  });

  it('checks Svix HMAC and rejects stale timestamps', async () => {
    const secretBytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = `whsec_${btoa(String.fromCharCode(...secretBytes))}`;
    const body = JSON.stringify({ type: 'user.created', data: { id: 'user_123' } });
    const id = 'msg_abc';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
    const signature = btoa(String.fromCharCode(...new Uint8Array(digest)));
    const headers = { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` };
    expect(await verifySvixRequest(new Request('https://worker.test', { method: 'POST', headers, body }), secret)).toBe(body);
    const db = new MockD1(null);
    const app = createApiApp(undefined, testVerifier);
    const webhook = await app.request('/v1/webhooks/clerk', { method: 'POST', headers, body }, { ...protectedEnv(db), DB: db, CLERK_WEBHOOK_SECRET: secret });
    expect(webhook.status).toBe(200);
    expect(db.calls.some(call => call.sql.includes('INSERT OR IGNORE INTO users') && call.values[0] === 'user_123')).toBe(true);
    const staleHeaders = { ...headers, 'svix-timestamp': String(Number(timestamp) - 600) };
    expect(await verifySvixRequest(new Request('https://worker.test', { method: 'POST', headers: staleHeaders, body }), secret)).toBeNull();
  });
});
