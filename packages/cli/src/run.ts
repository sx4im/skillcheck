import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { NvidiaNimClient } from './adapters/nvidia-nim.js';
import type { JsonCache } from './cache.js';
import type { NvidiaConfig } from './env.js';
import { hashJson } from './hash.js';
import type { GeneratedTask, NormalizedSkill, TrialOutput } from './types.js';

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
  config: NvidiaConfig,
  client: NvidiaNimClient,
  cache: JsonCache
): Promise<TrialOutput> {
  const messages = messagesForArm(skill, task, arm === 'with_skill');
  const response = await cache.getOrSet('runner', { model: config.runnerModel, temperature: 0.7, maxTokens: 1200, messages }, () =>
    client.complete({
      model: config.runnerModel,
      messages,
      temperature: 0.7,
      maxTokens: 1200
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

export async function runTrials(
  skill: NormalizedSkill,
  tasks: GeneratedTask[],
  trials: number,
  config: NvidiaConfig,
  client: NvidiaNimClient,
  cache: JsonCache
): Promise<TrialOutput[]> {
  const outputs: TrialOutput[] = [];
  const debug = process.env.SKILLCHECK_DEBUG === '1';
  for (const task of tasks) {
    for (let trial = 1; trial <= trials; trial += 1) {
      if (debug) {
        console.error(`[skillcheck] run ${task.id} trial ${trial}/${trials} with_skill`);
      }
      outputs.push(await runOne(skill, task, trial, 'with_skill', config, client, cache));
      if (debug) {
        console.error(`[skillcheck] run ${task.id} trial ${trial}/${trials} no_skill`);
      }
      outputs.push(await runOne(skill, task, trial, 'no_skill', config, client, cache));
    }
  }
  return outputs;
}
