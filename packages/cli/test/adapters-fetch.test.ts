import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicClient } from '../src/adapters/anthropic.js';
import { GeminiClient } from '../src/adapters/gemini.js';
import { fetchWithRetry, textContent } from '../src/adapters/http.js';
import type { CompletionRequest } from '../src/adapters/types.js';

// Drive the raw-fetch adapters (Anthropic, Gemini) and the shared http plumbing
// by stubbing global fetch. Captures request bodies to assert on payload
// shaping (system-prompt concatenation, JSON-mode flags) and simulates HTTP
// error statuses to lock in the error-mapping behavior.

interface CapturedCall {
  url: string;
  body: Record<string, unknown>;
}

function stubFetch(handler: (call: CapturedCall, n: number) => { status: number; text: string }) {
  const calls: CapturedCall[] = [];
  let n = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body?: string }) => {
      n += 1;
      const body = JSON.parse(init.body ?? '{}') as Record<string, unknown>;
      calls.push({ url, body });
      const { status, text } = handler({ url, body }, n);
      return { ok: status >= 200 && status < 300, status, text: async () => text };
    })
  );
  return calls;
}

function okAnthropic(text = 'hello') {
  return {
    status: 200,
    text: JSON.stringify({ model: 'm', content: [{ type: 'text', text }], usage: { input_tokens: 3, output_tokens: 4 } })
  };
}

function okGemini(text = 'hello') {
  return {
    status: 200,
    text: JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })
  };
}

const baseRequest: CompletionRequest = {
  model: 'm',
  messages: [{ role: 'user', content: 'hi' }],
  temperature: 0.5,
  maxTokens: 32
};

const anthropicConfig = { apiKey: 'k', timeoutMs: 5000, maxAttempts: 2 };
const geminiConfig = { apiKey: 'k', timeoutMs: 5000, maxAttempts: 2 };

describe('AnthropicClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('concatenates multiple system messages with a blank line', async () => {
    const calls = stubFetch(() => okAnthropic());
    const request: CompletionRequest = {
      ...baseRequest,
      messages: [
        { role: 'system', content: 'first' },
        { role: 'system', content: 'second' },
        { role: 'user', content: 'hi' }
      ]
    };
    await new AnthropicClient(anthropicConfig).complete(request);
    expect(calls[0]?.body['system']).toBe('first\n\nsecond');
  });

  it('appends the JSON notice to an existing system prompt in json_object mode', async () => {
    const calls = stubFetch(() => okAnthropic());
    const request: CompletionRequest = {
      ...baseRequest,
      responseFormat: 'json_object',
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hi' }
      ]
    };
    await new AnthropicClient(anthropicConfig).complete(request);
    expect(calls[0]?.body['system']).toBe('be terse\n\nRespond ONLY with valid JSON.');
  });

  it('throws a descriptive error on a non-retryable HTTP status', async () => {
    stubFetch(() => ({ status: 400, text: 'bad request body' }));
    await expect(new AnthropicClient(anthropicConfig).complete(baseRequest)).rejects.toThrow(
      /Anthropic API error \(400\): bad request body/
    );
  });
});

describe('GeminiClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('concatenates multiple system messages into system_instruction', async () => {
    const calls = stubFetch(() => okGemini());
    const request: CompletionRequest = {
      ...baseRequest,
      messages: [
        { role: 'system', content: 'first' },
        { role: 'system', content: 'second' },
        { role: 'user', content: 'hi' }
      ]
    };
    await new GeminiClient(geminiConfig).complete(request);
    const instruction = calls[0]?.body['system_instruction'] as { parts: { text: string }[] };
    expect(instruction.parts[0]?.text).toBe('first\n\nsecond');
  });

  it('requests application/json in json_object mode', async () => {
    const calls = stubFetch(() => okGemini());
    await new GeminiClient(geminiConfig).complete({ ...baseRequest, responseFormat: 'json_object' });
    const config = calls[0]?.body['generationConfig'] as Record<string, unknown>;
    expect(config['responseMimeType']).toBe('application/json');
  });

  it('throws a descriptive error on a non-retryable HTTP status', async () => {
    stubFetch(() => ({ status: 400, text: 'invalid argument' }));
    await expect(new GeminiClient(geminiConfig).complete(baseRequest)).rejects.toThrow(
      /Gemini API error \(400\): invalid argument/
    );
  });
});

describe('textContent', () => {
  it('passes a plain string part inside an array through', () => {
    expect(textContent(['hello'])).toBe('hello');
  });

  it('returns undefined when no part carries text', () => {
    expect(textContent([{ type: 'image' }, 42, null])).toBeUndefined();
  });
});

describe('fetchWithRetry', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('retries a 503 and returns the successful response', async () => {
    stubFetch((_call, n) => (n === 1 ? { status: 503, text: 'busy' } : { status: 200, text: 'ok' }));
    const result = await fetchWithRetry('https://example.test/x', {
      headers: {},
      body: '{}',
      timeoutMs: 5000,
      maxAttempts: 2
    });
    expect(result).toEqual({ status: 200, ok: true, text: 'ok' });
  }, 10000);

  it('rejects immediately when maxAttempts is 0', async () => {
    stubFetch(() => ({ status: 200, text: 'ok' }));
    await expect(
      fetchWithRetry('https://example.test/x', { headers: {}, body: '{}', timeoutMs: 5000, maxAttempts: 0 })
    ).rejects.toThrow(/exhausted 0 attempts/);
  });
});
