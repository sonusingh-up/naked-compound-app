import type { AIModelBinding, AskHistoryItem, Env } from './types';

type Message = { role: 'user' | 'assistant'; content: string };

async function anthropic(env: Pick<Env, 'ANTHROPIC_API_KEY'>, system: string, messages: Message[]): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) throw new Error('primary-provider-unconfigured');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: AbortSignal.timeout(20_000),
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 700, system, messages })
  });
  if (!response.ok) throw new Error('primary-provider-failed');
  const payload = await response.json() as { content?: Array<{ type?: string; text?: string }> };
  const answer = payload.content?.filter(item => item.type === 'text').map(item => item.text ?? '').join('').trim();
  if (!answer) throw new Error('primary-provider-empty');
  return answer;
}

async function workersAI(binding: AIModelBinding, system: string, messages: Message[]): Promise<string> {
  const output = await binding.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [{ role: 'system', content: system }, ...messages], max_tokens: 700, temperature: 0.1
  }) as { response?: string };
  if (!output.response?.trim()) throw new Error('fallback-provider-empty');
  return output.response.trim();
}

export function createGenerator(env: Pick<Env, 'AI' | 'ANTHROPIC_API_KEY'>) {
  return async (system: string, user: string, history: AskHistoryItem[]): Promise<string> => {
    const messages: Message[] = [...history, { role: 'user', content: user }];
    try {
      if (!env.ANTHROPIC_API_KEY) throw new Error('primary-provider-unconfigured');
      return await anthropic(env, system, messages);
    } catch {
      if (!env.AI) throw new Error('model-provider-unavailable');
      return workersAI(env.AI, system, messages);
    }
  };
}
