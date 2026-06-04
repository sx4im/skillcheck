import { readFile } from 'node:fs/promises';
import { NvidiaNimClient } from './adapters/nvidia-nim.js';
import { JsonCache } from './cache.js';
import { loadNvidiaConfig } from './env.js';
import { gradeOutputs } from './grade.js';
import { normalizeSkill } from './normalize.js';
import { runTrials } from './run.js';
import { scorePairedObservations, type PairedObservation } from './score.js';
import type { GeneratedTask, GradedOutput } from './types.js';

export interface VerifyOptions {
  resultPath: string;
  sample: number;
}

function parseTasks(text: string): GeneratedTask[] {
  const value = JSON.parse(text) as unknown;
  const tasks = Array.isArray(value) ? value : (value as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) {
    throw new Error('Task suite must be an array or object with tasks');
  }
  return tasks.map((task, index) => {
    const item = task as Record<string, unknown>;
    const criterionType = item.criterionType ?? item.criterion_type ?? 'rubric';
    if (criterionType !== 'rubric' && criterionType !== 'deterministic') {
      throw new Error(`Unsupported criterion type in task ${index + 1}`);
    }
    return {
      id: String(item.id ?? `t${String(index + 1).padStart(3, '0')}`),
      prompt: String(item.prompt ?? ''),
      criterionType,
      criterion: String(item.criterion ?? '')
    };
  });
}

function pairedObservations(graded: GradedOutput[]): PairedObservation[] {
  const byPair = new Map<string, Partial<PairedObservation>>();
  for (const item of graded) {
    const key = `${item.taskId}:${item.trial}`;
    const current = byPair.get(key) ?? {};
    if (item.arm === 'with_skill') {
      current.withSkillPass = item.pass;
    } else {
      current.noSkillPass = item.pass;
    }
    byPair.set(key, current);
  }
  return [...byPair.values()].map((item) => {
    if (typeof item.withSkillPass !== 'boolean' || typeof item.noSkillPass !== 'boolean') {
      throw new Error('Incomplete A/B pair while verifying');
    }
    return item as PairedObservation;
  });
}

export async function verifyResult(options: VerifyOptions): Promise<unknown> {
  const published = JSON.parse(await readFile(options.resultPath, 'utf8')) as {
    skill: { source: string };
    config: { trials: number };
    result: { ci_pp: [number, number]; effect_pp: number };
    reproducibility: { task_suite_path: string };
  };
  const config = loadNvidiaConfig();
  const client = new NvidiaNimClient(config);
  const cache = new JsonCache();
  const skill = await normalizeSkill(published.skill.source);
  const tasks = parseTasks(await readFile(published.reproducibility.task_suite_path, 'utf8')).slice(0, options.sample);
  const outputs = await runTrials(skill, tasks, published.config.trials, config, client, cache);
  const graded = await gradeOutputs(tasks, outputs, config, client, cache);
  const score = scorePairedObservations(pairedObservations(graded));
  const [lower, upper] = published.result.ci_pp;
  const passed = score.effectPp >= lower && score.effectPp <= upper;

  return {
    passed,
    sample: tasks.length,
    published_effect_pp: published.result.effect_pp,
    published_ci_pp: published.result.ci_pp,
    verify_effect_pp: score.effectPp,
    verify_ci_pp: score.ciPp,
    verify_verdict: score.verdict
  };
}
