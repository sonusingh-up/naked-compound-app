import { describe, expect, it } from 'vitest';
import { onRequest as proxyRequest } from '../../nc-web/functions/[[path]]';
import { onRequestGet as sharedVerdict } from '../../nc-web/functions/v/[id]';

describe('Pages front and Worker service binding', () => {
  it.each(['full', 'scored'])('shows the %s review label and gates the article link', async depth => {
    const response = await sharedVerdict({
      request: new Request('https://nc-app.pages.dev/v/p1'), params: { id: 'p1' },
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
  it('forwards API and image requests unchanged through the API service binding', async () => {
    for (const path of ['/v1/products?q=whey', '/img/products/p1.png']) {
      const incoming = new Request(`https://nc-app.pages.dev${path}`, { headers: { authorization: 'Bearer session' } });
      let forwarded: Request | null = null;
      const response = await proxyRequest({
        request: incoming,
        env: { API: { fetch: async request => { forwarded = request; return Response.json({ path }); } } },
        next: async () => new Response('asset')
      });
      expect(forwarded).toBe(incoming);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ path });
    }
  });

  it('passes non-proxy paths to Pages static assets', async () => {
    const response = await proxyRequest({
      request: new Request('https://nc-app.pages.dev/'),
      env: { API: { fetch: async () => new Response('must not be called') } },
      next: async () => new Response('landing page')
    });
    expect(await response.text()).toBe('landing page');
  });

  it('renders a safe, honest not-yet-reviewed shared verdict from the API result', async () => {
    let apiPath = '';
    const response = await sharedVerdict({
      request: new Request('https://nc-app.pages.dev/v/p1'),
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
