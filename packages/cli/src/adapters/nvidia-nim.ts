import { OpenAiCompatClient } from './openai-compat.js';
import type { CompletionRequest, CompletionResponse, LlmClient } from './types.js';
import type { NvidiaConfig } from '../env.js';

export class NvidiaNimClient implements LlmClient {
  private readonly inner: OpenAiCompatClient;

  constructor(config: NvidiaConfig, options: { defaultHeaders?: Record<string, string> } = {}) {
    this.inner = new OpenAiCompatClient(
      {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        timeoutMs: config.timeoutMs,
        requestDelayMs: config.requestDelayMs,
        maxAttempts: config.maxAttempts,
        maxRetryDelayMs: config.maxRetryDelayMs,
        sendChatTemplateKwargs: true
      },
      options
    );
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    return this.inner.complete(request);
  }
}
