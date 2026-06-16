import { randomUUID } from 'node:crypto';
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
import type { GeneratedTask, GradedOutput, ProgressReporter, TaskBreakdown } from './types.js';

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
  sourceLabel?: string;
  saveArtifacts?: boolean;
  // Attach a per-task breakdown (with/without pass rates, the change, and an
  // example model output per arm) to the result. No extra model calls — it reuses
  // the outputs the run already produced.
  explain?: boolean;
  onProgress?: ProgressReporter;
  // Reuse a local disk cache of model calls across runs. Off by default so every
  // `skillcheck check` runs fresh and writes nothing to disk; batch flows (corpus)
  // opt in for resumability.
  useCache?: boolean;
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

interface ExplainExample {
  output: string;
  pass: boolean;
}

interface ExplainTask {
  id: string;
  prompt: string;
  criterion: string;
  with_skill_pass_rate: number;
  no_skill_pass_rate: number;
  delta_pp: number;
  label: 'helped' | 'hurt' | 'no change';
  example_with: ExplainExample | null;
  example_without: ExplainExample | null;
}

// Collapse whitespace and cap a raw model output to a readable snippet.
function snippet(text: string, max = 240): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

function buildExplain(tasks: GeneratedTask[], graded: GradedOutput[]): { tasks: ExplainTask[] } {
  const example = (list: GradedOutput[], preferPass?: boolean): ExplainExample | null => {
    const pick = (preferPass === undefined ? undefined : list.find((item) => item.pass === preferPass)) ?? list[0];
    return pick ? { output: snippet(pick.output), pass: pick.pass } : null;
  };

  return {
    tasks: tasks.map((task) => {
      const taskGrades = graded.filter((item) => item.taskId === task.id);
      const withSkill = taskGrades.filter((item) => item.arm === 'with_skill');
      const noSkill = taskGrades.filter((item) => item.arm === 'no_skill');
      const withRate = withSkill.length ? withSkill.filter((item) => item.pass).length / withSkill.length : 0;
      const noRate = noSkill.length ? noSkill.filter((item) => item.pass).length / noSkill.length : 0;
      const delta = Number(((withRate - noRate) * 100).toFixed(1));
      return {
        id: task.id,
        prompt: task.prompt,
        criterion: task.criterion,
        with_skill_pass_rate: Number(withRate.toFixed(4)),
        no_skill_pass_rate: Number(noRate.toFixed(4)),
        delta_pp: delta,
        label: delta > 0 ? 'helped' : delta < 0 ? 'hurt' : 'no change',
        // Show the sharpest contrast: when the skill helped here, surface a
        // passing with-skill output against a failing without-skill one.
        example_with: example(withSkill, delta > 0 ? true : undefined),
        example_without: example(noSkill, delta > 0 ? false : undefined)
      };
    })
  };
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
  const skill = await normalizeSkill(options.inputPath);
  const baseConfig = loadNvidiaConfig();
  const config = applyModelOverrides(baseConfig, options);
  // One run id per evalSkill call. The hosted proxy meters by distinct run id, so
  // every model call in this run shares it and the whole check counts as one run.
  const runId = randomUUID();
  const client = new NvidiaNimClient(config, { defaultHeaders: { 'x-skillcheck-run': runId } });
  // Fresh by default: a disabled cache neither reads nor writes, so repeating the
  // same skill at the same effort always re-runs from scratch and leaves no files.
  const cache = options.useCache ? new JsonCache() : JsonCache.disabled();

  const onProgress = options.onProgress;
  onProgress?.({ phase: 'generating' });
  const tasks = options.taskSuite
    ? parseTaskSuite(await readFile(options.taskSuite, 'utf8')).slice(0, options.tasks)
    : await generateTasks({ domain: skill.domain, count: options.tasks }, config, client, cache);
  if (tasks.length === 0) {
    throw new Error('No evaluation tasks available — the task suite is empty.');
  }
  const taskSuiteHash = hashJson({ skill: skill.versionHash, tasks });
  const shouldSaveArtifacts = options.saveArtifacts ?? true;
  const taskSuitePath = options.taskSuite ?? (shouldSaveArtifacts ? `results/tasks/${taskSuiteHash}.json` : undefined);
  if (!options.taskSuite && taskSuitePath) {
    await writeJson(taskSuitePath, tasks);
  }

  const outputs = await runTrials(skill, tasks, options.trials, config, client, cache, onProgress);
  const graded = await gradeOutputs(tasks, outputs, config, client, cache, onProgress);
  onProgress?.({ phase: 'scoring' });
  const score = scorePairedObservations(pairedObservations(graded));
  const breakdowns = taskBreakdowns(tasks, graded);
  const withSkillTokens = graded.filter((item) => item.arm === 'with_skill').map((item) => item.promptTokens);
  const noSkillTokens = graded.filter((item) => item.arm === 'no_skill').map((item) => item.promptTokens);
  const tokenOverhead = Math.max(0, Math.round(mean(withSkillTokens) - mean(noSkillTokens)));
  const valuePer1kTokens = tokenOverhead === 0 ? 0 : Number((score.effectPp / (tokenOverhead / 1000)).toFixed(2));
  // 0–100 quality score: 50 = no effect. Built from the bootstrap mean effect so
  // it varies smoothly rather than snapping to coarse multiples of the sample step.
  const satisfaction = Math.max(0, Math.min(100, Number((50 + score.meanEffectPp).toFixed(1))));
  const runDate = new Date().toISOString().slice(0, 10);

  const result = {
    skill: {
      name: skill.name,
      source: options.sourceLabel ?? skill.sourcePath,
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
      // Actual task count — the generator may deliver fewer than requested.
      tasks: tasks.length,
      temperature: 0.7,
      mode: 'forced-injection'
    },
    result: {
      effect_pp: score.effectPp,
      mean_effect_pp: score.meanEffectPp,
      satisfaction,
      ci_pp: score.ciPp,
      verdict: score.verdict,
      with_skill_pass: score.withSkillPass,
      no_skill_pass: score.noSkillPass,
      token_overhead: tokenOverhead,
      value_per_1k_tokens: valuePer1kTokens
    },
    tasks: breakdowns,
    ...(options.explain ? { explain: buildExplain(tasks, graded) } : {}),
    reproducibility: {
      ...(taskSuitePath ? { task_suite_path: taskSuitePath } : {}),
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
