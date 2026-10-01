import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createLlmClient } from './adapters/providers.js';
import type { ProviderConfig } from './adapters/types.js';
import { JsonCache } from './cache.js';
import { loadProviderConfig } from './env.js';
import { generateTasks, tasksArrayFrom } from './generate.js';
import { hashJson, writeJson } from './hash.js';
import { gradeOutputs } from './grade.js';
import { normalizeSkill } from './normalize.js';
import { runTrials } from './run.js';
import { scorePairedObservations, pairedObservations, satisfactionFromEffect } from './score.js';
import { checkpointPath, clearCheckpoint, loadCheckpoint, saveCheckpoint } from './checkpoint.js';
import type { GeneratedTask, GradedOutput, ProgressReporter, SkillFormat, TaskBreakdown, TaskDifficulty, TrialOutput } from './types.js';

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
  explain?: boolean;
  onProgress?: ProgressReporter;
  useCache?: boolean;
  concurrency?: number;
  resume?: boolean;
  /** True when --tasks was passed explicitly (vs. the command default). */
  tasksExplicit?: boolean;
  /** Task-generation difficulty; the generator prompt defaults to 'standard'. */
  difficulty?: TaskDifficulty;
}

function applyModelOverrides(config: ProviderConfig, options: EvalOptions): ProviderConfig {
  return {
    ...config,
    runnerModel: options.runner ?? config.runnerModel,
    graderModel: options.grader ?? config.graderModel,
    generatorModel: options.generator ?? config.generatorModel
  };
}



// Pass rate of one arm's graded outputs. Shared by the per-task breakdown and
// the explain view so both compute it identically (empty arm = 0, never NaN).
function armPassRate(items: GradedOutput[]): number {
  return items.length ? items.filter((item) => item.pass).length / items.length : 0;
}

function taskBreakdowns(tasks: GeneratedTask[], graded: GradedOutput[]): TaskBreakdown[] {
  return tasks.map((task) => {
    const taskGrades = graded.filter((item) => item.taskId === task.id);
    return {
      id: task.id,
      prompt: task.prompt,
      criterion_type: task.criterionType,
      criterion: task.criterion,
      with_skill_pass_rate: armPassRate(taskGrades.filter((item) => item.arm === 'with_skill')),
      no_skill_pass_rate: armPassRate(taskGrades.filter((item) => item.arm === 'no_skill'))
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

export interface ExplainTask {
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
      const withRate = armPassRate(withSkill);
      const noRate = armPassRate(noSkill);
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

// Fail fast on malformed deterministic regex criteria. Without this, an
// invalid `regex:`/`not_regex:` pattern in a hand-written task suite throws a
// bare SyntaxError from deep inside gradeOutputs — after every runner call has
// already been paid for — instead of a clear error naming the offending task
// before the run starts.
function validateDeterministicCriterion(id: string, criterion: string): void {
  for (const prefix of ['regex:', 'not_regex:']) {
    if (criterion.startsWith(prefix)) {
      const pattern = criterion.slice(prefix.length);
      try {
        new RegExp(pattern, 's');
      } catch (error) {
        throw new Error(
          `Invalid regex in deterministic criterion of task ${id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
}

export function parseTaskSuite(text: string): GeneratedTask[] {
  const value = JSON.parse(text) as unknown;
  const tasks = tasksArrayFrom(value);

  return tasks.map((task, index) => {
    const item = task as Record<string, unknown>;
    const criterionType = item.criterionType ?? item.criterion_type ?? 'rubric';
    if (criterionType !== 'rubric' && criterionType !== 'deterministic') {
      throw new Error(`Unsupported criterion type in task ${index + 1}`);
    }
    const id = String(item.id ?? `t${String(index + 1).padStart(3, '0')}`);
    const criterion = String(item.criterion ?? '');
    if (criterionType === 'deterministic') {
      validateDeterministicCriterion(id, criterion);
    }
    return {
      id,
      prompt: String(item.prompt ?? ''),
      criterionType,
      criterion
    };
  });
}

// The published result JSON shape. Typed so every consumer (matrix, the card,
// verify, the leaderboard) reads the same contract instead of re-guessing it.
export interface EvalResult {
  skill: {
    name: string;
    source: string;
    format: SkillFormat;
    commit_hash: string;
    domain: string;
    tool_dependent: boolean;
  };
  config: {
    runner_model: string;
    grader_model: string;
    generator_model: string;
    trials: number;
    // Actual task count — the generator may deliver fewer than requested.
    tasks: number;
    temperature: number;
    mode: 'forced';
  };
  result: {
    effect_pp: number;
    mean_effect_pp: number;
    satisfaction: number;
    ci_pp: [number, number];
    verdict: 'helps' | 'placebo' | 'harms';
    with_skill_pass: number;
    no_skill_pass: number;
    token_overhead: number;
    value_per_1k_tokens: number;
  };
  tasks: TaskBreakdown[];
  explain?: { tasks: ExplainTask[] };
  reproducibility: {
    task_suite_path?: string;
    transcript_hashes: string[];
  };
  history: Array<{
    runner_model: string;
    run_date: string;
    effect_pp: number;
    verdict: 'helps' | 'placebo' | 'harms';
  }>;
  run_date: string;
}

/**
 * Select tasks from an explicit --task-suite file. When the user hand-writes
 * a suite without passing --tasks, the whole suite is evaluated — silently
 * truncating to the command default would discard their work and widen the
 * confidence interval without explanation.
 */
export function selectSuiteTasks(suite: GeneratedTask[], options: { tasks: number; tasksExplicit?: boolean }): GeneratedTask[] {
  if (!options.tasksExplicit) {
    return suite;
  }
  if (suite.length > options.tasks) {
    console.error(
      `[skillcheck] warning: --task-suite has ${suite.length} tasks but --tasks=${options.tasks}; evaluating only the first ${options.tasks}.`
    );
  }
  return suite.slice(0, options.tasks);
}

export async function evalSkill(options: EvalOptions): Promise<EvalResult> {
  const skill = await normalizeSkill(options.inputPath);
  const baseConfig = loadProviderConfig();
  const config = applyModelOverrides(baseConfig, options);
  const runId = randomUUID();
  const client = createLlmClient(config, { defaultHeaders: { 'x-skillcheck-run': runId } });
  // Fresh by default: a disabled cache neither reads nor writes, so repeating the
  // same skill at the same effort always re-runs from scratch and leaves no files.
  const cache = options.useCache ? new JsonCache() : JsonCache.disabled();

  const onProgress = options.onProgress;
  onProgress?.({ phase: 'generating' });

  const cpFile = checkpointPath(skill.versionHash);
  const trialKey = (taskId: string, trial: number, arm: string) => `${taskId}:${trial}:${arm}`;

  // A checkpoint is reusable when the skill, trial count, and all models match
  // and its stored task hash is intact. A model change silently reusing stale
  // outputs would corrupt the comparison.
  const existingCp = options.resume ? await loadCheckpoint(cpFile) : null;
  const checkpointUsable =
    existingCp !== null &&
    existingCp.skillHash === skill.versionHash &&
    existingCp.trials === options.trials &&
    existingCp.difficulty === (options.difficulty ?? 'standard') &&
    existingCp.runnerModel === (config.runnerModel ?? '') &&
    existingCp.graderModel === (config.graderModel ?? '') &&
    existingCp.generatorModel === (config.generatorModel ?? '') &&
    existingCp.tasks.length > 0 &&
    existingCp.taskSuiteHash === hashJson({ skill: skill.versionHash, tasks: existingCp.tasks });

  let tasks: GeneratedTask[];
  let outputs: TrialOutput[] = [];
  if (existingCp && checkpointUsable) {
    if (options.taskSuite) {
      // Explicit suite: re-parse the file so edits are picked up. When the
      // parsed suite still matches the stored hash, its completed outputs are
      // reused; a changed file starts a fresh run instead.
      const suiteTasks = selectSuiteTasks(parseTaskSuite(await readFile(options.taskSuite, 'utf8')), options);
      if (existingCp.taskSuiteHash === hashJson({ skill: skill.versionHash, tasks: suiteTasks })) {
        tasks = suiteTasks;
        outputs = existingCp.completedOutputs;
      } else {
        tasks = suiteTasks;
      }
    } else {
      // Generated tasks: reuse the stored tasks verbatim. Asking the generator
      // for a fresh set would produce different tasks, the suite hash would
      // never match, and resume would silently restart (and re-bill) from zero.
      tasks = existingCp.tasks;
      outputs = existingCp.completedOutputs;
    }
  } else {
    tasks = options.taskSuite
      ? selectSuiteTasks(parseTaskSuite(await readFile(options.taskSuite, 'utf8')), options)
      : await generateTasks({ domain: skill.domain, count: options.tasks, difficulty: options.difficulty }, config, client, cache);
  }
  if (tasks.length === 0) {
    throw new Error('No evaluation tasks available — the task suite is empty.');
  }
  const taskSuiteHash = hashJson({ skill: skill.versionHash, tasks });
  const shouldSaveArtifacts = options.saveArtifacts ?? true;
  const taskSuitePath = options.taskSuite ?? (shouldSaveArtifacts ? `results/tasks/${taskSuiteHash}.json` : undefined);
  if (!options.taskSuite && taskSuitePath) {
    await writeJson(taskSuitePath, tasks);
  }

  const doneKeys = new Set(outputs.map((o) => trialKey(o.taskId, o.trial, o.arm)));

  // Flush atomically after every trial so a crash, SIGKILL, or rate-limit
  // mid-run loses nothing — the next --resume run picks up where this one
  // stopped instead of re-billing completed trials.
  const flushCheckpoint = (): Promise<void> =>
    saveCheckpoint(
      cpFile,
      {
        skillHash: skill.versionHash,
        taskSuiteHash,
        trials: options.trials,
        difficulty: options.difficulty ?? 'standard',
        runnerModel: config.runnerModel ?? '',
        graderModel: config.graderModel ?? '',
        generatorModel: config.generatorModel ?? '',
        tasks,
        completedOutputs: outputs,
        updatedAt: new Date().toISOString()
      }
    ).catch(() => {});

  await runTrials(skill, tasks, options.trials, config, client, cache, onProgress, options.concurrency, {
    skip: (job) => doneKeys.has(trialKey(job.task.id, job.trial, job.arm)),
    onTrialComplete: async (output) => {
      outputs.push(output);
      await flushCheckpoint();
    }
  });
  await flushCheckpoint();

  const graded = await gradeOutputs(tasks, outputs, config, client, cache, onProgress);
  await clearCheckpoint(cpFile).catch(() => {});
  onProgress?.({ phase: 'scoring' });
  const score = scorePairedObservations(pairedObservations(graded));
  const breakdowns = taskBreakdowns(tasks, graded);
  const withSkillTokens = graded.filter((item) => item.arm === 'with_skill').map((item) => item.promptTokens);
  const noSkillTokens = graded.filter((item) => item.arm === 'no_skill').map((item) => item.promptTokens);
  const tokenOverhead = Math.max(0, Math.round(mean(withSkillTokens) - mean(noSkillTokens)));
  const valuePer1kTokens = tokenOverhead === 0 ? 0 : Number((score.effectPp / (tokenOverhead / 1000)).toFixed(2));
  // 0–100 quality score: 50 = no effect. Built from the bootstrap mean effect so
  // it varies smoothly rather than snapping to coarse multiples of the sample step.
  const satisfaction = satisfactionFromEffect(score.meanEffectPp);
  const runDate = new Date().toISOString().slice(0, 10);

  const result: EvalResult = {
    skill: {
      name: skill.name,
      source: options.sourceLabel ?? skill.sourcePath,
      format: skill.format,
      commit_hash: skill.versionHash,
      domain: skill.domain,
      tool_dependent: skill.toolDependent
    },
    config: {
      runner_model: config.runnerModel,
      grader_model: config.graderModel,
      generator_model: config.generatorModel,
      trials: options.trials,
      tasks: tasks.length,
      temperature: 0.7,
      mode: 'forced'
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
        runner_model: config.runnerModel,
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
