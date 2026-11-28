import { baseUrl } from '../core/security/endpoint.js';
import { ProviderResponseError } from '../errors.js';
import { optionalTokens, ProviderRequests, record, responseObject, textContent } from './http.js';
import type { CompletionRequest, CompletionResponse, LlmClient } from './types.js';

export interface AnthropicConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  maxRetryDelayMs?: number;
  requestDelayMs?: number;
  /** Extra headers merged into every request (e.g. the x-skillcheck-run id). */
  defaultHeaders?: Record<string, string>;
}

export class AnthropicClient implements LlmClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly requests: ProviderRequests;
  private readonly defaultHeaders: Record<string, string>;

  constructor(config: AnthropicConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = baseUrl(config.baseUrl || 'https://api.anthropic.com/v1');
    this.requests = new ProviderRequests(config);
    this.defaultHeaders = config.defaultHeaders ?? {};
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    let systemPrompt: string | undefined;
    const formattedMessages: { role: string; content: string }[] = [];

    for (const msg of request.messages) {
      const contentStr = textContent(msg.content) ?? '';
      if ((msg.role === 'system' || msg.role === 'developer')) {
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${contentStr}` : contentStr;
      } else {
        formattedMessages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: contentStr
        });
      }
    }

    if (request.responseFormat === 'json_object') {
      const jsonNotice = 'Respond ONLY with valid JSON.';
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${jsonNotice}` : jsonNotice;
    }

    const payload = {
      model: request.model,
      system: systemPrompt,
      messages: formattedMessages,
      max_tokens: request.maxTokens,
      temperature: request.temperature
    };

    const result = await this.requests.post(this.baseUrl + '/messages', {
      ...this.defaultHeaders,
      'content-type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01'
    }, JSON.stringify(payload));
    const data = responseObject(result, 'Anthropic', this.apiKey);
    if (!Array.isArray(data.content)) throw new ProviderResponseError('Anthropic response is missing content.');
    const textParts = data.content.map((part) => record(part, 'Anthropic content')).filter((part) => part.type === 'text');
    if (!textParts.length || textParts.some((part) => typeof part.text !== 'string')) {
      throw new ProviderResponseError('Anthropic response is missing text content.');
    }
    if (typeof data.model !== 'string' || !data.model) throw new ProviderResponseError('Anthropic response is missing a model ID.');
    const usage = data.usage === undefined ? {} : record(data.usage, 'Anthropic usage');
    const promptTokens = optionalTokens(usage.input_tokens);
    const completionTokens = optionalTokens(usage.output_tokens);
    return {
      content: textParts.map(({ text }) => text).join(''),
      model: data.model,
      usage: { promptTokens, completionTokens, totalTokens: (promptTokens ?? 0) + (completionTokens ?? 0) }
    };
  }
}
