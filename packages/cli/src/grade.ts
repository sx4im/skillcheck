import type { NvidiaNimClient } from './adapters/nvidia-nim.js';
import type { JsonCache } from './cache.js';
import type { NvidiaConfig } from './env.js';
import { gradeDeterministically } from './deterministic.js';
import { hashJson } from './hash.js';
import type { GeneratedTask, GradedOutput, TrialOutput } from './types.js';

interface GradePayload {
  score: number;
  reason: string;
}

function parseGrade(text: string): GradePayload {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    const end = trimmed.lastIndexOf('}');
    if (end === -1) {
      throw new Error('Grader JSON object was not closed');
    }
    const parsed = JSON.parse(trimmed.slice(0, end + 1)) as Record<string, unknown>;
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
  const debug = process.env.SKILLCHECK_DEBUG === '1';

  for (const output of shuffled) {
    const task = taskById.get(output.taskId);
    if (!task) {
      throw new Error(`Missing task for output ${output.taskId}`);
    }
    if (task.criterionType === 'deterministic') {
      const grade = gradeDeterministically(task, output.output);
      graded.set(output.transcriptHash, {
        ...output,
        ...grade
      });
      continue;
    }

    if (debug) {
      console.error(`[skillcheck] grade ${output.taskId} trial ${output.trial}`);
    }
    let grade: GradePayload | undefined;
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await cache.getOrSet(
        'grader',
        {
          model: config.graderModel,
          criterion: task.criterion,
          output: output.output,
          promptVersion: 7,
          responseFormat: 'json_object',
          attempt
        },
        () =>
          client.complete({
            model: config.graderModel,
            temperature: 0,
            // Reasoning models (e.g. minimax-m2.7) always emit ~500-600 reasoning
            // tokens before the answer; a tight budget leaves `content` empty. Give
            // the JSON verdict room to land after the reasoning.
            maxTokens: 1536,
            responseFormat: 'json_object',
            chatTemplateKwargs: { thinking: false },
            messages: [
              {
                role: 'system',
                content:
                  'You are a blind evaluator. Grade only the provided output against the success criterion. You do not know which experimental arm produced it. Do not explain your reasoning. Return only valid JSON.'
              },
              {
                role: 'user',
                content: `Success criterion:\n${task.criterion}\n\nOutput to grade:\n${output.output}\n\nReturn exactly one JSON object with this shape: {"score":0,"reason":"brief reason"}. Use score 1 only if the output satisfies the criterion; otherwise use 0. Do not include markdown or commentary.`
              }
            ]
          })
      );

      try {
        grade = parseGrade(response.content);
        break;
      } catch (error) {
        lastError = error;
        if (debug) {
          console.error(`[skillcheck] grader returned invalid JSON on attempt ${attempt}/3`);
        }
      }
    }
    if (!grade) {
      throw lastError instanceof Error ? lastError : new Error('Grader did not return a valid grade after retries');
    }
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
