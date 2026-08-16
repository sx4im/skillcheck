import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LlmClient } from '../src/adapters/types.js';
import { JsonCache } from '../src/cache.js';
import { gradeOutputs } from '../src/grade.js';
import type { GeneratedTask, TrialOutput } from '../src/types.js';
import { testNvidiaConfig } from './helpers.js';

const sampleTasks: GeneratedTask[] = [
  {
    id: 't001',
    prompt: 'Do the task',
    criterionType: 'rubric',
    criterion: 'Output must satisfy the task.'
  }
];

function sampleOutputs(hash = 'sha256:test', outputText = 'The task is satisfied.'): TrialOutput[] {
  return [
    {
      taskId: 't001',
      trial: 1,
      arm: 'with_skill',
      output: outputText,
      model: 'runner',
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      transcriptHash: hash
    }
  ];
}

describe('gradeOutputs', () => {
  it('retries when the grader returns malformed JSON', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-grade-cache-'));
    let calls = 0;
    const client = {
      complete: async () => {
        calls += 1;
        return {
          content: calls === 1 ? '{ score: 1 }' : '{"score":1,"reason":"meets criterion"}',
          model: 'grader',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
        };
      }
    } as unknown as LlmClient;

    const graded = await gradeOutputs(sampleTasks, sampleOutputs(), testNvidiaConfig, client, new JsonCache(cacheDir));

    expect(calls).toBe(2);
    expect(graded[0]?.pass).toBe(true);
  });

  it('falls back for reasoning text that contains code braces', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-grade-cache-'));
    const client = {
      complete: async () => ({
        content: 'The output meets the criterion. Example code contains braces: function x() { return true; }',
        model: 'grader',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
      })
    } as unknown as LlmClient;

    const graded = await gradeOutputs(sampleTasks, sampleOutputs(), testNvidiaConfig, client, new JsonCache(cacheDir));

    expect(graded[0]?.pass).toBe(true);
    expect(graded[0]?.reason).toContain('non-json grader response');
  });

  it('does not count a negated pass-word as a pass in the non-JSON fallback', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-grade-cache-'));
    const client = {
      complete: async () => ({
        content: 'The output does not pass the criterion; it fails to meet the requirement.',
        model: 'grader',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
      })
    } as unknown as LlmClient;

    const graded = await gradeOutputs(
      sampleTasks,
      sampleOutputs('sha256:test-negated', 'An unrelated answer.'),
      testNvidiaConfig,
      client,
      new JsonCache(cacheDir)
    );

    expect(graded[0]?.pass).toBe(false);
  });

  it('honours an explicit score marker even when negation words appear', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-grade-cache-'));
    const client = {
      complete: async () => ({
        content: 'score: 1 — the output is correct and does not contain errors.',
        model: 'grader',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
      })
    } as unknown as LlmClient;

    const graded = await gradeOutputs(
      sampleTasks,
      sampleOutputs('sha256:test-score-marker', 'A correct answer.'),
      testNvidiaConfig,
      client,
      new JsonCache(cacheDir)
    );

    expect(graded[0]?.pass).toBe(true);
  });
});
