type ApiService = { fetch(request: Request): Promise<Response> };
type PagesContext = { request: Request; env: { API: ApiService }; next(): Promise<Response> };

export async function onRequest({ request, env, next }: PagesContext): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path.startsWith('/v1/') || path.startsWith('/img/')) return env.API.fetch(request);
  return next();
}
