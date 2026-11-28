const providerTypes = ['cloud', 'nvidia', 'openai', 'anthropic', 'gemini', 'groq', 'mistral', 'openrouter'] as const;
export type ProviderType = typeof providerTypes[number];

export function isProviderType(value: unknown): value is ProviderType {
  return providerTypes.some((provider) => provider === value);
}

export interface CompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'developer';
  content: string | Array<{ type: 'text'; text: string }>;
}

export interface CompletionRequest {
  model: string;
  messages: CompletionMessage[];
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

export interface ModelAdapter {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}

/** Compatibility name used by existing evaluation clients. */
export type LlmClient = ModelAdapter;

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
