import { Hono } from 'hono';
import { z } from 'zod';
import { answerQuestion } from './ai/ask';
import { createCache, makeHmacKey, retrieveProducts } from './ai/retrieval';
import { createGenerator } from './ai/provider';
import type { AskDependencies, Env } from './ai/types';
import { requireUser, optionalUser, verifyClerkSession, checkVerifiedUserLimit, userId as authenticatedUserId, type AuthVerifier } from './auth';
import { searchProducts, getProduct } from './catalog';
import { resolveInputRules, resolveLink } from './resolve';
import { deleteAccount, handleClerkWebhook, makeVoteKey, setEmailPreference } from './accounts';

const historyItem = z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(1200) }).strict();
const askBody = z.object({ question: z.string().trim().min(1).max(1200), history: z.array(historyItem).max(6).default([]) }).strict();
const MAX_BODY_BYTES = 20_000;
type HonoEnv = { Bindings: Env; Variables: { user: { userId: string } } };
export type AskDependenciesFactory = (env: Env) => AskDependencies;

const resolveBodySchema = z.object({ url: z.string().trim().min(1).max(2048).optional(), gtin: z.string().trim().regex(/^\d{8,14}$/).optional() })
  .strict().refine(value => Number(Boolean(value.url)) + Number(Boolean(value.gtin)) === 1);
const preferenceSchema = z.object({ email_opt_in: z.boolean() }).strict();

export function createApiApp(factory: AskDependenciesFactory = env => ({
  retrieve: (question, filters) => retrieveProducts({ db: env.DB, ai: env.AI, vectorize: env.REVIEWS, question, filters }),
  generate: createGenerator(env),
  cache: createCache(env.DB),
  cacheSecret: env.AI_CACHE_HMAC_KEY
}), authVerifier: AuthVerifier = verifyClerkSession) {
  const app = new Hono<HonoEnv>();

  app.post('/v1/ask', async c => {
    if (!c.env.ASK_LIMITER || !c.env.AI_CACHE_HMAC_KEY) return c.json({ error: 'ask-unavailable' }, 503);
    const ip = c.req.header('CF-Connecting-IP') ?? 'local';
    let rateKey: string;
    try { rateKey = await makeHmacKey(c.env.AI_CACHE_HMAC_KEY, { route: 'ask', ip }); }
    catch { return c.json({ error: 'ask-unavailable' }, 503); }
    try {
      const allowed = await c.env.ASK_LIMITER.limit({ key: rateKey });
      if (!allowed.success) return c.json({ error: 'rate-limited' }, 429, { 'retry-after': '60' });
    } catch {
      return c.json({ error: 'ask-unavailable' }, 503);
    }

    const bodyText = await readBodyLimited(c.req.raw, MAX_BODY_BYTES);
    if (bodyText === null) return c.json({ error: 'request-too-large' }, 413);
    let body: unknown;
    try { body = JSON.parse(bodyText); } catch { return c.json({ error: 'invalid-json' }, 400); }
    const parsed = askBody.safeParse(body);
    if (!parsed.success) return c.json({ error: 'invalid-request' }, 400);

    try {
      const result = await answerQuestion(parsed.data, factory(c.env));
      return sseResponse(result.answer, result.productIds);
    } catch {
      return c.json({ error: 'ask-unavailable' }, 503);
    }
  });

  app.get('/v1/products', async c => {
    try {
      const result = await searchProducts(c.env.DB, new URL(c.req.url).searchParams);
      return 'error' in result ? c.json({ error: result.error }, 400) : c.json(result);
    } catch { return c.json({ error: 'catalog-unavailable' }, 503); }
  });

  app.get('/v1/products/:id', async c => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(c.req.param('id'))) return c.json({ error: 'not-found' }, 404);
    try {
      const result = await getProduct(c.env.DB, c.req.param('id'));
      return result ? c.json(result) : c.json({ error: 'not-found' }, 404);
    } catch { return c.json({ error: 'catalog-unavailable' }, 503); }
  });

  app.on(['GET', 'HEAD'], '/img/*', async c => {
    if (!c.env.IMAGES) return c.json({ error: 'images-unavailable' }, 503);
    let key: string;
    try { key = decodeURIComponent(new URL(c.req.url).pathname.slice('/img/'.length)); }
    catch { return c.json({ error: 'not-found' }, 404); }
    if (!key || key.includes('\\') || key.includes('\0') || key.split('/').some(part => part === '.' || part === '..')) return c.json({ error: 'not-found' }, 404);
    try {
      const object = await c.env.IMAGES.get(key);
      if (!object) return c.body(null, 404);
      const contentType = object.httpMetadata?.contentType?.split(';', 1)[0].trim().toLowerCase();
      if (!contentType || !['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp'].includes(contentType)) return c.body(null, 415);
      const headers = new Headers({
        'content-type': contentType,
        'content-length': String(object.size),
        'cache-control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
        'etag': object.httpEtag,
        'last-modified': object.uploaded.toUTCString(),
        'x-content-type-options': 'nosniff'
      });
      const ifNoneMatch = c.req.header('if-none-match')?.split(',').map(value => value.trim()) ?? [];
      if (ifNoneMatch.includes('*') || ifNoneMatch.includes(object.httpEtag)) return new Response(null, { status: 304, headers });
      return new Response(c.req.method === 'HEAD' ? null : object.body, { headers });
    } catch { return c.json({ error: 'images-unavailable' }, 503); }
  });

  app.post('/v1/resolve', async c => {
    const ipLimited = await checkIpLimit(c.env, 'resolve', c.req.header('CF-Connecting-IP') ?? 'local');
    if (ipLimited === 'unavailable') return c.json({ error: 'resolve-unavailable' }, 503);
    if (!ipLimited) return c.json({ error: 'rate-limited' }, 429, { 'retry-after': '60' });
    const bodyText = await readBodyLimited(c.req.raw, 4096);
    if (bodyText === null) return c.json({ error: 'request-too-large' }, 413);
    let body: unknown;
    try { body = JSON.parse(bodyText); } catch { return c.json({ error: 'invalid-json' }, 400); }
    const parsed = resolveBodySchema.safeParse(body);
    if (!parsed.success || (parsed.data.url && !resolveInputRules.url(parsed.data.url))) return c.json({ error: 'invalid-request' }, 400);
    const user = await optionalUser(c.req.raw, c.env, authVerifier);
    if (user === 'invalid') return c.json({ error: 'unauthorized' }, 401);
    if (user) {
      const limited = await checkVerifiedUserLimit(c.env, user.userId);
      if (limited === 'unavailable') return c.json({ error: 'resolve-unavailable' }, 503);
      if (!limited) return c.json({ error: 'rate-limited' }, 429, { 'retry-after': '60' });
    }
    const identity = user ? `user:${user.userId}` : `ip:${c.req.header('CF-Connecting-IP') ?? 'unavailable'}`;
    const secret = c.env.REVIEW_VOTE_HMAC_KEY;
    try {
      const voterKey = secret ? await makeVoteKey(secret, identity) : null;
      return c.json(await resolveLink(c.env.DB, parsed.data, user?.userId ?? null, voterKey, c.env.BRAND_HOSTS));
    } catch { return c.json({ error: 'resolve-unavailable' }, 503); }
  });

  app.post('/v1/review-requests', async c => {
    const ipLimited = await checkIpLimit(c.env, 'review-requests', c.req.header('CF-Connecting-IP') ?? 'local');
    if (ipLimited === 'unavailable') return c.json({ error: 'review-request-unavailable' }, 503);
    if (!ipLimited) return c.json({ error: 'rate-limited' }, 429, { 'retry-after': '60' });
    const bodyText = await readBodyLimited(c.req.raw, 4096);
    if (bodyText === null) return c.json({ error: 'request-too-large' }, 413);
    let body: unknown;
    try { body = JSON.parse(bodyText); } catch { return c.json({ error: 'invalid-json' }, 400); }
    const parsed = resolveBodySchema.safeParse(body);
    if (!parsed.success || (parsed.data.url && !resolveInputRules.url(parsed.data.url))) return c.json({ error: 'invalid-request' }, 400);
    const user = await optionalUser(c.req.raw, c.env, authVerifier);
    if (user === 'invalid') return c.json({ error: 'unauthorized' }, 401);
    if (user) {
      const limited = await checkVerifiedUserLimit(c.env, user.userId);
      if (limited === 'unavailable') return c.json({ error: 'review-request-unavailable' }, 503);
      if (!limited) return c.json({ error: 'rate-limited' }, 429, { 'retry-after': '60' });
    }
    const secret = c.env.REVIEW_VOTE_HMAC_KEY;
    if (!secret) return c.json({ error: 'review-request-unavailable' }, 503);
    try {
      const voterKey = await makeVoteKey(secret, user ? `user:${user.userId}` : `ip:${c.req.header('CF-Connecting-IP') ?? 'unavailable'}`);
      const result = await resolveLink(c.env.DB, parsed.data, user?.userId ?? null, voterKey, c.env.BRAND_HOSTS);
      if (result.status !== 'unknown' || !result.requestId) return c.json({ error: 'review-request-not-needed', status: result.status }, 409);
      const request = await c.env.DB.prepare('SELECT id, votes, status FROM review_requests WHERE id = ?').bind(result.requestId).first<{ id: string; votes: number; status: string }>();
      return c.json({ request }, 201);
    } catch { return c.json({ error: 'review-request-unavailable' }, 503); }
  });

  app.get('/v1/me/saved/:productId', requireUser(authVerifier), async c => {
    const id = c.req.param('productId');
    let product: Awaited<ReturnType<typeof getProduct>>;
    try { product = await getProduct(c.env.DB, id); }
    catch { return c.json({ error: 'account-unavailable' }, 503); }
    if (!product) return c.json({ error: 'not-found' }, 404);
    const saved = await c.env.DB.prepare('SELECT 1 AS saved FROM saved_products WHERE user_id = ? AND product_id = ?').bind(authenticatedUserId(c), id).first<{ saved: number }>();
    return c.json({ saved: Boolean(saved), product: product.product });
  });

  app.put('/v1/me/saved/:productId', requireUser(authVerifier), async c => {
    const id = c.req.param('productId');
    const exists = await c.env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(id).first<{ id: string }>();
    if (!exists) return c.json({ error: 'not-found' }, 404);
    await c.env.DB.prepare('INSERT OR IGNORE INTO saved_products (user_id, product_id, created_at) VALUES (?, ?, ?)').bind(authenticatedUserId(c), id, new Date().toISOString()).run();
    return c.json({ saved: true });
  });

  app.delete('/v1/me/saved/:productId', requireUser(authVerifier), async c => {
    await c.env.DB.prepare('DELETE FROM saved_products WHERE user_id = ? AND product_id = ?').bind(authenticatedUserId(c), c.req.param('productId')).run();
    return c.body(null, 204);
  });

  app.put('/v1/me/preferences', requireUser(authVerifier), async c => {
    const bodyText = await readBodyLimited(c.req.raw, 1024);
    if (bodyText === null) return c.json({ error: 'request-too-large' }, 413);
    let body: unknown;
    try { body = JSON.parse(bodyText); } catch { return c.json({ error: 'invalid-json' }, 400); }
    const parsed = preferenceSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'invalid-request' }, 400);
    const result = await setEmailPreference(c.env.DB, c.env, authenticatedUserId(c), parsed.data.email_opt_in);
    if (result === 'email-unavailable') return c.json({ error: result }, 422);
    return result === 'ok' ? c.json({ email_opt_in: parsed.data.email_opt_in }) : c.json({ error: 'preferences-unavailable' }, 503);
  });

  app.delete('/v1/me', requireUser(authVerifier), async c => {
    const ok = await deleteAccount(c.env.DB, c.env, authenticatedUserId(c));
    return ok ? c.body(null, 204) : c.json({ error: 'deletion-unavailable' }, 503);
  });

  app.post('/v1/webhooks/clerk', async c => {
    const body = await readBodyLimited(c.req.raw, 32_000);
    if (body === null) return c.json({ error: 'request-too-large' }, 413);
    const headers = new Headers(c.req.raw.headers);
    headers.delete('content-length');
    const boundedRequest = new Request(c.req.url, { method: 'POST', headers, body });
    const result = await handleClerkWebhook(c.env.DB, c.env, boundedRequest);
    if (result === 'unauthorized') return c.json({ error: 'unauthorized' }, 401);
    if (result === 'invalid') return c.json({ error: 'invalid-webhook' }, 400);
    return c.json({ received: true });
  });

  app.onError(() => new Response(JSON.stringify({ error: 'internal-error' }), { status: 500, headers: { 'content-type': 'application/json' } }));
  return app;
}

export async function readBodyLimited(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

async function checkIpLimit(env: Env, route: string, ip: string): Promise<boolean | 'unavailable'> {
  if (!env.ASK_LIMITER || !env.AI_CACHE_HMAC_KEY) return 'unavailable';
  try {
    const key = await makeHmacKey(env.AI_CACHE_HMAC_KEY, { route, ip });
    return (await env.ASK_LIMITER.limit({ key })).success;
  } catch { return 'unavailable'; }
}

function sseResponse(answer: string, productIds: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const chars = [...answer];
      for (let index = 0; index < chars.length; index += 72) {
        controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ delta: chars.slice(index, index + 72).join('') })}\n\n`));
      }
      controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ product_ids: productIds })}\n\n`));
      controller.close();
    }
  });
  return new Response(body, { headers: {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store, no-transform',
    'x-content-type-options': 'nosniff',
    'x-accel-buffering': 'no'
  } });
}

export default createApiApp();
