import OpenAI from 'openai';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import { sleep, textContent } from './http.js';
import type { CompletionRequest, CompletionResponse, LlmClient } from './types.js';

const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);

function extractTextContent(content: unknown): string | undefined {
  return textContent(content);
}

function extractMessageText(message: unknown): string | undefined {
  if (typeof message !== 'object' || message === null) {
    return undefined;
  }

  const record = message as { content?: unknown; reasoning_content?: unknown; refusal?: unknown };
  return (
    extractTextContent(record.content) ??
    extractTextContent(record.reasoning_content) ??
    extractTextContent(record.refusal)
  );
}

function getStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

function getRetryAfterMs(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('headers' in error)) {
    return undefined;
  }

  const headers = (error as { headers?: unknown }).headers;
  const retryAfter =
    headers instanceof Headers
      ? headers.get('retry-after')
      : typeof headers === 'object' && headers !== null && 'retry-after' in headers
        ? (headers as { 'retry-after'?: unknown })['retry-after']
        : undefined;

  if (typeof retryAfter !== 'string') {
    return undefined;
  }

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  const dateMs = Date.parse(retryAfter);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return undefined;
}

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
  private static requestQueue: Promise<void> = Promise.resolve();
  private static lastRequestAt = 0;

  private readonly client: OpenAI;
  private readonly requestDelayMs: number;
  private readonly maxAttempts: number;
  private readonly maxRetryDelayMs: number;
  private readonly sendChatTemplateKwargs: boolean;

  constructor(config: OpenAiCompatConfig, options: { defaultHeaders?: Record<string, string> } = {}) {
    this.requestDelayMs = config.requestDelayMs ?? 750;
    this.maxAttempts = config.maxAttempts ?? 8;
    this.maxRetryDelayMs = config.maxRetryDelayMs ?? 60000;
    this.sendChatTemplateKwargs = config.sendChatTemplateKwargs ?? true;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      maxRetries: 0,
      timeout: config.timeoutMs ?? 120000,
      defaultHeaders: options.defaultHeaders
    });
  }

  private async runSerializedRequest<T>(operation: () => Promise<T>): Promise<T> {
    const previousRequest = OpenAiCompatClient.requestQueue;
    let releaseCurrentRequest: () => void = () => undefined;
    OpenAiCompatClient.requestQueue = new Promise<void>((resolve) => {
      releaseCurrentRequest = resolve;
    });

    await previousRequest;
    try {
      if (this.requestDelayMs > 0) {
        const elapsedMs = Date.now() - OpenAiCompatClient.lastRequestAt;
        const waitMs = Math.max(0, this.requestDelayMs - elapsedMs);
        if (waitMs > 0) {
          await sleep(waitMs);
        }
      }
      OpenAiCompatClient.lastRequestAt = Date.now();
      return await operation();
    } finally {
      releaseCurrentRequest();
    }
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    let lastError: unknown;

    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      try {
        const requestBody: Record<string, unknown> = {
          model: request.model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          response_format: request.responseFormat ? { type: request.responseFormat } : undefined,
          stream: false
        };

        if (this.sendChatTemplateKwargs) {
          requestBody.chat_template_kwargs = { enable_thinking: false, ...(request.chatTemplateKwargs ?? {}) };
        }

        const response = (await this.runSerializedRequest(() =>
          this.client.chat.completions.create(requestBody as unknown as Parameters<typeof this.client.chat.completions.create>[0])
        )) as ChatCompletion;

        const message = response.choices[0]?.message;
        const content = extractMessageText(message);
        if (content === undefined) {
          const keys = message ? Object.keys(message).sort().join(',') : 'none';
          throw new Error(`LLM response did not include text content; message keys: ${keys}`);
        }

        return {
          content,
          model: response.model,
          usage: {
            promptTokens: response.usage?.prompt_tokens,
            completionTokens: response.usage?.completion_tokens,
            totalTokens: response.usage?.total_tokens
          }
        };
      } catch (error) {
        lastError = error;
        const status = getStatus(error);
        const retryable = status === undefined || RETRYABLE_STATUSES.has(status);
        if (!retryable || attempt === this.maxAttempts - 1) {
          break;
        }

        const retryAfterMs = getRetryAfterMs(error);
        const baseDelayMs = status === 429 ? 5000 : 500;
        const jitter = Math.floor(Math.random() * 500);
        const waitMs = retryAfterMs ?? Math.min(this.maxRetryDelayMs, baseDelayMs * 2 ** attempt + jitter);
        await sleep(waitMs);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
