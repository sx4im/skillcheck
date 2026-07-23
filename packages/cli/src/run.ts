import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { LlmClient } from './adapters/types.js';
import type { JsonCache } from './cache.js';
import { hashJson } from './hash.js';
import type { GeneratedTask, NormalizedSkill, ProgressReporter, TrialOutput } from './types.js';

function messagesForArm(skill: NormalizedSkill, task: GeneratedTask, withSkill: boolean): ChatCompletionMessageParam[] {
  if (!withSkill) {
    return [{ role: 'user', content: task.prompt }];
  }

  return [
    {
      role: 'system',
      content: `You are completing an evaluation task. Apply the following skill instructions when relevant.\n\n${skill.instructions}`
    },
    { role: 'user', content: task.prompt }
  ];
}

async function runOne(
  skill: NormalizedSkill,
  task: GeneratedTask,
  trial: number,
  arm: TrialOutput['arm'],
  config: { runnerModel: string },
  client: LlmClient,
  cache: JsonCache
): Promise<TrialOutput> {
  const messages = messagesForArm(skill, task, arm === 'with_skill');
  // `trial` MUST be part of the cache key. Without it, every trial for the same
  // (skill, task, arm) produces identical `messages` and therefore the same key,
  // so trials 2..K silently read trial 1's cached output. That collapses K
  // independent stochastic samples (temperature 0.7) into one replicated K times
  // and makes the paired-bootstrap CI ~sqrt(K) too narrow (pseudo-replication).
  // Reasoning is disabled (enable_thinking:false), so output is direct. 2048 is a
  // generous cap for a full answer; it is part of the cache key, so changing it
  // invalidates answers captured under the old budget.
  const response = await cache.getOrSet('runner', { model: config.runnerModel, temperature: 0.7, maxTokens: 2048, promptVersion: 1, trial, messages }, () =>
    client.complete({
      model: config.runnerModel,
      messages,
      temperature: 0.7,
      maxTokens: 2048
    })
  );
  const transcriptHash = `sha256:${hashJson({ taskId: task.id, trial, arm, messages, output: response.content })}`;

  return {
    taskId: task.id,
    trial,
    arm,
    output: response.content,
    model: response.model,
    promptTokens: response.usage?.promptTokens ?? 0,
    completionTokens: response.usage?.completionTokens ?? 0,
    totalTokens: response.usage?.totalTokens ?? 0,
    transcriptHash
  };
}

async function asyncPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function runTrials(
  skill: NormalizedSkill,
  tasks: GeneratedTask[],
  trials: number,
  config: { runnerModel: string },
  client: LlmClient,
  cache: JsonCache,
  onProgress?: ProgressReporter,
  concurrency = 4
): Promise<TrialOutput[]> {
  const debug = process.env.SKILLCHECK_DEBUG === '1';
  const total = tasks.length * trials * 2; // two arms (with/without skill) per trial
  let completed = 0;
  const tick = () => {
    completed += 1;
    onProgress?.({ phase: 'running', completed, total });
  };
  onProgress?.({ phase: 'running', completed, total });

  const jobs: Array<{ task: GeneratedTask; trial: number; arm: TrialOutput['arm'] }> = [];
  for (const task of tasks) {
    for (let trial = 1; trial <= trials; trial += 1) {
      jobs.push({ task, trial, arm: 'with_skill' });
      jobs.push({ task, trial, arm: 'no_skill' });
    }
  }

  return await asyncPool(jobs, Math.max(1, concurrency), async (job) => {
    if (debug) {
      console.error(`[skillcheck] run ${job.task.id} trial ${job.trial}/${trials} ${job.arm}`);
    }
    const res = await runOne(skill, job.task, job.trial, job.arm, config, client, cache);
    tick();
    return res;
  });
}
