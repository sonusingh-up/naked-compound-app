import { describe, expect, it } from 'vitest';
import { createApiApp } from '../src';
import type { AskDependencies, Env } from '../src/ai/types';

const deps: AskDependencies = {
  retrieve: async () => [],
  generate: async () => 'should not be called',
  cacheSecret: 'test-only-secret'
};
const env = {
  DB: {} as Env['DB'],
  AI_CACHE_HMAC_KEY: 'test-only-secret',
  ASK_LIMITER: { limit: async () => ({ success: true }) }
} satisfies Partial<Env>;

describe('POST /v1/ask', () => {
  it('streams a validated no-match answer as SSE with a final product id event', async () => {
    const app = createApiApp(() => deps);
    const response = await app.request('/v1/ask', {
      method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '192.0.2.5' },
      body: JSON.stringify({ question: 'Recommend a whey supplement' })
    }, env);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-store');
    const body = await response.text();
    expect(body).toContain('event: token');
    expect(body).toContain("Naked Compound hasn't reviewed");
    expect(body).toContain('event: done\ndata: {"product_ids":[]}');
  });

  it('does not call retrieval for medical requests', async () => {
    let retrievals = 0;
    const app = createApiApp(() => ({ ...deps, retrieve: async () => { retrievals++; return []; } }));
    const response = await app.request('/v1/ask', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Which whey should I take during pregnancy?' })
    }, env);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('doctor or pharmacist');
    expect(retrievals).toBe(0);
  });

  it('validates the request shape and caps the request body', async () => {
    const app = createApiApp(() => deps);
    const invalid = await app.request('/v1/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'x', extra: true }) }, env);
    expect(invalid.status).toBe(400);
    const oversized = await app.request('/v1/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'x'.repeat(21_000) }) }, env);
    expect(oversized.status).toBe(413);
  });

  it('returns 429 when the Cloudflare limiter rejects the caller', async () => {
    const app = createApiApp(() => deps);
    const response = await app.request('/v1/ask', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Recommend whey' })
    }, { ...env, ASK_LIMITER: { limit: async () => ({ success: false }) } });
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
  });

  it('fails closed if the privacy-preserving limiter is not configured', async () => {
    const app = createApiApp(() => deps);
    const response = await app.request('/v1/ask', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Recommend whey' })
    }, { DB: env.DB, ASK_LIMITER: env.ASK_LIMITER });
    expect(response.status).toBe(503);
  });
});
