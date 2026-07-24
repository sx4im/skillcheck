import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { NvidiaNimClient } from './adapters/nvidia-nim.js';
import { JsonCache } from './cache.js';
import { loadNvidiaConfig } from './env.js';
import { parseTaskSuite } from './eval.js';
import { gradeOutputs } from './grade.js';
import { normalizeSkill } from './normalize.js';
import { runTrials } from './run.js';
import { scorePairedObservations, pairedObservations } from './score.js';

export interface VerifyOptions {
  resultPath: string;
  sample: number;
}

export async function verifyResult(options: VerifyOptions): Promise<unknown> {
  const published = JSON.parse(await readFile(options.resultPath, 'utf8')) as {
    skill?: { source?: string };
    config?: { trials?: number };
    result?: { ci_pp?: [number, number]; effect_pp?: number };
    reproducibility?: { task_suite_path?: string };
  };
  const source = published.skill?.source;
  const taskSuitePath = published.reproducibility?.task_suite_path;
  const trials = published.config?.trials;
  const ci = published.result?.ci_pp;
  if (!source || !taskSuitePath || typeof trials !== 'number' || !Array.isArray(ci)) {
    throw new Error(
      'This result file cannot be verified: it is missing skill.source, config.trials, result.ci_pp, or reproducibility.task_suite_path. Produce a verifiable result with `skillcheck eval <path> --output result.json` (or `check --output`).'
    );
  }
  const config = loadNvidiaConfig();
  const client = new NvidiaNimClient(config, { defaultHeaders: { 'x-skillcheck-run': randomUUID() } });
  // Verification must be an independent re-measurement, so it bypasses the cache.
  // Reusing the shared on-disk cache would replay the original run's outputs and
  // make `verify` trivially pass on the machine that produced the result.
  const cache = JsonCache.disabled();
  let skill;
  try {
    skill = await normalizeSkill(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `Cannot read the skill at "${source}". Verification re-runs the skill, so it must run where that path exists (for corpus results, the original checkout).`
      );
    }
    throw error;
  }
  const tasks = parseTaskSuite(await readFile(taskSuitePath, 'utf8')).slice(0, options.sample);
  if (tasks.length === 0) {
    throw new Error(`The task suite at ${taskSuitePath} is empty — nothing to verify.`);
  }
  const outputs = await runTrials(skill, tasks, trials, config, client, cache);
  const graded = await gradeOutputs(tasks, outputs, config, client, cache);
  const score = scorePairedObservations(pairedObservations(graded));
  const [lower, upper] = ci;
  const passed = score.effectPp >= lower && score.effectPp <= upper;

  return {
    passed,
    sample: tasks.length,
    published_effect_pp: published.result?.effect_pp,
    published_ci_pp: ci,
    verify_effect_pp: score.effectPp,
    verify_ci_pp: score.ciPp,
    verify_verdict: score.verdict
  };
}
