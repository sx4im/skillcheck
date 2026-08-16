import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fetchProviderModels, verifyProviderKey, createLlmClient } from '../src/adapters/providers.js';

describe('providers abstraction', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches models for OpenAI with Bearer token header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }]
      })
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const models = await fetchProviderModels('openai', 'sk-test-key');
    expect(models).toEqual([{ id: 'gpt-4o', name: 'gpt-4o' }, { id: 'gpt-4o-mini', name: 'gpt-4o-mini' }]);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        headers: { authorization: 'Bearer sk-test-key' }
      })
    );
  });

  it('fetches models for Anthropic with x-api-key and anthropic-version headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'claude-3-5-sonnet-20241022', display_name: 'Claude 3.5 Sonnet' }]
      })
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const models = await fetchProviderModels('anthropic', 'ant-key');
    expect(models).toEqual([{ id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' }]);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({
        headers: {
          'x-api-key': 'ant-key',
          'anthropic-version': '2023-06-01'
        }
      })
    );
  });

  it('fetches models for Google Gemini with key query parameter', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: 'models/gemini-1.5-pro', displayName: 'Gemini 1.5 Pro' }]
      })
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const models = await fetchProviderModels('gemini', 'gemini-key');
    expect(models).toEqual([{ id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' }]);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models?key=gemini-key',
      expect.objectContaining({
        method: 'GET'
      })
    );
  });

  it('fetches models for Groq, Mistral, OpenRouter, and NVIDIA NIM', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('groq')) return Promise.resolve({ ok: true, json: async () => ({ data: [{ id: 'llama-3.3-70b-versatile' }] }) });
      if (url.includes('mistral')) return Promise.resolve({ ok: true, json: async () => ({ data: [{ id: 'mistral-large-latest' }] }) });
      if (url.includes('openrouter')) return Promise.resolve({ ok: true, json: async () => ({ data: [{ id: 'anthropic/claude-3.5-sonnet' }] }) });
      return Promise.resolve({ ok: true, json: async () => ({ data: [{ id: 'openai/gpt-oss-120b' }] }) });
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    expect(await fetchProviderModels('groq', 'key')).toEqual([{ id: 'llama-3.3-70b-versatile', name: 'llama-3.3-70b-versatile' }]);
    expect(await fetchProviderModels('mistral', 'key')).toEqual([{ id: 'mistral-large-latest', name: 'mistral-large-latest' }]);
    expect(await fetchProviderModels('openrouter', 'key')).toEqual([{ id: 'anthropic/claude-3.5-sonnet', name: 'anthropic/claude-3.5-sonnet' }]);
    expect(await fetchProviderModels('nvidia', 'key')).toEqual([{ id: 'openai/gpt-oss-120b', name: 'openai/gpt-oss-120b' }]);
  });

  it('verifyProviderKey handles valid and invalid responses', async () => {
    const okFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-4o' }] })
    });
    global.fetch = okFetch as unknown as typeof fetch;

    const validResult = await verifyProviderKey('openai', 'valid-key');
    expect(validResult.valid).toBe(true);
    expect(validResult.models).toHaveLength(1);

    const errFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized'
    });
    global.fetch = errFetch as unknown as typeof fetch;

    const invalidResult = await verifyProviderKey('openai', 'bad-key');
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.models).toEqual([]);
    expect(invalidResult.message).toContain('401');
  });

  it('createLlmClient returns working client for Anthropic and Gemini', async () => {
    const anthropicPayload = {
      model: 'claude-3-5-sonnet-20241022',
      content: [{ type: 'text', text: 'Hello world' }],
      usage: { input_tokens: 10, output_tokens: 5 }
    };
    const anthropicFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(anthropicPayload)
    });
    global.fetch = anthropicFetch as unknown as typeof fetch;

    const anthropicClient = createLlmClient({
      provider: 'anthropic',
      apiKey: 'test-key',
      generatorModel: 'claude-3-5-sonnet-20241022',
      runnerModel: 'claude-3-5-sonnet-20241022',
      graderModel: 'claude-3-5-sonnet-20241022'
    });

    const anthropicRes = await anthropicClient.complete({
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0.7,
      maxTokens: 100
    });
    expect(anthropicRes.content).toBe('Hello world');

    const geminiPayload = {
      candidates: [{ content: { parts: [{ text: '{"status":"ok"}' }] } }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5, totalTokenCount: 10 }
    };
    const geminiFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(geminiPayload)
    });
    global.fetch = geminiFetch as unknown as typeof fetch;

    const geminiClient = createLlmClient({
      provider: 'gemini',
      apiKey: 'test-key',
      generatorModel: 'gemini-1.5-pro',
      runnerModel: 'gemini-1.5-pro',
      graderModel: 'gemini-1.5-pro'
    });

    const geminiRes = await geminiClient.complete({
      model: 'gemini-1.5-pro',
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0.7,
      maxTokens: 100
    });
    expect(geminiRes.content).toBe('{"status":"ok"}');
  });
});
