import type { NvidiaNimClient } from './adapters/nvidia-nim.js';
import type { JsonCache } from './cache.js';
import type { NvidiaConfig } from './env.js';
import { hashJson } from './hash.js';
import type { GeneratedTask, GradedOutput, TrialOutput } from './types.js';

interface GradePayload {
  score: number;
  reason: string;
}

function parseGrade(text: string): GradePayload {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    const score = Number(parsed.score);
    if (!Number.isFinite(score)) {
      throw new Error('Grader JSON missing numeric score');
    }
    return {
      score: Math.max(0, Math.min(1, score)),
      reason: String(parsed.reason ?? '')
    };
  }

  const lower = trimmed.toLowerCase();
  const score = /\b(score|grade)\s*[:=]\s*1\b/.test(lower) || /\b(pass|passes|meets)\b/.test(lower) ? 1 : 0;
  return {
    score: Math.max(0, Math.min(1, score)),
    reason: `non-json grader response: ${trimmed.slice(0, 160)}`
  };
}

function seededShuffle<T>(items: T[], seedText: string): T[] {
  let state = parseInt(hashJson(seedText).slice(0, 8), 16) >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex]!, copy[index]!];
  }
  return copy;
}

export async function gradeOutputs(
  tasks: GeneratedTask[],
  outputs: TrialOutput[],
  config: NvidiaConfig,
  client: NvidiaNimClient,
  cache: JsonCache
): Promise<GradedOutput[]> {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const shuffled = seededShuffle(outputs, hashJson(outputs.map((output) => output.transcriptHash)));
  const graded = new Map<string, GradedOutput>();

  for (const output of shuffled) {
    const task = taskById.get(output.taskId);
    if (!task) {
      throw new Error(`Missing task for output ${output.taskId}`);
    }
    console.error(`[eval] grade ${output.taskId} trial ${output.trial}`);
    const response = await cache.getOrSet(
      'grader',
      { model: config.graderModel, criterion: task.criterion, output: output.output, promptVersion: 5, responseFormat: 'json_object' },
      () =>
        client.complete({
          model: config.graderModel,
          temperature: 0,
          maxTokens: 120,
          responseFormat: 'json_object',
          chatTemplateKwargs: { thinking: false },
          messages: [
            {
              role: 'system',
              content:
                'You are a blind evaluator. Grade only the provided output against the success criterion. You do not know which experimental arm produced it. Do not explain your reasoning. Return only JSON.'
            },
            {
              role: 'user',
              content: `Success criterion:\n${task.criterion}\n\nOutput to grade:\n${output.output}\n\nReturn exactly one JSON object with this shape: {"score":0,"reason":"brief reason"}. Use score 1 only if the output satisfies the criterion; otherwise use 0.`
            }
          ]
        })
    );
    const grade = parseGrade(response.content);
    graded.set(output.transcriptHash, {
      ...output,
      score: grade.score,
      reason: grade.reason,
      pass: grade.score >= 0.5
    });
  }

  return outputs.map((output) => {
    const item = graded.get(output.transcriptHash);
    if (!item) {
      throw new Error(`Missing grade for ${output.transcriptHash}`);
    }
    return item;
  });
}
