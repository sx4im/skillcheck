import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { LlmClient } from '../adapters/types.js';
import { loadProviderConfig } from '../env.js';
import { runnerMessages } from '../run.js';
import {
  ciOverlapsZero,
  effectInsideCi,
  scorePairedObservations,
  type PairedObservation,
  type ScoreSummary
} from '../score.js';
import { M0_SKILL, M0_TASKS, type M0Task } from './hardcoded.js';

const K_TRIALS = 3;
const TEMPERATURE = 0.7;
// Room for models with built-in reasoning (gpt-oss) to think before the terse
// final answer; the pass regex still demands exactly VALID/INVALID as output.
const MAX_TOKENS = 512;

interface ArmResult {
  taskId: string;
  trial: number;
  arm: 'with_skill' | 'no_skill';
  expected: M0Task['expected'];
  output: string;
  pass: boolean;
}

interface M0RunResult {
  runId: string;
  skillLabel: string;
  score: ScoreSummary;
  observations: PairedObservation[];
  armResults: ArmResult[];
}

export interface M0GateReport {
  config: {
    runnerModel: string;
    trials: number;
    tasks: number;
    temperature: number;
  };
  repeatability: {
    passed: boolean;
    runs: M0RunResult[];
  };
  emptyControl: {
    passed: boolean;
    run: M0RunResult;
  };
  passed: boolean;
}

// The gate runs the production runner prompt (runnerMessages from run.ts), so
// it calibrates the exact prompt shape real evals use — a hand-rolled variant
// here would silently validate a different pipeline.
function buildMessages(skill: string, prompt: string): ChatCompletionMessageParam[] {
  return runnerMessages(skill, prompt);
}

function outputPasses(output: string, expected: M0Task['expected']): boolean {
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*${escaped}\\s*\\.?\\s*$`, 'i').test(output);
}

async function runArm(
  client: LlmClient,
  model: string,
  skill: string,
  task: M0Task,
  trial: number,
  arm: ArmResult['arm']
): Promise<ArmResult> {
  const response = await client.complete({
    model,
    messages: buildMessages(skill, task.prompt),
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS
  });

  return {
    taskId: task.id,
    trial,
    arm,
    expected: task.expected,
    output: response.content.trim(),
    pass: outputPasses(response.content, task.expected)
  };
}

async function runSkillOnce(
  client: LlmClient,
  model: string,
  skill: string,
  skillLabel: string,
  runId: string
): Promise<M0RunResult> {
  const armResults: ArmResult[] = [];
  const observations: PairedObservation[] = [];

  for (const task of M0_TASKS) {
    for (let trial = 1; trial <= K_TRIALS; trial += 1) {
      console.error(`[m0] ${runId} ${task.id} trial ${trial}/${K_TRIALS} with_skill`);
      const withSkill = await runArm(client, model, skill, task, trial, 'with_skill');
      console.error(`[m0] ${runId} ${task.id} trial ${trial}/${K_TRIALS} no_skill`);
      const noSkill = await runArm(client, model, '', task, trial, 'no_skill');

      armResults.push(withSkill, noSkill);
      observations.push({
        withSkillPass: withSkill.pass,
        noSkillPass: noSkill.pass
      });
    }
  }

  return {
    runId,
    skillLabel,
    score: scorePairedObservations(observations, 1000, hashSeed(runId)),
    observations,
    armResults
  };
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export async function runM0Gate(clientFactory: (config: ReturnType<typeof loadProviderConfig>) => LlmClient): Promise<M0GateReport> {
  const config = loadProviderConfig();
  const client = clientFactory(config);
  const startedAt = new Date().toISOString();
  const repeatRuns: M0RunResult[] = [];

  for (let index = 1; index <= 3; index += 1) {
    console.error(`[m0] starting repeatability run ${index}/3`);
    repeatRuns.push(
      await runSkillOnce(client, config.runnerModel, M0_SKILL, 'canary-sku-skill', `${startedAt}-repeat-${index}`)
    );
  }

  console.error('[m0] starting empty-control run');
  const emptyRun = await runSkillOnce(client, config.runnerModel, '', 'empty-skill', `${startedAt}-empty-control`);
  const repeatabilityPassed = repeatRuns.every((run) => effectInsideCi(run.score));
  const emptyControlPassed = ciOverlapsZero(emptyRun.score);

  return {
    config: {
      runnerModel: config.runnerModel,
      trials: K_TRIALS,
      tasks: M0_TASKS.length,
      temperature: TEMPERATURE
    },
    repeatability: {
      passed: repeatabilityPassed,
      runs: repeatRuns
    },
    emptyControl: {
      passed: emptyControlPassed,
      run: emptyRun
    },
    passed: repeatabilityPassed && emptyControlPassed
  };
}
