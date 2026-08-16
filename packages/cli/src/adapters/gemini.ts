import { fetchWithRetry, textContent } from './http.js';
import type { CompletionRequest, CompletionResponse, LlmClient } from './types.js';

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
      const text = textContent(msg.content) ?? '';
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

    const result = await fetchWithRetry(url, {
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload),
      timeoutMs: this.timeoutMs,
      maxAttempts: this.maxAttempts
    });
    if (!result.ok) {
      throw new Error(`Gemini API error (${result.status}): ${result.text}`);
    }

    const data = JSON.parse(result.text) as {
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
  }
}
