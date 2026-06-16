import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NvidiaConfig } from '../src/env.js';

// Drive the retry/serialize/extract logic of the adapter by mocking the OpenAI
// SDK underneath it. `createImpl` is swapped per test to simulate successes,
// transient failures, rate limits, and malformed messages.
let createImpl: (body: unknown) => Promise<unknown>;
let createCalls: number;

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    chat = {
      completions: {
        create: (body: unknown) => {
          createCalls += 1;
          return createImpl(body);
        }
      }
    };
    constructor(public opts: unknown) {}
  }
}));

const { NvidiaNimClient } = await import('../src/adapters/nvidia-nim.js');

const baseConfig: NvidiaConfig = {
  apiKey: 'test',
  baseUrl: 'https://example.test/v1',
  timeoutMs: 1000,
  requestDelayMs: 0,
  maxAttempts: 4,
  maxRetryDelayMs: 1, // keep backoff sleeps sub-millisecond in tests
  generatorModel: 'g',
  graderModel: 'gr',
  runnerModel: 'r'
};

function completion(message: Record<string, unknown>, usage?: Record<string, number>) {
  return { choices: [{ message }], model: 'fake-model', usage };
}

const request = {
  model: 'r',
  messages: [{ role: 'user' as const, content: 'hi' }],
  temperature: 0.7,
  maxTokens: 100
};

describe('NvidiaNimClient', () => {
  beforeEach(() => {
    createCalls = 0;
    createImpl = async () => completion({ content: 'ok' });
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns content, model, and normalized usage on success', async () => {
    createImpl = async () =>
      completion({ content: 'hello' }, { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 });
    const client = new NvidiaNimClient(baseConfig);
    const res = await client.complete(request);
    expect(res.content).toBe('hello');
    expect(res.model).toBe('fake-model');
    expect(res.usage).toEqual({ promptTokens: 11, completionTokens: 7, totalTokens: 18 });
    expect(createCalls).toBe(1);
  });

  it('falls back to reasoning_content, then to a joined content array', async () => {
    createImpl = async () => completion({ reasoning_content: 'thinking out loud' });
    expect((await new NvidiaNimClient(baseConfig).complete(request)).content).toBe('thinking out loud');

    createImpl = async () =>
      completion({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] });
    expect((await new NvidiaNimClient(baseConfig).complete(request)).content).toBe('ab');
  });

  it('retries a 429 and then succeeds', async () => {
    let attempt = 0;
    createImpl = async () => {
      attempt += 1;
      if (attempt === 1) {
        throw Object.assign(new Error('rate limited'), { status: 429, headers: { 'retry-after': '0' } });
      }
      return completion({ content: 'after retry' });
    };
    const res = await new NvidiaNimClient(baseConfig).complete(request);
    expect(res.content).toBe('after retry');
    expect(createCalls).toBe(2);
  });

  it('gives up after exhausting attempts on persistent 503', async () => {
    createImpl = async () => {
      throw Object.assign(new Error('unavailable'), { status: 503 });
    };
    await expect(new NvidiaNimClient(baseConfig).complete(request)).rejects.toThrow(/unavailable/);
    expect(createCalls).toBe(baseConfig.maxAttempts);
  });

  it('does not retry a non-retryable 400', async () => {
    createImpl = async () => {
      throw Object.assign(new Error('bad request'), { status: 400 });
    };
    await expect(new NvidiaNimClient(baseConfig).complete(request)).rejects.toThrow(/bad request/);
    expect(createCalls).toBe(1);
  });

  it('throws a descriptive error when the message carries no text', async () => {
    createImpl = async () => completion({ tool_calls: [] });
    await expect(new NvidiaNimClient(baseConfig).complete(request)).rejects.toThrow(/did not include text content/);
  });
});
