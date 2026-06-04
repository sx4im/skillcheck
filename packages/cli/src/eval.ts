import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NvidiaNimClient } from './adapters/nvidia-nim.js';
import { JsonCache } from './cache.js';
import { loadNvidiaConfig, type NvidiaConfig } from './env.js';
import { generateTasks } from './generate.js';
import { hashJson } from './hash.js';
import { gradeOutputs } from './grade.js';
import { normalizeSkill } from './normalize.js';
import { runTrials } from './run.js';
import { scorePairedObservations, type PairedObservation } from './score.js';
import type { GeneratedTask, GradedOutput, TaskBreakdown } from './types.js';

export interface EvalOptions {
  inputPath: string;
  output?: string;
  tasks: number;
  trials: number;
  mode: 'forced';
  runner?: string;
  grader?: string;
  generator?: string;
  taskSuite?: string;
}

function applyModelOverrides(config: NvidiaConfig, options: EvalOptions): NvidiaConfig {
  return {
    ...config,
    runnerModel: options.runner ?? config.runnerModel,
    graderModel: options.grader ?? config.graderModel,
    generatorModel: options.generator ?? config.generatorModel
  };
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
      throw new Error('Incomplete A/B pair while scoring');
    }
    return item as PairedObservation;
  });
}

function taskBreakdowns(tasks: GeneratedTask[], graded: GradedOutput[]): TaskBreakdown[] {
  return tasks.map((task) => {
    const taskGrades = graded.filter((item) => item.taskId === task.id);
    const withSkill = taskGrades.filter((item) => item.arm === 'with_skill');
    const noSkill = taskGrades.filter((item) => item.arm === 'no_skill');
    return {
      id: task.id,
      prompt: task.prompt,
      criterion_type: task.criterionType,
      criterion: task.criterion,
      arm_a_pass_rate: withSkill.filter((item) => item.pass).length / withSkill.length,
      arm_b_pass_rate: noSkill.filter((item) => item.pass).length / noSkill.length
    };
  });
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseTaskSuite(text: string): GeneratedTask[] {
  const value = JSON.parse(text) as unknown;
  const tasks = Array.isArray(value)
    ? value
    : typeof value === 'object' && value !== null && Array.isArray((value as { tasks?: unknown }).tasks)
      ? (value as { tasks: unknown[] }).tasks
      : undefined;
  if (!tasks) {
    throw new Error('Task suite must be an array or an object with a tasks array');
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

export async function evalSkill(options: EvalOptions): Promise<unknown> {
  const baseConfig = loadNvidiaConfig();
  const config = applyModelOverrides(baseConfig, options);
  const client = new NvidiaNimClient(config);
  const cache = new JsonCache();
  const skill = await normalizeSkill(options.inputPath);

  const tasks = options.taskSuite
    ? parseTaskSuite(await readFile(options.taskSuite, 'utf8')).slice(0, options.tasks)
    : await generateTasks({ domain: skill.domain, count: options.tasks }, config, client, cache);
  const taskSuiteHash = hashJson({ skill: skill.versionHash, tasks });
  const taskSuitePath = options.taskSuite ?? `results/tasks/${taskSuiteHash}.json`;
  await writeJson(taskSuitePath, tasks);

  const outputs = await runTrials(skill, tasks, options.trials, config, client, cache);
  const graded = await gradeOutputs(tasks, outputs, config, client, cache);
  const score = scorePairedObservations(pairedObservations(graded));
  const breakdowns = taskBreakdowns(tasks, graded);
  const withSkillTokens = graded.filter((item) => item.arm === 'with_skill').map((item) => item.promptTokens);
  const noSkillTokens = graded.filter((item) => item.arm === 'no_skill').map((item) => item.promptTokens);
  const tokenOverhead = Math.max(0, Math.round(mean(withSkillTokens) - mean(noSkillTokens)));
  const valuePer1kTokens = tokenOverhead === 0 ? 0 : Number((score.effectPp / (tokenOverhead / 1000)).toFixed(2));
  const runDate = new Date().toISOString().slice(0, 10);

  const result = {
    skill: {
      name: skill.name,
      source: skill.sourcePath,
      format: skill.format,
      commit_hash: skill.versionHash,
      domain: skill.domain
    },
    config: {
      runner_model: config.runnerModel,
      runner_version: config.runnerModel,
      grader_model: config.graderModel,
      grader_version: config.graderModel,
      generator_model: config.generatorModel,
      trials: options.trials,
      tasks: options.tasks,
      temperature: 0.7,
      mode: 'forced-injection'
    },
    result: {
      effect_pp: score.effectPp,
      ci_pp: score.ciPp,
      verdict: score.verdict,
      with_skill_pass: score.withSkillPass,
      no_skill_pass: score.noSkillPass,
      token_overhead: tokenOverhead,
      value_per_1k_tokens: valuePer1kTokens
    },
    tasks: breakdowns,
    reproducibility: {
      task_suite_path: taskSuitePath,
      transcript_hashes: graded.map((item) => item.transcriptHash)
    },
    history: [
      {
        runner_version: config.runnerModel,
        run_date: runDate,
        effect_pp: score.effectPp,
        verdict: score.verdict
      }
    ],
    run_date: runDate
  };

  if (options.output) {
    await writeJson(options.output, result);
  }
  return result;
}
