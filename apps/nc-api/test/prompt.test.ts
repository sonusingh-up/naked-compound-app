import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT } from '../src/ai/prompt';

describe('Ask NC editorial system prompt', () => {
  it('matches the approved prompt verbatim from 03-review-standards.md', () => {
    const standards = readFileSync(new URL('../../../docs/nc-app/03-review-standards.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const prompt = standards.match(/## System prompt for Ask NC[^\n]*\n\n```\n([\s\S]*?)\n```/)?.[1];
    expect(prompt).toBeDefined();
    expect(SYSTEM_PROMPT).toBe(prompt);
  });
});
