import { renderVerdict } from '../../src/verdict';

export default async function verdict(request: Request, context: { params: { id?: string } }): Promise<Response> {
  // Fetch the public staging API directly; preview team-login protection must not block SSR.
  return renderVerdict({ request, params: context.params, env: { API: {
    fetch: (upstream: Request) => fetch(new URL(new URL(upstream.url).pathname, 'https://nc-api-staging.naked-business-735.workers.dev'), { signal: AbortSignal.timeout(10000), redirect: 'error' })
  } } });
}

export const config = { path: '/v/:id', method: 'GET' };
