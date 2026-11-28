import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { ValidationError } from './errors.js';
import { findWorkspaceRoot } from './discovery.js';
import { isInside, readBoundedFile } from './core/normalize/files.js';
import { createLlmClient } from './providers/providers.js';
import { JsonCache } from './cache.js';
import { loadProviderConfig } from './env.js';
import { parseTaskSuite } from './eval.js';
import { gradeOutputs } from './grade.js';
import { normalizeSkill } from './normalize.js';
import { runTrials } from './run.js';
import { scorePairedObservations, pairedObservations } from './score.js';

export interface VerifyOptions {
  resultPath: string;
  sample: number;
}

export interface VerifyReport {
  passed: boolean;
  sample: number;
  published_effect_pp?: number;
  published_ci_pp: [number, number];
  verify_effect_pp: number;
  verify_ci_pp: [number, number];
  verify_verdict: 'helps' | 'placebo' | 'harms';
}

function section(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parsePublishedResult(text: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new ValidationError('Result file must contain valid JSON.', { cause });
  }
  const published = section(value);
  const source = section(published.skill).source;
  const taskSuitePath = section(published.reproducibility).task_suite_path;
  const trials = section(published.config).trials;
  const { ci_pp: ci, effect_pp: effect } = section(published.result);
  const percentagePoints = (item: unknown): item is number => typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 100;
  if (typeof source !== 'string' || !source.trim() || typeof taskSuitePath !== 'string' || !taskSuitePath.trim() ||
      typeof trials !== 'number' || !Number.isInteger(trials) || trials < 1 || trials > 10 ||
      !Array.isArray(ci) || ci.length !== 2 || !percentagePoints(ci[0]) || !percentagePoints(ci[1]) || ci[0] > ci[1] ||
      (effect !== undefined && !percentagePoints(effect))) {
    throw new ValidationError('This result file cannot be verified. Check skill.source, config.trials, result.ci_pp, and reproducibility.task_suite_path.');
  }
  return { source, taskSuitePath, trials, ci: [ci[0], ci[1]] as [number, number], effect };
}

async function resultPathWithin(file: string, roots: string[]): Promise<string> {
  const canonical = await realpath(file).catch((cause: unknown) => {
    throw new ValidationError('Cannot read the referenced skill or task suite at ' + file + '.', { cause });
  });
  if (!roots.some((root) => isInside(root, canonical))) {
    throw new ValidationError('Result references a file outside its directory and workspace.');
  }
  return canonical;
}

export async function verifyResult(options: VerifyOptions): Promise<VerifyReport> {
  const file = await realpath(options.resultPath).catch((cause: unknown) => {
    throw new ValidationError('Cannot read the result file.', { cause });
  });
  const { source, taskSuitePath, trials, ci, effect } = parsePublishedResult(await readBoundedFile(file));
  const roots = [path.dirname(file), await realpath(findWorkspaceRoot())];
  const skill = await normalizeSkill(await resultPathWithin(source, roots));
  const tasks = parseTaskSuite(await readBoundedFile(await resultPathWithin(taskSuitePath, roots))).slice(0, options.sample);
  if (tasks.length === 0) throw new ValidationError('The task suite is empty. Add a task before verifying.');
  // Verification re-runs through the user's active provider, like every other
  // model call.
  const config = loadProviderConfig();
  const client = createLlmClient(config, { defaultHeaders: { 'x-skillcheck-run': randomUUID() } });
  // Verification must be an independent re-measurement, so it bypasses the cache.
  // Reusing the shared on-disk cache would replay the original run's outputs and
  // make `verify` trivially pass on the machine that produced the result.
  const cache = JsonCache.disabled();
  const outputs = await runTrials(skill, tasks, trials, config, client, cache);
  const graded = await gradeOutputs(tasks, outputs, config, client, cache);
  const score = scorePairedObservations(pairedObservations(graded));
  const [lower, upper] = ci;
  const passed = score.effectPp >= lower && score.effectPp <= upper;

  return {
    passed,
    sample: tasks.length,
    published_effect_pp: effect,
    published_ci_pp: ci,
    verify_effect_pp: score.effectPp,
    verify_ci_pp: score.ciPp,
    verify_verdict: score.verdict
  };
}
