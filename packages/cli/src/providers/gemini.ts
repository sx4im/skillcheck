import { baseUrl } from '../core/security/endpoint.js';
import { ProviderResponseError, ValidationError } from '../errors.js';
import { optionalTokens, ProviderRequests, record, responseObject, textContent } from './http.js';
import type { CompletionRequest, CompletionResponse, LlmClient } from './types.js';

export interface GeminiConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  maxRetryDelayMs?: number;
  requestDelayMs?: number;
  /** Extra headers merged into every request (e.g. the x-skillcheck-run id). */
  defaultHeaders?: Record<string, string>;
}

export class GeminiClient implements LlmClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly requests: ProviderRequests;
  private readonly defaultHeaders: Record<string, string>;

  constructor(config: GeminiConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = baseUrl(config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta');
    this.requests = new ProviderRequests(config);
    this.defaultHeaders = config.defaultHeaders ?? {};
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    let systemInstructionText: string | undefined;
    const contents: { role: string; parts: { text: string }[] }[] = [];

    for (const msg of request.messages) {
      const text = textContent(msg.content) ?? '';
      if ((msg.role === 'system' || msg.role === 'developer')) {
        systemInstructionText = systemInstructionText ? `${systemInstructionText}\n\n${text}` : text;
      } else {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text }]
        });
      }
    }

    const generationConfig: Record<string, unknown> = {
      temperature: request.temperature,
      maxOutputTokens: request.maxTokens
    };

    if (request.responseFormat === 'json_object') {
      generationConfig.responseMimeType = 'application/json';
    }

    if (!/^(?:(?:models|tunedModels)\/)?[\w.-]+$/.test(request.model)) throw new ValidationError('Invalid Gemini model ID.');
    const modelName = request.model.includes('/') ? request.model : 'models/' + request.model;
    const url = `${this.baseUrl}/${modelName}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const payload = {
      system_instruction: systemInstructionText ? { parts: [{ text: systemInstructionText }] } : undefined,
      contents,
      generationConfig
    };

    const result = await this.requests.post(url, {
      ...this.defaultHeaders,
      'content-type': 'application/json',
      'x-goog-api-key': this.apiKey
    }, JSON.stringify(payload));
    const data = responseObject(result, 'Gemini', this.apiKey);
    const candidate = Array.isArray(data.candidates) ? record(data.candidates[0], 'Gemini candidate') : {};
    const message = record(candidate.content, 'Gemini content');
    const parts = Array.isArray(message.parts) ? message.parts : [];
    const content = textContent(parts);
    if (content === undefined) throw new ProviderResponseError('Gemini response is missing text content.');
    const usage = data.usageMetadata === undefined ? {} : record(data.usageMetadata, 'Gemini usage');
    return {
      content,
      model: request.model,
      usage: {
        promptTokens: optionalTokens(usage.promptTokenCount),
        completionTokens: optionalTokens(usage.candidatesTokenCount),
        totalTokens: optionalTokens(usage.totalTokenCount)
      }
    };
  }
}
