export interface LocalLlmServer {
  name: 'ollama' | 'lmstudio' | 'vllm';
  baseUrl: string;
  models: string[];
  suggestedModel?: string;
}

interface ProbeTarget {
  name: 'ollama' | 'lmstudio' | 'vllm';
  baseUrl: string;
  modelsPath: string;
}

const LOCAL_TARGETS: ProbeTarget[] = [
  { name: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', modelsPath: 'http://127.0.0.1:11434/v1/models' },
  { name: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', modelsPath: 'http://127.0.0.1:1234/v1/models' },
  { name: 'vllm', baseUrl: 'http://127.0.0.1:8000/v1', modelsPath: 'http://127.0.0.1:8000/v1/models' }
];

const PREFERRED_MODEL_PATTERNS = [
  /qwen.*coder/i,
  /deepseek.*coder/i,
  /deepseek-r1/i,
  /starcoder/i,
  /code/i,
  /llama.*3\.[1-3]/i,
  /mistral/i,
  /phi/i
];

/**
 * Heuristically select the best available model for code generation and grading,
 * prioritizing dedicated coding models and excluding pure embedding models.
 */
export function pickSuggestedModel(models: string[]): string | undefined {
  if (models.length === 0) return undefined;

  const chatModels = models.filter((m) => !/embed|bge|rerank/i.test(m));
  const candidatePool = chatModels.length > 0 ? chatModels : models;

  for (const pattern of PREFERRED_MODEL_PATTERNS) {
    const match = candidatePool.find((m) => pattern.test(m));
    if (match) return match;
  }

  return candidatePool[0];
}

/**
 * Concurrently probe standard localhost ports with a strict micro-timeout
 * (default 100ms) to detect active local LLM inference engines with zero latency overhead.
 */
export async function probeLocalLlm(timeoutMs = 100): Promise<LocalLlmServer | null> {
  const probeOne = async (target: ProbeTarget): Promise<LocalLlmServer | null> => {
    try {
      const response = await fetch(target.modelsPath, {
        method: 'GET',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!response.ok) return null;

      const data = (await response.json()) as { data?: { id?: string }[]; models?: { name?: string }[] };
      let modelIds: string[] = [];

      if (Array.isArray(data.data)) {
        modelIds = data.data.map((m) => m.id ?? '').filter(Boolean);
      } else if (Array.isArray(data.models)) {
        modelIds = data.models.map((m) => m.name ?? '').filter(Boolean);
      }

      if (modelIds.length === 0) return null;

      return {
        name: target.name,
        baseUrl: target.baseUrl,
        models: modelIds,
        suggestedModel: pickSuggestedModel(modelIds)
      };
    } catch {
      return null;
    }
  };

  const results = await Promise.all(LOCAL_TARGETS.map(probeOne));
  return results.find((r) => r !== null) ?? null;
}
