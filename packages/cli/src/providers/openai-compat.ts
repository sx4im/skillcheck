import { baseUrl } from '../core/security/endpoint.js';
import { ProviderResponseError } from '../errors.js';
import { optionalTokens, ProviderRequests, record, responseObject, textContent } from './http.js';
import type { CompletionRequest, CompletionResponse, LlmClient } from './types.js';

export interface OpenAiCompatConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
  requestDelayMs?: number;
  maxAttempts?: number;
  maxRetryDelayMs?: number;
  /** Whether to send chat_template_kwargs in request body (needed for NVIDIA NIM). */
  sendChatTemplateKwargs?: boolean;
}

export class OpenAiCompatClient implements LlmClient {
  private readonly requests: ProviderRequests;
  private readonly endpoint: string;

  constructor(private readonly config: OpenAiCompatConfig, private readonly options: { defaultHeaders?: Record<string, string> } = {}) {
    this.endpoint = baseUrl(config.baseUrl) + '/chat/completions';
    this.requests = new ProviderRequests({ maxAttempts: 8, requestDelayMs: 750, ...config });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const body = {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      response_format: request.responseFormat ? { type: request.responseFormat } : undefined,
      stream: false,
      chat_template_kwargs: (this.config.sendChatTemplateKwargs ?? true)
        ? { enable_thinking: false, ...request.chatTemplateKwargs }
        : undefined
    };
    const result = await this.requests.post(this.endpoint, {
      ...this.options.defaultHeaders,
      authorization: 'Bearer ' + this.config.apiKey,
      'content-type': 'application/json'
    }, JSON.stringify(body));
    const data = responseObject(result, 'Model provider', this.config.apiKey);
    const choice = Array.isArray(data.choices) ? data.choices[0] as { message?: unknown } | undefined : undefined;
    const message = choice?.message;
    const content = message && typeof message === 'object' && !Array.isArray(message)
      ? textContent((message as Record<string, unknown>).content) ??
        textContent((message as Record<string, unknown>).reasoning_content) ??
        textContent((message as Record<string, unknown>).refusal)
      : undefined;
    if (content === undefined) throw new ProviderResponseError('LLM response did not include text content.');
    if (typeof data.model !== 'string' || !data.model) throw new ProviderResponseError('Provider response is missing a model ID.');
    const usage = data.usage == null ? {} : record(data.usage, 'Provider usage');
    return {
      content,
      model: data.model,
      usage: {
        promptTokens: optionalTokens(usage.prompt_tokens),
        completionTokens: optionalTokens(usage.completion_tokens),
        totalTokens: optionalTokens(usage.total_tokens)
      }
    };
  }
}
