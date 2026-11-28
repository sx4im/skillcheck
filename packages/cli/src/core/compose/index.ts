import type { LlmClient } from '../../providers/types.js';
import { ValidationError } from '../../errors.js';
import { JsonCache } from '../pipeline/cache.js';
import { generateTasks } from '../pipeline/generate.js';
import { gradeOutputs } from '../pipeline/grade.js';
import { hashJson } from '../pipeline/hash.js';
import { asyncPool, runOne } from '../pipeline/run.js';
import { pairedObservations, scorePairedObservations } from '../pipeline/score.js';
import type { GeneratedTask, NormalizedSkill, ProgressReporter, TrialOutput } from '../types.js';
import { analyzeComposition, stackInstructions, type ComposePreflight } from './preflight.js';

export { analyzeComposition, type ComposePreflight };

export interface ComposeOptions {
  target: NormalizedSkill;
  stack: NormalizedSkill[];
  tasks: number;
  trials: number;
  compareIsolated?: boolean;
  concurrency?: number;
  models: { generatorModel: string; runnerModel: string; graderModel: string };
  onProgress?: ProgressReporter;
}

const COMPOSE_VERDICTS = {
  helps: 'COMPATIBLE_HELPS',
  placebo: 'REDUNDANT_PLACEBO',
  harms: 'CONFLICTS_HARMS'
} as const;

export interface ComposeReport {
  target: string;
  stack: string[];
  tasks: number;
  trials: number;
  verdict: (typeof COMPOSE_VERDICTS)[keyof typeof COMPOSE_VERDICTS];
  effectPp: number;
  ciPp: [number, number];
  passRates: { baseline: number; treatment: number; isolated?: number };
  preflight: ComposePreflight;
  isolatedEffect?: { effectPp: number; ciPp: [number, number] };
}

interface ComposeArm {
  name: 'baseline' | 'treatment' | 'isolated';
  pipelineArm: TrialOutput['arm'];
  instructions: string;
}

export async function composeSkills(options: ComposeOptions, client: LlmClient): Promise<ComposeReport> {
  const { target, stack, trials, models, onProgress, concurrency = 4 } = options;
  if (stack.length === 0) throw new ValidationError('Compose requires at least one baseline skill.');
  if (new Set([target, ...stack].map((skill) => skill.sourcePath)).size !== stack.length + 1) {
    throw new ValidationError('Compose does not accept duplicate skill paths.');
  }
  if ([options.tasks, trials, concurrency].some((count) => !Number.isSafeInteger(count) || count < 1)) {
    throw new ValidationError('Compose task, trial, and concurrency counts must be positive integers.');
  }

  const preflight = analyzeComposition(target, stack);
  const cache = JsonCache.disabled();
  onProgress?.({ phase: 'generating' });
  const tasks = await generateTasks({ domain: target.domain, count: options.tasks }, models, client, cache);
  const arms: ComposeArm[] = [
    { name: 'baseline', pipelineArm: 'no_skill', instructions: stackInstructions(stack) },
    { name: 'treatment', pipelineArm: 'with_skill', instructions: stackInstructions([...stack, target]) }
  ];
  if (options.compareIsolated) {
    arms.push({ name: 'isolated', pipelineArm: 'no_skill', instructions: stackInstructions([target]) });
  }

  const jobs: { task: GeneratedTask; trial: number; arm: ComposeArm }[] = [];
  for (const task of tasks) {
    for (let trial = 1; trial <= trials; trial += 1) {
      for (const arm of arms) jobs.push({ task, trial, arm });
    }
  }
  const armByTranscript = new Map<string, ComposeArm['name']>();
  let completed = 0;
  onProgress?.({ phase: 'running', completed, total: jobs.length });
  const outputs = await asyncPool(jobs, concurrency, async ({ task, trial, arm }) => {
    const output = await runOne(target, task, trial, arm.pipelineArm, models, client, cache, arm.instructions);
    // Keep each arm distinct when two instruction sets produce identical messages and answers.
    if (arm.name === 'isolated') output.transcriptHash = `sha256:${hashJson({ arm: arm.name, transcriptHash: output.transcriptHash })}`;
    armByTranscript.set(output.transcriptHash, arm.name);
    onProgress?.({ phase: 'running', completed: ++completed, total: jobs.length });
    return output;
  });
  const graded = await gradeOutputs(tasks, outputs, models, client, cache, onProgress, concurrency);
  onProgress?.({ phase: 'scoring' });
  const primary = scorePairedObservations(pairedObservations(graded.filter((output) => armByTranscript.get(output.transcriptHash) !== 'isolated')));
  const isolated = options.compareIsolated ? scorePairedObservations(pairedObservations(
    graded.filter((output) => armByTranscript.get(output.transcriptHash) !== 'baseline')
  )) : undefined;

  return {
    target: target.name,
    stack: stack.map((skill) => skill.name),
    tasks: tasks.length,
    trials,
    verdict: COMPOSE_VERDICTS[primary.verdict],
    effectPp: primary.effectPp,
    ciPp: primary.ciPp,
    passRates: { baseline: primary.noSkillPass, treatment: primary.withSkillPass, ...(isolated && { isolated: isolated.noSkillPass }) },
    preflight,
    ...(isolated && { isolatedEffect: { effectPp: isolated.effectPp, ciPp: isolated.ciPp } })
  };
}
