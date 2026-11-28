import { randomUUID } from 'node:crypto';
import { createLlmClient } from './providers/providers.js';
import { evaluateSkill, selectSuiteTasks as selectTasks, type EvalOptions, type EvalResult } from './core/pipeline/eval.js';
import { sanitizeTerminal } from './core/security/output.js';
import { loadProviderConfig } from './env.js';
import { normalizeSkill } from './normalize.js';
import { findWorkspaceRoot } from './discovery.js';
import type { GeneratedTask } from './types.js';

export { LOW_SAMPLE_TASK_THRESHOLD, parseTaskSuite, type EvalOptions, type EvalResult, type ExplainTask } from './core/pipeline/eval.js';

function warn(message: string): void {
  console.error(sanitizeTerminal(message));
}

export function selectSuiteTasks(suite: GeneratedTask[], options: { tasks: number; tasksExplicit?: boolean }): GeneratedTask[] {
  return selectTasks(suite, { ...options, onWarning: warn });
}

export async function evalSkill(options: EvalOptions): Promise<EvalResult> {
  const skill = await normalizeSkill(options.inputPath, {
    domain: options.domain,
    workspaceRoot: options.workspaceRoot ?? findWorkspaceRoot(),
    maxBytes: options.maxBytes,
    allowExternalSymlinks: options.allowExternalSymlinks
  });
  const base = loadProviderConfig();
  const config = {
    ...base,
    runnerModel: options.runner ?? base.runnerModel,
    graderModel: options.grader ?? base.graderModel,
    generatorModel: options.generator ?? base.generatorModel
  };
  const client = createLlmClient(config, { defaultHeaders: { 'x-skillcheck-run': randomUUID() } });
  return evaluateSkill({ onWarning: warn, ...options }, skill, config, client);
}
