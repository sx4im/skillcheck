import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probeLocalLlm, pickSuggestedModel } from '../src/local-llm.js';

describe('local LLM auto-discovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects running Ollama instance on port 11434', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('11434')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                { id: 'llama3.1:8b' },
                { id: 'qwen2.5-coder:32b' },
                { id: 'nomic-embed-text' }
              ]
            })
          };
        }
        throw new Error('Connection refused');
      })
    );

    const result = await probeLocalLlm(100);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('ollama');
    expect(result?.baseUrl).toBe('http://127.0.0.1:11434/v1');
    expect(result?.models).toEqual(['llama3.1:8b', 'qwen2.5-coder:32b', 'nomic-embed-text']);
    expect(result?.suggestedModel).toBe('qwen2.5-coder:32b');
  });

  it('detects running LM Studio instance on port 1234 when Ollama is offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('1234')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{ id: 'deepseek-r1-distill-qwen-14b' }, { id: 'meta-llama-3.1-8b-instruct' }]
            })
          };
        }
        throw new Error('Connection refused');
      })
    );

    const result = await probeLocalLlm(100);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('lmstudio');
    expect(result?.baseUrl).toBe('http://127.0.0.1:1234/v1');
    expect(result?.suggestedModel).toBe('deepseek-r1-distill-qwen-14b');
  });

  it('returns null when no local endpoints are responding', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Connection refused');
      })
    );

    const result = await probeLocalLlm(50);
    expect(result).toBeNull();
  });

  it('picks suggested model heuristically prioritizing coding and reasoning models', () => {
    expect(pickSuggestedModel(['llama3.1:8b', 'qwen2.5-coder:7b', 'phi4:14b'])).toBe('qwen2.5-coder:7b');
    expect(pickSuggestedModel(['text-embedding-3', 'deepseek-coder:6.7b'])).toBe('deepseek-coder:6.7b');
    expect(pickSuggestedModel(['custom-model-v1'])).toBe('custom-model-v1');
    expect(pickSuggestedModel([])).toBeUndefined();
  });
});
