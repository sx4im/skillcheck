import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LlmClient } from '../src/adapters/types.js';
import { JsonCache } from '../src/cache.js';
import { runTrials } from '../src/run.js';
import type { GeneratedTask, NormalizedSkill } from '../src/types.js';
import { testProviderConfig } from './helpers.js';

const skill: NormalizedSkill = {
  name: 'Example Skill',
  sourcePath: 'SKILL.md',
  format: 'SKILL.md',
  instructions: 'Always do the thing carefully.',
  domain: 'example domain',
  assets: [],
  versionHash: 'hash',
  toolDependent: false
};

const tasks: GeneratedTask[] = [
  { id: 't001', prompt: 'Do the task', criterionType: 'rubric', criterion: 'Output satisfies the task.' }
];

describe('runTrials trial independence', () => {
  it('queries the model once per trial per arm instead of replaying a cached trial', async () => {
    // Regression guard for the cache-collapse bug: the runner cache key must
    // include `trial`. Before the fix the model was called twice total (one
    // cache miss per arm, then trials 2..K read trial 1 back). After the fix it
    // is called trials x arms times, with a distinct output per trial.
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-run-cache-'));
    let calls = 0;
    const client = {
      complete: async () => {
        calls += 1;
        return {
          content: `output-${calls}`,
          model: 'runner',
          usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 }
        };
      }
    } as unknown as LlmClient;

    const outputs = await runTrials(skill, tasks, 3, testProviderConfig, client, new JsonCache(cacheDir));

    expect(calls).toBe(6); // 1 task x 3 trials x 2 arms
    expect(outputs).toHaveLength(6);

    const withSkillOutputs = outputs.filter((output) => output.arm === 'with_skill').map((output) => output.output);
    expect(withSkillOutputs).toHaveLength(3);
    expect(new Set(withSkillOutputs).size).toBe(3); // trials are not collapsed into one

    const noSkillOutputs = outputs.filter((output) => output.arm === 'no_skill').map((output) => output.output);
    expect(new Set(noSkillOutputs).size).toBe(3);
  });

  it('serves a repeated trial from cache on a warm run', async () => {
    // Same key (same trial) must still hit the cache, so re-running a result is
    // reproducible on the same machine.
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-run-cache-'));
    let calls = 0;
    const client = {
      complete: async () => {
        calls += 1;
        return {
          content: `output-${calls}`,
          model: 'runner',
          usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 }
        };
      }
    } as unknown as LlmClient;

    const cache = new JsonCache(cacheDir);
    const first = await runTrials(skill, tasks, 3, testProviderConfig, client, cache);
    const second = await runTrials(skill, tasks, 3, testProviderConfig, client, cache);

    expect(calls).toBe(6); // second run is fully cached
    expect(second.map((output) => output.output)).toEqual(first.map((output) => output.output));
  });

  it('skips already-completed jobs and reports only remaining work in progress totals', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-run-skip-'));
    let calls = 0;
    const client = {
      complete: async () => {
        calls += 1;
        return {
          content: `output-${calls}`,
          model: 'runner',
          usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 }
        };
      }
    } as unknown as LlmClient;

    // Pretend trial 1 of both arms already completed (e.g. from a checkpoint).
    const seenTotals: number[] = [];
    const outputs = await runTrials(skill, tasks, 2, testProviderConfig, client, new JsonCache(cacheDir), (event) => {
      if (event.phase === 'running') seenTotals.push(event.total ?? 0);
    }, 4, {
      skip: (job) => job.trial === 1
    });

    expect(calls).toBe(2); // only trial 2 x 2 arms ran
    expect(outputs).toHaveLength(2);
    expect(outputs.every((output) => output.trial === 2)).toBe(true);
    expect(seenTotals.every((total) => total === 2)).toBe(true);
  });

  it('invokes onTrialComplete once per finished job for incremental checkpointing', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-run-cb-'));
    const client = {
      complete: async () => ({
        content: 'output',
        model: 'runner',
        usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 }
      })
    } as unknown as LlmClient;

    const completed: string[] = [];
    await runTrials(skill, tasks, 2, testProviderConfig, client, new JsonCache(cacheDir), undefined, 4, {
      onTrialComplete: (output) => {
        completed.push(`${output.taskId}:${output.trial}:${output.arm}`);
      }
    });

    expect(completed).toHaveLength(4); // 1 task x 2 trials x 2 arms
    expect(new Set(completed).size).toBe(4);
  });
});
