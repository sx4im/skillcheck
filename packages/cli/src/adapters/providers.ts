import { AnthropicClient } from './anthropic.js';
import { GeminiClient } from './gemini.js';
import { NvidiaNimClient } from './nvidia-nim.js';
import { OpenAiCompatClient } from './openai-compat.js';
import type { LlmClient, ModelInfo, ProviderConfig, ProviderType } from './types.js';

export const DEFAULT_PROVIDER_BASE_URLS: Record<ProviderType, string> = {
  cloud: 'https://www.skillcheck.page/api',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1'
};

export const DEFAULT_PROVIDER_MODELS: Record<ProviderType, string> = {
  cloud: 'openai/gpt-oss-120b',
  nvidia: 'openai/gpt-oss-120b',
  openai: 'gpt-4o',
  anthropic: 'claude-3-5-sonnet-20241022',
  gemini: 'gemini-1.5-pro',
  groq: 'llama-3.3-70b-versatile',
  mistral: 'mistral-large-latest',
  openrouter: 'anthropic/claude-3.5-sonnet'
};

export const PROVIDER_NAMES: Record<ProviderType, string> = {
  cloud: 'Skillcheck Cloud (Hosted)',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  groq: 'Groq',
  mistral: 'Mistral AI',
  openrouter: 'OpenRouter',
  nvidia: 'NVIDIA NIM'
};

export async function fetchProviderModels(
  provider: ProviderType,
  apiKey: string,
  customBaseUrl?: string
): Promise<ModelInfo[]> {
  const baseUrl = (customBaseUrl || DEFAULT_PROVIDER_BASE_URLS[provider]).replace(/\/+$/, '');

  if (provider === 'anthropic') {
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Failed to fetch models from Anthropic (HTTP ${response.status}): ${errText}`);
    }

    const data = (await response.json()) as { data?: { id: string; display_name?: string }[] };
    if (!Array.isArray(data.data)) {
      return [{ id: DEFAULT_PROVIDER_MODELS.anthropic }];
    }
    return data.data.map((m) => ({ id: m.id, name: m.display_name ?? m.id }));
  }

  if (provider === 'gemini') {
    const url = `${baseUrl}/models?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'content-type': 'application/json' }
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Failed to fetch models from Gemini (HTTP ${response.status}): ${errText}`);
    }

    const data = (await response.json()) as { models?: { name: string; displayName?: string }[] };
    if (!Array.isArray(data.models)) {
      return [{ id: DEFAULT_PROVIDER_MODELS.gemini }];
    }
    return data.models
      .map((m) => {
        const id = m.name.replace(/^models\//, '');
        return { id, name: m.displayName ?? id };
      })
      .filter((m) => m.id.startsWith('gemini'));
  }

  // OpenAI-compatible providers: openai, groq, mistral, openrouter, nvidia, cloud
  const response = await fetch(`${baseUrl}/models`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${apiKey}`
    }
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Failed to fetch models from ${PROVIDER_NAMES[provider]} (HTTP ${response.status}): ${errText}`);
  }

  const data = (await response.json()) as { data?: { id: string; name?: string }[] };
  if (!Array.isArray(data.data)) {
    return [{ id: DEFAULT_PROVIDER_MODELS[provider] }];
  }

  return data.data.map((m) => ({ id: m.id, name: m.name ?? m.id }));
}

export async function verifyProviderKey(
  provider: ProviderType,
  apiKey: string,
  baseUrl?: string
): Promise<{ valid: boolean; models: ModelInfo[]; message?: string }> {
  try {
    const models = await fetchProviderModels(provider, apiKey, baseUrl);
    return { valid: true, models };
  } catch (error) {
    return {
      valid: false,
      models: [],
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

export function createLlmClient(config: ProviderConfig): LlmClient {
  const baseUrl = config.baseUrl || DEFAULT_PROVIDER_BASE_URLS[config.provider] || DEFAULT_PROVIDER_BASE_URLS.nvidia;

  if (config.provider === 'anthropic') {
    return new AnthropicClient({
      apiKey: config.apiKey,
      baseUrl,
      timeoutMs: config.timeoutMs,
      maxAttempts: config.maxAttempts
    });
  }

  if (config.provider === 'gemini') {
    return new GeminiClient({
      apiKey: config.apiKey,
      baseUrl,
      timeoutMs: config.timeoutMs,
      maxAttempts: config.maxAttempts
    });
  }

  if (config.provider === 'nvidia' || config.provider === 'cloud') {
    return new NvidiaNimClient({
      apiKey: config.apiKey,
      baseUrl,
      timeoutMs: config.timeoutMs ?? 120000,
      requestDelayMs: config.requestDelayMs ?? 750,
      maxAttempts: config.maxAttempts ?? 8,
      maxRetryDelayMs: config.maxRetryDelayMs ?? 60000,
      generatorModel: config.generatorModel,
      graderModel: config.graderModel,
      runnerModel: config.runnerModel
    });
  }

  return new OpenAiCompatClient({
    apiKey: config.apiKey,
    baseUrl,
    timeoutMs: config.timeoutMs,
    requestDelayMs: config.requestDelayMs,
    maxAttempts: config.maxAttempts,
    maxRetryDelayMs: config.maxRetryDelayMs,
    sendChatTemplateKwargs: false
  });
}
