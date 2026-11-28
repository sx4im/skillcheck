import { baseUrl as checkedBaseUrl } from '../core/security/endpoint.js';
import { registerSecret, sanitizeTerminal } from '../core/security/output.js';
import { ProviderHttpError, ProviderResponseError } from '../errors.js';
import { record } from './http.js';
import { providerFetch, readProviderJson } from './transport.js';
import { AnthropicClient } from './anthropic.js';
import { GeminiClient } from './gemini.js';
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

// Defaults verified against official provider docs on 2026-09-26. When bumping,
// keep the cost profile in mind: the CLI makes many calls per run.
export const DEFAULT_PROVIDER_MODELS: Record<ProviderType, string> = {
  cloud: 'openai/gpt-oss-120b',
  nvidia: 'openai/gpt-oss-120b',
  openai: 'gpt-6-sol',
  anthropic: 'claude-opus-5-5',
  gemini: 'gemini-3.8-flash',
  groq: 'openai/gpt-oss-120b',
  mistral: 'mistral-large-latest',
  openrouter: 'anthropic/claude-opus-5.5'
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

const PROVIDER_TIMEOUT_MS = 15000;

export async function fetchProviderModels(
  provider: ProviderType,
  apiKey: string,
  customBaseUrl?: string
): Promise<ModelInfo[]> {
  registerSecret(apiKey);
  const baseUrl = checkedBaseUrl(customBaseUrl || DEFAULT_PROVIDER_BASE_URLS[provider]);
  const headers: Record<string, string> = provider === 'anthropic'
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : provider === 'gemini'
      ? { 'content-type': 'application/json', 'x-goog-api-key': apiKey }
      : { authorization: 'Bearer ' + apiKey };
  const url = baseUrl + '/models' + (provider === 'gemini' ? '?key=' + encodeURIComponent(apiKey) : '');
  const response = await providerFetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new ProviderHttpError('Failed to fetch models from ' + PROVIDER_NAMES[provider] + ' (HTTP ' + response.status + ').', response.status);
  }
  const data = record(await readProviderJson(response, 'Model list'), 'Model list');
  const list = provider === 'gemini' ? data.models : data.data;
  if (!Array.isArray(list)) throw new ProviderResponseError('Provider model list must be an array.');
  return list.map((entry) => {
    const item = record(entry, 'Model entry');
    const id = provider === 'gemini' ? item.name : item.id;
    const name = provider === 'anthropic' ? item.display_name : provider === 'gemini' ? item.displayName : item.name;
    if (typeof id !== 'string' || !id.trim() || (name !== undefined && typeof name !== 'string')) {
      throw new ProviderResponseError('Provider returned an invalid model ID or name.');
    }
    const normalized = provider === 'gemini' ? id.replace(/^models\//, '') : id;
    return { id: normalized, name: name ?? normalized };
  }).filter(({ id }) => provider !== 'gemini' || id.startsWith('gemini'));
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
      message: sanitizeTerminal(error instanceof Error ? error.message : String(error))
    };
  }
}

export function createLlmClient(config: ProviderConfig, options: { defaultHeaders?: Record<string, string> } = {}): LlmClient {
  const baseUrl = checkedBaseUrl(config.baseUrl || DEFAULT_PROVIDER_BASE_URLS[config.provider]);
  registerSecret(config.apiKey);

  if (config.provider === 'anthropic') {
    return new AnthropicClient({
      apiKey: config.apiKey,
      baseUrl,
      timeoutMs: config.timeoutMs,
      maxAttempts: config.maxAttempts,
      maxRetryDelayMs: config.maxRetryDelayMs,
      requestDelayMs: config.requestDelayMs,
      defaultHeaders: options.defaultHeaders
    });
  }

  if (config.provider === 'gemini') {
    return new GeminiClient({
      apiKey: config.apiKey,
      baseUrl,
      timeoutMs: config.timeoutMs,
      maxAttempts: config.maxAttempts,
      maxRetryDelayMs: config.maxRetryDelayMs,
      requestDelayMs: config.requestDelayMs,
      defaultHeaders: options.defaultHeaders
    });
  }

  const sendChatTemplateKwargs = config.provider === 'nvidia' || config.provider === 'cloud';

  return new OpenAiCompatClient(
    {
      apiKey: config.apiKey,
      baseUrl,
      timeoutMs: config.timeoutMs,
      requestDelayMs: config.requestDelayMs,
      maxAttempts: config.maxAttempts,
      maxRetryDelayMs: config.maxRetryDelayMs,
      sendChatTemplateKwargs
    },
    options
  );
}
