import type { Context, MiddlewareHandler } from 'hono';
import type { Env } from './ai/types';
import { makeHmacKey } from './ai/retrieval';

export type UserContext = { userId: string };
type AuthEnv = { Bindings: Env; Variables: { user: UserContext } };

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function decodeJsonPart(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('invalid-jwt');
  return parsed as Record<string, unknown>;
}

function pemToBytes(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '');
  return decodeBase64Url(body.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''));
}

/** Verify Clerk's RS256 session JWT using the configured Clerk PEM public key. */
export async function verifyClerkSession(token: string, env: Env, nowSeconds = Math.floor(Date.now() / 1000)): Promise<UserContext | null> {
  if (!env.CLERK_JWT_KEY || !env.CLERK_ISSUER || !env.CLERK_AUDIENCE) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = decodeJsonPart(parts[0]);
    const claims = decodeJsonPart(parts[1]);
    if (header.alg !== 'RS256' || header.typ && header.typ !== 'JWT') return null;
    const audience = claims.aud;
    const audiences = Array.isArray(audience) ? audience : [audience];
    if (claims.iss !== env.CLERK_ISSUER || !audiences.includes(env.CLERK_AUDIENCE)) return null;
    if (claims.nbf !== undefined && typeof claims.nbf !== 'number') return null;
    if (claims.azp !== undefined && typeof claims.azp !== 'string') return null;
    if (typeof claims.azp === 'string' && (!env.CLERK_AUTHORIZED_PARTIES || !env.CLERK_AUTHORIZED_PARTIES.split(',').map(value => value.trim()).includes(claims.azp))) return null;
    if (typeof claims.sub !== 'string' || !claims.sub || typeof claims.exp !== 'number' || claims.exp <= nowSeconds) return null;
    if (typeof claims.nbf === 'number' && claims.nbf > nowSeconds) return null;
    const key = await crypto.subtle.importKey('spki', pemToBytes(env.CLERK_JWT_KEY) as unknown as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decodeBase64Url(parts[2]) as unknown as BufferSource, new TextEncoder().encode(`${parts[0]}.${parts[1]}`) as unknown as BufferSource);
    return valid ? { userId: claims.sub } : null;
  } catch {
    return null;
  }
}

export function requireUser(verifier: AuthVerifier = verifyClerkSession): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const authorization = c.req.header('authorization') ?? '';
    const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization);
    if (!match) return c.json({ error: 'unauthorized' }, 401);
    const user = await verifier(match[1], c.env);
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    const limited = await checkVerifiedUserLimit(c.env, user.userId);
    if (limited === 'unavailable') return c.json({ error: 'account-unavailable' }, 503);
    if (!limited) return c.json({ error: 'rate-limited' }, 429, { 'retry-after': '60' });
    c.set('user', user);
    await next();
  };
}

export async function checkVerifiedUserLimit(env: Env, id: string): Promise<boolean | 'unavailable'> {
  if (!env.USER_LIMITER || !env.USER_RATE_LIMIT_HMAC_KEY) return 'unavailable';
  try {
    const key = await makeHmacKey(env.USER_RATE_LIMIT_HMAC_KEY, { route: 'verified-user', userId: id });
    return (await env.USER_LIMITER.limit({ key })).success;
  } catch { return 'unavailable'; }
}

export async function optionalUser(request: Request, env: Env, verifier: AuthVerifier): Promise<UserContext | null | 'invalid'> {
  const authorization = request.headers.get('authorization');
  if (!authorization) return null;
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization);
  if (!match) return 'invalid';
  return await verifier(match[1], env) ?? 'invalid';
}

export function userId(c: Context<AuthEnv>): string {
  return c.get('user').userId;
}

export type AuthVerifier = (token: string, env: Env) => Promise<UserContext | null>;
