import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import verdict, { config } from '../../nc-web/netlify/functions/verdict.mjs';
import { vi } from 'vitest';
import { renderVerdict as sharedVerdict } from '../../nc-web/src/verdict';

describe('Netlify front and Worker proxy', () => {
  it.each(['full', 'scored'])('shows the %s review label and gates the article link', async depth => {
    const response = await sharedVerdict({
      request: new Request('https://nc-app.netlify.app/v/p1'), params: { id: 'p1' },
      env: { API: { fetch: async () => Response.json({ product: {
        id: 'p1', name: 'Fixture', brand: 'Fixture brand', score: 8,
        review_state: 'reviewed', review_depth: depth,
        review_url: 'https://www.nakedcompound.in/reviews/fixture'
      } }) } }
    });
    const html = await response.text();
    expect(html).toContain(depth === 'full' ? 'Full review' : 'NC score');
    expect(html.includes('Read the full review')).toBe(depth === 'full');
  });
  it('publishes both staging proxy routes', () => {
    const routes = readFileSync(new URL('../../nc-web/public/_redirects', import.meta.url), 'utf8');
    expect(routes).toContain('/v1/*  https://nc-api-staging.naked-business-735.workers.dev/v1/:splat  200');
    expect(routes).toContain('/img/*  https://nc-api-staging.naked-business-735.workers.dev/img/:splat  200');
  });
  it('loads verdicts from staging without preview authentication recursion', async () => {
    const mock = vi.fn(async () => Response.json({ product: { name: 'Fixture', review_state: 'unreviewed' } }));
    vi.stubGlobal('fetch', mock);
    try {
      expect(config.path).toBe('/v/:id');
      const response = await verdict(new Request('https://nc-app.netlify.app/v/p1'), { params: { id: 'p1' } });
      expect(response.status).toBe(200);
      expect(String((mock.mock.calls[0] as unknown as [URL])[0])).toBe('https://nc-api-staging.naked-business-735.workers.dev/v1/products/p1');
    } finally { vi.unstubAllGlobals(); }
  });
  it.each([404, 500])('handles upstream %s without leaking error details', async status => {
    const response = await sharedVerdict({ request: new Request('https://nc-app.netlify.app/v/p1'), params: { id: 'p1' }, env: { API: { fetch: async () => new Response('private upstream error', { status }) } } });
    expect(response.status).toBe(status === 404 ? 404 : 503);
    expect(await response.text()).not.toContain('private upstream error');
  });

  it('renders a safe, honest not-yet-reviewed shared verdict from the API result', async () => {
    let apiPath = '';
    const response = await sharedVerdict({
      request: new Request('https://nc-app.netlify.app/v/p1'),
      params: { id: 'p1' },
      env: { API: { fetch: async request => {
        apiPath = new URL(request.url).pathname;
        return Response.json({ product: { id: 'p1', name: '<img src=x onerror=alert(1)>', brand: 'Test brand', review_state: 'unreviewed', score: 9.8 } });
      } } }
    });
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(apiPath).toBe('/v1/products/p1');
    expect(html).toContain('Not yet reviewed');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('9.8/10');
  });
});
