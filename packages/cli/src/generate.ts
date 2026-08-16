import type { LlmClient } from './adapters/types.js';
import type { JsonCache } from './cache.js';
import { seededShuffle } from './hash.js';
import type { GeneratedTask } from './types.js';

export interface TaskGenerationInput {
  domain: string;
  count: number;
}

function extractJsonPayload(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return JSON.parse(trimmed);
  }

  const arrayStart = trimmed.indexOf('[');
  const arrayEnd = trimmed.lastIndexOf(']');
  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');
  const useObject = objectStart !== -1 && (arrayStart === -1 || objectStart < arrayStart);
  const start = useObject ? objectStart : arrayStart;
  const end = useObject ? objectEnd : arrayEnd;
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Generator did not return JSON: ${trimmed.slice(0, 200)}`);
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

// Accepts either a bare task array or a {"tasks": [...]} wrapper. Shared by the
// generator and the task-suite parser so both read the same shapes.
export function tasksArrayFrom(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'object' && value !== null && Array.isArray((value as { tasks?: unknown }).tasks)) {
    return (value as { tasks: unknown[] }).tasks;
  }
  throw new Error('Task payload must be an array or an object with a tasks array');
}

function validateTasks(value: unknown, count: number): GeneratedTask[] {
  const array = tasksArrayFrom(value);

  return array.slice(0, count).map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`Generated task ${index} is not an object`);
    }
    const task = item as Record<string, unknown>;
    const prompt = String(task.prompt ?? '').trim();
    const criterion = String(task.criterion ?? task.rubric ?? '').trim();
    if (!prompt || !criterion) {
      throw new Error(`Generated task ${index} is missing prompt or criterion`);
    }
    return {
      id: String(task.id ?? `t${String(index + 1).padStart(3, '0')}`),
      prompt,
      criterionType: 'rubric',
      criterion
    };
  });
}



export async function generateTasks(
  input: TaskGenerationInput,
  config: { generatorModel: string },
  client: LlmClient,
  cache: JsonCache
): Promise<GeneratedTask[]> {
  const generatedCount = input.count * 2;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await cache.getOrSet(
      'generator',
      { model: config.generatorModel, input, generatedCount, promptVersion: 7, attempt },
      () =>
        client.complete({
          model: config.generatorModel,
          temperature: 0.4,
          maxTokens: 8000,
          responseFormat: 'json_object',
          messages: [
            {
              role: 'system',
              content: 'Generate independent evaluation tasks. You only know the declared domain, never skill instructions. Return only valid compact JSON.'
            },
            {
              role: 'user',
              content: `Declared domain:\n${input.domain}\n\nGenerate ${generatedCount} concise tasks. Return exactly {"tasks":[{"id":"t1","prompt":"one concrete task under 80 words","criterion":"one pass/fail rubric under 60 words"}]}. Keep every criterion a single string, not an array. Do not include markdown or commentary.`
            }
          ]
        })
    );

    try {
      const generated = validateTasks(extractJsonPayload(response.content), generatedCount);
      const selected = seededShuffle(generated, `${input.domain}:${config.generatorModel}`).slice(0, input.count).map((task, index) => ({
        ...task,
        id: `t${String(index + 1).padStart(3, '0')}`
      }));
      // A short batch is retried like a parse failure (the attempt number busts
      // the cache key). On the last attempt a partial batch still beats failing
      // the whole run — callers report the actual count, not the requested one.
      if (selected.length >= input.count) {
        return selected;
      }
      lastError = new Error(`Generator produced only ${selected.length} of ${input.count} tasks`);
      if (attempt === 3 && selected.length > 0) {
        if (process.env.SKILLCHECK_DEBUG === '1') {
          console.error(`[skillcheck] continuing with ${selected.length}/${input.count} generated tasks`);
        }
        return selected;
      }
    } catch (error) {
      lastError = error;
      if (process.env.SKILLCHECK_DEBUG === '1') {
        console.error(`[skillcheck] generator returned invalid JSON on attempt ${attempt}/3`);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Generator did not return valid tasks after retries');
}
