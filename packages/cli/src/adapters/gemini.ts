import type { CompletionRequest, CompletionResponse, LlmClient } from './types.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface GeminiConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
}

export class GeminiClient implements LlmClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;

  constructor(config: GeminiConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs ?? 120000;
    this.maxAttempts = config.maxAttempts ?? 5;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    let systemInstructionText: string | undefined;
    const contents: { role: string; parts: { text: string }[] }[] = [];

    for (const msg of request.messages) {
      const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      if (msg.role === 'system') {
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

    const modelName = request.model.startsWith('models/') ? request.model : `models/${request.model}`;
    const url = `${this.baseUrl}/${modelName}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const payload = {
      system_instruction: systemInstructionText ? { parts: [{ text: systemInstructionText }] } : undefined,
      contents,
      generationConfig
    };

    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          const error = new Error(`Gemini API error (${response.status}): ${errText}`);
          (error as unknown as Record<string, unknown>).status = response.status;
          throw error;
        }

        const data = (await response.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
        };

        const firstPart = data.candidates?.[0]?.content?.parts?.[0];
        const content = firstPart?.text ?? '';

        return {
          content,
          model: request.model,
          usage: {
            promptTokens: data.usageMetadata?.promptTokenCount,
            completionTokens: data.usageMetadata?.candidatesTokenCount,
            totalTokens: data.usageMetadata?.totalTokenCount
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
