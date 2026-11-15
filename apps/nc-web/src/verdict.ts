type ApiService = { fetch(request: Request): Promise<Response> };
type VerdictContext = { request: Request; env: { API: ApiService }; params: { id?: string } };

const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]!));

function htmlShell(title: string, content: string, description: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f7f3ec"><meta name="description" content="${escapeHtml(description)}">
<meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}">
<title>${escapeHtml(title)}</title><link rel="icon" type="image/png" href="/brand-mark.png"><link rel="stylesheet" href="/styles.css">
</head><body><header class="site-header"><a class="brand" href="/" aria-label="Naked Compound home"><img src="/brand-mark.png" width="40" height="40" alt=""><span>Naked Compound</span></a><nav aria-label="Main navigation"><a href="https://www.nakedcompound.in/">Reviews</a><a href="https://www.nakedcompound.in/methodology.html">How we review</a></nav></header>
<main class="verdict-main"><a class="back-link" href="/">← Naked Compound</a><article class="verdict-card">${content}</article><p class="disclosure">Product links may be affiliate links. Any commission does not affect a review score or ranking.</p></main>
<footer><span>Independent reviews. Clear evidence.</span><a href="https://www.nakedcompound.in/privacy.html">Privacy</a></footer></body></html>`;
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; img-src 'self'; style-src 'self'; connect-src 'self'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin'
  } });
}

function shell(title: string, content: string, description = 'Evidence-first supplement reviews from Naked Compound.', status = 200): Response {
  return htmlResponse(htmlShell(title, content, description), status);
}

function priceText(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value)
    : null;
}

export async function renderVerdict({ request, env, params }: VerdictContext): Promise<Response> {
  const id = params.id ?? '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return shell('Review not found — Naked Compound', '<span class="status">Share link</span><h1 class="verdict-title">Review not found</h1><p class="verdict-summary">This link does not contain a valid product ID.</p>', undefined, 404);
  try {
    const apiUrl = new URL(`/v1/products/${encodeURIComponent(id)}`, request.url);
    const apiResponse = await env.API.fetch(new Request(apiUrl, { headers: { accept: 'application/json' } }));
    if (apiResponse.status === 404) return shell('Review not found — Naked Compound', '<span class="status">Share link</span><h1 class="verdict-title">Review not found</h1><p class="verdict-summary">This product ID does not match a product in the Naked Compound catalog.</p>', undefined, 404);
    if (!apiResponse.ok) throw new Error('api-unavailable');
    const payload: unknown = await apiResponse.json();
    if (!payload || typeof payload !== 'object') throw new Error('invalid-response');
    const data = payload as { product?: Record<string, unknown>; alternatives?: unknown; listings?: unknown };
    const product = data.product;
    if (!product || typeof product.name !== 'string') throw new Error('invalid-product');
    const reviewed = product.review_state === 'reviewed';
    const title = `${product.name} review — Naked Compound`;
    const status = reviewed ? (product.review_depth === 'full' ? 'Full review' : 'NC score') : 'Not yet reviewed';
    const pieces = [`<span class="status">${status}</span>`, `<h1 class="verdict-title">${escapeHtml(product.name)}</h1>`, `<p class="verdict-subtitle">${escapeHtml(product.brand)}</p>`];
    if (reviewed) {
      pieces.push(`<div class="score-row"><span class="score">${escapeHtml(product.score)}/10</span>${product.grade ? `<span class="grade">Grade ${escapeHtml(product.grade)}</span>` : ''}</div>`);
      if (typeof product.summary === 'string') pieces.push(`<p class="verdict-summary">${escapeHtml(product.summary)}</p>`);
      const price = priceText(product.price_inr);
      if (price || product.price_checked_at) {
        pieces.push('<div class="meta">');
        if (price) pieces.push(`<span>Recorded price ${escapeHtml(price)}</span>`);
        if (typeof product.price_checked_at === 'string') pieces.push(`<span>Price checked ${escapeHtml(product.price_checked_at)}</span>`);
        pieces.push('</div>');
      }
    } else {
      pieces.push('<p class="verdict-summary">Naked Compound has not reviewed this product yet. No score or verdict is available.</p>');
    }
    if (reviewed && product.review_depth === 'full' && typeof product.review_url === 'string' && product.review_url.startsWith('https://www.nakedcompound.in/')) {
      pieces.push(`<a class="button" href="${escapeHtml(product.review_url)}">Read the full review</a>`);
    }
    if (reviewed && Array.isArray(data.listings)) {
      const links = data.listings.filter((item): item is { href: string } => !!item && typeof item === 'object' && typeof (item as { href?: unknown }).href === 'string' && (item as { href: string }).href.startsWith('https://'));
      if (links.length) pieces.push(`<div class="alternatives"><h2>Price links</h2>${links.map(link => `<a class="button" rel="noopener noreferrer sponsored" href="${escapeHtml(link.href)}">Check price</a>`).join(' ')}</div>`);
    }
    const description = reviewed && typeof product.summary === 'string'
      ? product.summary.slice(0, 180)
      : 'Not yet reviewed by Naked Compound. No score or verdict is available.';
    const alternatives = Array.isArray(data.alternatives) ? data.alternatives.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string' && typeof (item as { name?: unknown }).name === 'string') : [];
    if (alternatives.length) {
      const altMarkup = `<section class="alternatives"><h2>Reviewed alternatives</h2>${alternatives.map(item => `<a class="alternative-link" href="/v/${encodeURIComponent(String(item.id))}"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.brand)} · ${item.review_depth === 'full' ? 'Full review' : 'NC score'}${typeof item.score === 'number' ? ` · ${escapeHtml(item.score)}/10` : ''}</span></a>`).join('')}</section>`;
      pieces.push(altMarkup);
    }
    return htmlResponse(htmlShell(title, pieces.join(''), description));
  } catch {
    return shell('Review unavailable — Naked Compound', '<span class="status">Temporarily unavailable</span><h1 class="verdict-title">Review unavailable</h1><p class="verdict-summary">We could not load this product review. Please try again in a moment.</p>', undefined, 503);
  }
}
