import OpenAI from 'openai';
import type { ChatCompletion, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { NvidiaConfig } from '../env.js';

export interface CompletionRequest {
  model: string;
  messages: ChatCompletionMessageParam[];
  temperature: number;
  maxTokens: number;
  responseFormat?: 'json_object';
  chatTemplateKwargs?: Record<string, unknown>;
}

export interface CompletionResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 8;

function extractTextContent(content: unknown): string | undefined {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if (typeof part === 'object' && part !== null && 'text' in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        }
        return '';
      })
      .join('');
    return parts || undefined;
  }

  return undefined;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function describeRetry(error: unknown, attempt: number, waitMs: number): void {
  const status = getStatus(error);
  const label = status === undefined ? 'connection' : `status ${status}`;
  console.error(`[nim] retry ${attempt + 1}/${MAX_ATTEMPTS} after ${label}; waiting ${waitMs} ms`);
}

export class NvidiaNimClient {
  private static requestQueue: Promise<void> = Promise.resolve();
  private static lastRequestAt = 0;

  private readonly client: OpenAI;
  private readonly requestDelayMs: number;

  constructor(config: NvidiaConfig) {
    this.requestDelayMs = config.requestDelayMs;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      maxRetries: 0,
      timeout: config.timeoutMs
    });
  }

  private async runSerializedRequest<T>(operation: () => Promise<T>): Promise<T> {
    const previousRequest = NvidiaNimClient.requestQueue;
    let releaseCurrentRequest: () => void = () => undefined;
    NvidiaNimClient.requestQueue = new Promise<void>((resolve) => {
      releaseCurrentRequest = resolve;
    });

    await previousRequest;
    try {
      if (this.requestDelayMs > 0) {
        const elapsedMs = Date.now() - NvidiaNimClient.lastRequestAt;
        const waitMs = Math.max(0, this.requestDelayMs - elapsedMs);
        if (waitMs > 0) {
          await sleep(waitMs);
        }
      }
      NvidiaNimClient.lastRequestAt = Date.now();
      return await operation();
    } finally {
      releaseCurrentRequest();
    }
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        const extraBody = request.chatTemplateKwargs
          ? {
              chat_template_kwargs: request.chatTemplateKwargs
            }
          : undefined;
        const requestBody = {
          model: request.model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          response_format: request.responseFormat ? { type: request.responseFormat } : undefined,
          chat_template_kwargs: request.chatTemplateKwargs,
          extra_body: extraBody,
          stream: false
        };
        const response = (await this.runSerializedRequest(() =>
          this.client.chat.completions.create(requestBody)
        )) as ChatCompletion;

        const message = response.choices[0]?.message;
        const content = extractMessageText(message);
        if (content === undefined) {
          const keys = message ? Object.keys(message).sort().join(',') : 'none';
          throw new Error(`NVIDIA NIM response did not include text content; message keys: ${keys}`);
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
        if (!retryable || attempt === MAX_ATTEMPTS - 1) {
          break;
        }

        const retryAfterMs = getRetryAfterMs(error);
        const baseDelayMs = status === 429 ? 5000 : 500;
        const jitter = Math.floor(Math.random() * 500);
        const waitMs = retryAfterMs ?? baseDelayMs * 2 ** attempt + jitter;
        describeRetry(error, attempt, waitMs);
        await sleep(waitMs);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
