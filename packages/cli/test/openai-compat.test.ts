import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Drive the retry/serialize/extract logic of the adapter by mocking the OpenAI
// SDK underneath it. `createImpl` is swapped per test to simulate successes,
// transient failures, rate limits, and malformed messages. `sleep` from the
// shared http plumbing is also mocked (calls recorded in `sleepCalls`) so
// backoff/retry-after/pacing delays stay instant and assertable.
let createImpl: (body: unknown) => Promise<unknown>;
let createCalls: number;
const sleepCalls: number[] = [];

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

vi.mock('../src/adapters/http.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/adapters/http.js')>();
  return {
    ...mod,
    sleep: (ms: number) => {
      sleepCalls.push(ms);
      return Promise.resolve();
    }
  };
});

const { OpenAiCompatClient } = await import('../src/adapters/openai-compat.js');

const baseConfig = {
  apiKey: 'test',
  baseUrl: 'https://example.test/v1',
  timeoutMs: 1000,
  requestDelayMs: 0,
  maxAttempts: 4,
  maxRetryDelayMs: 1 // keep backoff sleeps sub-millisecond in tests
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

describe('OpenAiCompatClient', () => {
  beforeEach(() => {
    createCalls = 0;
    createImpl = async () => completion({ content: 'ok' });
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns content, model, and normalized usage on success', async () => {
    createImpl = async () =>
      completion({ content: 'hello' }, { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 });
    const client = new OpenAiCompatClient(baseConfig);
    const res = await client.complete(request);
    expect(res.content).toBe('hello');
    expect(res.model).toBe('fake-model');
    expect(res.usage).toEqual({ promptTokens: 11, completionTokens: 7, totalTokens: 18 });
    expect(createCalls).toBe(1);
  });

  it('falls back to reasoning_content, then to a joined content array', async () => {
    createImpl = async () => completion({ reasoning_content: 'thinking out loud' });
    expect((await new OpenAiCompatClient(baseConfig).complete(request)).content).toBe('thinking out loud');

    createImpl = async () =>
      completion({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] });
    expect((await new OpenAiCompatClient(baseConfig).complete(request)).content).toBe('ab');
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
    const res = await new OpenAiCompatClient(baseConfig).complete(request);
    expect(res.content).toBe('after retry');
    expect(createCalls).toBe(2);
  });

  it('gives up after exhausting attempts on persistent 503', async () => {
    createImpl = async () => {
      throw Object.assign(new Error('unavailable'), { status: 503 });
    };
    await expect(new OpenAiCompatClient(baseConfig).complete(request)).rejects.toThrow(/unavailable/);
    expect(createCalls).toBe(baseConfig.maxAttempts);
  });

  it('does not retry a non-retryable 400', async () => {
    createImpl = async () => {
      throw Object.assign(new Error('bad request'), { status: 400 });
    };
    await expect(new OpenAiCompatClient(baseConfig).complete(request)).rejects.toThrow(/bad request/);
    expect(createCalls).toBe(1);
  });

  it('throws a descriptive error when the message carries no text', async () => {
    createImpl = async () => completion({ tool_calls: [] });
    await expect(new OpenAiCompatClient(baseConfig).complete(request)).rejects.toThrow(/did not include text content/);
  });

  it('sends chat_template_kwargs when enabled', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    createImpl = async (body) => {
      capturedBody = body as Record<string, unknown>;
      return completion({ content: 'ok' });
    };
    await new OpenAiCompatClient({ ...baseConfig, sendChatTemplateKwargs: true }).complete(request);
    expect(capturedBody?.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it('omits chat_template_kwargs when disabled', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    createImpl = async (body) => {
      capturedBody = body as Record<string, unknown>;
      return completion({ content: 'ok' });
    };
    await new OpenAiCompatClient({ ...baseConfig, sendChatTemplateKwargs: false }).complete(request);
    expect(capturedBody).not.toHaveProperty('chat_template_kwargs');
  });

  it('honors a retry-after delay in seconds', async () => {
    sleepCalls.length = 0;
    let attempt = 0;
    createImpl = async () => {
      attempt += 1;
      if (attempt === 1) {
        throw Object.assign(new Error('rate limited'), { status: 429, headers: { 'retry-after': '120' } });
      }
      return completion({ content: 'after retry' });
    };
    const res = await new OpenAiCompatClient(baseConfig).complete(request);
    expect(res.content).toBe('after retry');
    expect(sleepCalls).toContain(120000);
  });

  it('honors retry-after sent as a Headers instance', async () => {
    sleepCalls.length = 0;
    let attempt = 0;
    createImpl = async () => {
      attempt += 1;
      if (attempt === 1) {
        throw Object.assign(new Error('rate limited'), {
          status: 429,
          headers: new Headers({ 'retry-after': '45' })
        });
      }
      return completion({ content: 'after retry' });
    };
    await new OpenAiCompatClient(baseConfig).complete(request);
    expect(sleepCalls).toContain(45000);
  });

  it('honors retry-after sent as an HTTP date', async () => {
    sleepCalls.length = 0;
    let attempt = 0;
    createImpl = async () => {
      attempt += 1;
      if (attempt === 1) {
        throw Object.assign(new Error('rate limited'), {
          status: 429,
          headers: { 'retry-after': new Date(Date.now() + 8000).toUTCString() }
        });
      }
      return completion({ content: 'after retry' });
    };
    await new OpenAiCompatClient(baseConfig).complete(request);
    const delay = sleepCalls[0] ?? -1;
    expect(delay).toBeGreaterThan(5000);
    expect(delay).toBeLessThanOrEqual(8000);
  });

  it('falls back to capped backoff when retry-after is unparsable', async () => {
    sleepCalls.length = 0;
    let attempt = 0;
    createImpl = async () => {
      attempt += 1;
      if (attempt === 1) {
        throw Object.assign(new Error('rate limited'), { status: 429, headers: { 'retry-after': 'not-a-date' } });
      }
      return completion({ content: 'after retry' });
    };
    await new OpenAiCompatClient(baseConfig).complete(request);
    expect(sleepCalls).toEqual([baseConfig.maxRetryDelayMs]);
  });

  it('throws a descriptive error when the choice message is not an object', async () => {
    createImpl = async () => ({ choices: [{ message: 'raw-string' }], model: 'x' });
    await expect(new OpenAiCompatClient(baseConfig).complete(request)).rejects.toThrow(/did not include text content/);
  });

  it('paces sequential requests by requestDelayMs', async () => {
    sleepCalls.length = 0;
    createImpl = async () => completion({ content: 'ok' });
    const client = new OpenAiCompatClient({ ...baseConfig, requestDelayMs: 50 });
    await client.complete(request);
    await client.complete(request);
    expect(sleepCalls.some((ms) => ms > 0 && ms <= 50)).toBe(true);
  });
});
