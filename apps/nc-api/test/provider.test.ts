import { describe, expect, it, vi } from 'vitest';
import { createGenerator } from '../src/ai/provider';

describe('AI provider interface', () => {
  it('uses the configured Anthropic Messages endpoint as the primary provider', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { model: string; max_tokens: number };
      expect(request.model).toBe('claude-haiku-5-5');
      expect(request.max_tokens).toBe(700);
      return Response.json({ content: [{ type: 'text', text: 'primary answer' }] });
    });
    try {
      const generate = createGenerator({ ANTHROPIC_API_KEY: 'test-only-key' });
      await expect(generate('system', 'user', [])).resolves.toBe('primary answer');
    } finally { globalThis.fetch = originalFetch; }
  });

  it('uses Workers AI when the primary provider is not configured', async () => {
    const run = vi.fn(async () => ({ response: 'recorded fallback' }));
    const generate = createGenerator({ AI: { run } });
    await expect(generate('system', 'user', [])).resolves.toBe('recorded fallback');
    expect(run).toHaveBeenCalledWith('@cf/meta/llama-3.1-8b-instruct', expect.objectContaining({ max_tokens: 700 }));
  });

  it('falls back to Workers AI after a failed Anthropic request without exposing provider details', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response('provider internal detail', { status: 503 }));
    const run = vi.fn(async () => ({ response: 'fallback answer' }));
    try {
      const generate = createGenerator({ ANTHROPIC_API_KEY: 'test-only-key', AI: { run } });
      await expect(generate('system', 'user', [])).resolves.toBe('fallback answer');
      expect(run).toHaveBeenCalledOnce();
    } finally { globalThis.fetch = originalFetch; }
  });

  it('fails generically if neither provider is available', async () => {
    const generate = createGenerator({});
    await expect(generate('system', 'user', [])).rejects.toThrow('model-provider-unavailable');
  });
});
