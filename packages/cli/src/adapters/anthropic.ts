import { fetchWithRetry, textContent } from './http.js';
import type { CompletionRequest, CompletionResponse, LlmClient } from './types.js';

export interface AnthropicConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
}

export class AnthropicClient implements LlmClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;

  constructor(config: AnthropicConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs ?? 120000;
    this.maxAttempts = config.maxAttempts ?? 5;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    let systemPrompt: string | undefined;
    const formattedMessages: { role: string; content: string }[] = [];

    for (const msg of request.messages) {
      const contentStr = textContent(msg.content) ?? '';
      if (msg.role === 'system') {
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

    const result = await fetchWithRetry(`${this.baseUrl}/messages`, {
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload),
      timeoutMs: this.timeoutMs,
      maxAttempts: this.maxAttempts
    });
    if (!result.ok) {
      throw new Error(`Anthropic API error (${result.status}): ${result.text}`);
    }

    const data = JSON.parse(result.text) as {
      model?: string;
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const textPart = data.content?.find((part) => part.type === 'text');
    const content = textPart?.text ?? '';

    return {
      content,
      model: data.model ?? request.model,
      usage: {
        promptTokens: data.usage?.input_tokens,
        completionTokens: data.usage?.output_tokens,
        totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0)
      }
    };
  }
}
