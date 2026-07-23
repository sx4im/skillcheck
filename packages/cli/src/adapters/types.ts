import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export type ProviderType = 'cloud' | 'nvidia' | 'openai' | 'anthropic' | 'gemini' | 'groq' | 'mistral' | 'openrouter';

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

export interface LlmClient {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}

export interface ModelInfo {
  id: string;
  name?: string;
}

export interface ProviderConfig {
  provider: ProviderType;
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  requestDelayMs?: number;
  maxAttempts?: number;
  maxRetryDelayMs?: number;
  generatorModel: string;
  graderModel: string;
  runnerModel: string;
}
