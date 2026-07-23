import type { CompletionRequest, CompletionResponse, LlmClient } from './types.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
      const contentStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
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

    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetch(`${this.baseUrl}/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          const error = new Error(`Anthropic API error (${response.status}): ${errText}`);
          (error as unknown as Record<string, unknown>).status = response.status;
          throw error;
        }

        const data = (await response.json()) as {
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
      } catch (error) {
        lastError = error;
        const status = (error as { status?: number })?.status;
        const retryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
        if (!retryable || attempt === this.maxAttempts - 1) {
          break;
        }
        await sleep(1000 * 2 ** attempt);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
