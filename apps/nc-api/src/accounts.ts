import type { D1Database, Env } from './ai/types';

const encoder = new TextEncoder();

function fromBase64(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const raw = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

function toBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw);
}

export async function makeVoteKey(secret: string, identity: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret) as unknown as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toBase64(await crypto.subtle.sign('HMAC', key, encoder.encode(identity) as unknown as BufferSource));
}

export async function castReviewVote(db: D1Database, requestId: string, voterKey: string, userId: string | null) {
  await db.prepare('INSERT INTO review_request_votes (request_id, voter_key, user_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(request_id, voter_key) DO NOTHING')
    .bind(requestId, voterKey, userId, new Date().toISOString()).run();
  await db.prepare('UPDATE review_requests SET votes = (SELECT COUNT(*) FROM review_request_votes WHERE request_id = ?) WHERE id = ?').bind(requestId, requestId).run();
  return db.prepare('SELECT id, votes, status FROM review_requests WHERE id = ?').bind(requestId).first<{ id: string; votes: number; status: string }>();
}

async function apiCall(url: string, method: string, key: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method,
    headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}

function apiSucceeded(response: Response): boolean { return response.ok || response.status === 404; }

async function clerkEmail(env: Env, userId: string): Promise<string | null> {
  if (!env.CLERK_SECRET_KEY) return null;
  const response = await apiCall(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, 'GET', env.CLERK_SECRET_KEY);
  if (!response.ok) return null;
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object') return null;
  const user = data as { primary_email_address_id?: unknown; email_addresses?: unknown };
  if (!Array.isArray(user.email_addresses)) return null;
  const primary = user.email_addresses.find((item: unknown) => item && typeof item === 'object' && (item as { id?: unknown }).id === user.primary_email_address_id) as { email_address?: unknown; verification?: { status?: unknown } } | undefined;
  if (primary?.verification?.status !== 'verified' || typeof primary.email_address !== 'string') return null;
  return primary.email_address;
}

async function deleteResendContact(env: Env, contactId: string | null): Promise<boolean> {
  if (!contactId) return true;
  if (!env.RESEND_API_KEY) return false;
  try { return apiSucceeded(await apiCall(`https://api.resend.com/contacts/${encodeURIComponent(contactId)}`, 'DELETE', env.RESEND_API_KEY)); }
  catch { return false; }
}

async function responseContactId(response: Response, fallback: string | null): Promise<string | null> {
  try {
    const data: unknown = await response.json();
    if (data && typeof data === 'object' && typeof (data as { id?: unknown }).id === 'string') return (data as { id: string }).id;
  } catch { /* some successful update responses have no body */ }
  return fallback;
}

export async function setEmailPreference(db: D1Database, env: Env, userId: string, optIn: boolean): Promise<'ok' | 'unavailable' | 'email-unavailable'> {
  const existing = await db.prepare('SELECT resend_contact_id FROM users WHERE id = ?').bind(userId).first<{ resend_contact_id: string | null }>();
  if (!existing) await db.prepare('INSERT OR IGNORE INTO users (id, email_opt_in, created_at) VALUES (?, 0, ?)').bind(userId, new Date().toISOString()).run();
  if (!optIn) {
    await db.prepare('UPDATE users SET email_opt_in = 0 WHERE id = ?').bind(userId).run();
    const removed = await deleteResendContact(env, existing?.resend_contact_id ?? null);
    if (!removed) return 'unavailable';
    await db.prepare('UPDATE users SET resend_contact_id = NULL WHERE id = ?').bind(userId).run();
    return 'ok';
  }
  if (!env.RESEND_API_KEY || !env.CLERK_SECRET_KEY) return 'unavailable';
  const email = await clerkEmail(env, userId);
  if (!email) return 'email-unavailable';
  let contactId = existing?.resend_contact_id ?? null;
  try {
    const target = contactId ? encodeURIComponent(contactId) : encodeURIComponent(email);
    let response = await apiCall(`https://api.resend.com/contacts/${target}`, 'PATCH', env.RESEND_API_KEY, { email, unsubscribed: false });
    if (response.status === 404) {
      response = await apiCall('https://api.resend.com/contacts', 'POST', env.RESEND_API_KEY, { email, unsubscribed: false });
      if (response.status === 409) {
        response = await apiCall(`https://api.resend.com/contacts/${encodeURIComponent(email)}`, 'PATCH', env.RESEND_API_KEY, { email, unsubscribed: false });
      }
    }
    if (!response.ok) return 'unavailable';
    contactId = await responseContactId(response, contactId);
    if (!contactId) return 'unavailable';
  } catch { return 'unavailable'; }
  await db.prepare('UPDATE users SET email_opt_in = 1, resend_contact_id = ? WHERE id = ?').bind(contactId, userId).run();
  return 'ok';
}

export async function deleteAccount(db: D1Database, env: Env, userId: string): Promise<boolean> {
  const user = await db.prepare('SELECT resend_contact_id FROM users WHERE id = ?').bind(userId).first<{ resend_contact_id: string | null }>();
  if (!await deleteResendContact(env, user?.resend_contact_id ?? null)) return false;
  if (!env.CLERK_SECRET_KEY) return false;
  try {
    const response = await apiCall(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, 'DELETE', env.CLERK_SECRET_KEY);
    if (!apiSucceeded(response)) return false;
  } catch { return false; }
  await db.prepare('DELETE FROM review_request_votes WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM review_request_votes WHERE request_id IN (SELECT id FROM review_requests WHERE user_id = ?)').bind(userId).run();
  await db.prepare('DELETE FROM review_requests WHERE user_id = ?').bind(userId).run();
  await db.prepare('UPDATE review_requests SET votes = (SELECT COUNT(*) FROM review_request_votes WHERE request_id = review_requests.id)').run();
  await db.prepare('DELETE FROM saved_products WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
  return true;
}

export async function verifySvixRequest(request: Request, secret: string | undefined, nowMs = Date.now()): Promise<string | null> {
  if (!secret) return null;
  const id = request.headers.get('svix-id');
  const timestamp = request.headers.get('svix-timestamp');
  const signatures = request.headers.get('svix-signature');
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) return null;
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(Math.floor(nowMs / 1000) - timestampSeconds) > 300) return null;
  const body = await request.text();
  let encoded: string;
  try { encoded = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret; }
  catch { return null; }
  let keyBytes: Uint8Array;
  try { keyBytes = fromBase64(encoded); } catch { return null; }
  try {
    const key = await crypto.subtle.importKey('raw', keyBytes as unknown as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    let valid = false;
    for (const entry of signatures.split(' ')) {
      const [version, value] = entry.split(',');
      if (version !== 'v1' || !value) continue;
      try { if (await crypto.subtle.verify('HMAC', key, fromBase64(value) as unknown as BufferSource, encoder.encode(`${id}.${timestamp}.${body}`) as unknown as BufferSource)) { valid = true; break; } }
      catch { /* invalid signature encoding */ }
    }
    return valid ? body : null;
  } catch { return null; }
}

export async function handleClerkWebhook(db: D1Database, env: Env, request: Request): Promise<'ok' | 'unauthorized' | 'invalid'> {
  const body = await verifySvixRequest(request, env.CLERK_WEBHOOK_SECRET);
  if (body === null) return 'unauthorized';
  let event: unknown;
  try { event = JSON.parse(body); } catch { return 'invalid'; }
  if (!event || typeof event !== 'object') return 'invalid';
  const payload = event as { type?: unknown; data?: unknown };
  if (!['user.created', 'user.deleted'].includes(String(payload.type)) || !payload.data || typeof payload.data !== 'object') return 'invalid';
  const data = payload.data as { id?: unknown };
  if (typeof data.id !== 'string' || !/^user_[A-Za-z0-9_-]{1,128}$/.test(data.id)) return 'invalid';
  if (payload.type === 'user.created') {
    await db.prepare('INSERT OR IGNORE INTO users (id, email_opt_in, created_at) VALUES (?, 0, ?)').bind(data.id, new Date().toISOString()).run();
    return 'ok';
  }
  const user = await db.prepare('SELECT resend_contact_id FROM users WHERE id = ?').bind(data.id).first<{ resend_contact_id: string | null }>();
  if (!await deleteResendContact(env, user?.resend_contact_id ?? null)) return 'invalid';
  await db.prepare('DELETE FROM review_request_votes WHERE user_id = ?').bind(data.id).run();
  await db.prepare('DELETE FROM review_request_votes WHERE request_id IN (SELECT id FROM review_requests WHERE user_id = ?)').bind(data.id).run();
  await db.prepare('DELETE FROM review_requests WHERE user_id = ?').bind(data.id).run();
  await db.prepare('UPDATE review_requests SET votes = (SELECT COUNT(*) FROM review_request_votes WHERE request_id = review_requests.id)').run();
  await db.prepare('DELETE FROM saved_products WHERE user_id = ?').bind(data.id).run();
  await db.prepare('DELETE FROM users WHERE id = ?').bind(data.id).run();
  return 'ok';
}
