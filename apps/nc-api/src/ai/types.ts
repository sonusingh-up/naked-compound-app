export type Product = {
  id: string;
  brand: string;
  name: string;
  score: number | null;
  grade: string | null;
  summary: string | null;
  form: string | null;
  price_inr: number | null;
  price_checked_at: string | null;
  quantity: string | null;
  categories: string[];
  flags: Record<string, string | number | boolean | null> | null;
  cost_per_dose_inr: number | null;
  updated_at: string;
};

export type Intent = 'find' | 'compare' | 'explain' | 'off-topic' | 'medical';
export type AskHistoryItem = { role: 'user' | 'assistant'; content: string };
export type AskInput = { question: string; history: AskHistoryItem[] };
export type AskFilters = { maxPrice?: number; category?: string; flags: string[] };
export type AskResult = { answer: string; productIds: string[]; cached: boolean };

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}
export interface D1Database { prepare(sql: string): D1Statement }
export interface R2ImageObject {
  body: ReadableStream<Uint8Array>;
  size: number;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: { contentType?: string; cacheControl?: string };
}
export interface R2ImageBucket { get(key: string): Promise<R2ImageObject | null> }
export interface VectorizeIndex {
  query(vector: number[], options: { topK: number; returnMetadata: 'all' }): Promise<{ matches?: Array<{ id: string; score?: number; metadata?: Record<string, unknown> }> }>;
}
export interface AIModelBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}
export interface RateLimitBinding {
  limit(options: { key: string; delta?: number }): Promise<{ success: boolean }>
}
export type Env = {
  DB: D1Database;
  IMAGES?: R2ImageBucket;
  REVIEWS?: VectorizeIndex;
  AI?: AIModelBinding;
  ASK_LIMITER?: RateLimitBinding;
  ANTHROPIC_API_KEY?: string;
  AI_CACHE_HMAC_KEY?: string;
  CLERK_JWT_KEY?: string;
  CLERK_ISSUER?: string;
  CLERK_AUDIENCE?: string;
  CLERK_AUTHORIZED_PARTIES?: string;
  CLERK_SECRET_KEY?: string;
  CLERK_WEBHOOK_SECRET?: string;
  RESEND_API_KEY?: string;
  REVIEW_VOTE_HMAC_KEY?: string;
  USER_RATE_LIMIT_HMAC_KEY?: string;
  BRAND_HOSTS?: string;
  USER_LIMITER?: RateLimitBinding;
};

export type AskDependencies = {
  retrieve(question: string, filters: AskFilters): Promise<Product[]>;
  generate(system: string, user: string, history: AskHistoryItem[]): Promise<string>;
  cache?: {
    get(key: string): Promise<{ answer: string; productIds: string[] } | null>;
    put(key: string, answer: string, productIds: string[]): Promise<void>;
  };
  cacheSecret?: string;
};
