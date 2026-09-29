import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LlmClient } from '../src/adapters/types.js';
import { JsonCache } from '../src/cache.js';
import { gradeOutputs } from '../src/grade.js';
import type { GeneratedTask, TrialOutput } from '../src/types.js';
import { testProviderConfig } from './helpers.js';

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

    const graded = await gradeOutputs(sampleTasks, sampleOutputs(), testProviderConfig, client, new JsonCache(cacheDir));

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

    const graded = await gradeOutputs(sampleTasks, sampleOutputs(), testProviderConfig, client, new JsonCache(cacheDir));

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
      testProviderConfig,
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
      testProviderConfig,
      client,
      new JsonCache(cacheDir)
    );

    expect(graded[0]?.pass).toBe(true);
  });

  it('throws a clear error when the grader never returns valid JSON', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-grade-never-valid-'));
    const client = {
      complete: async () => ({
        content: '{ "score": 1, "reason": "truncated...',
        model: 'grader',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
      })
    } as unknown as LlmClient;

    await expect(
      gradeOutputs(sampleTasks, sampleOutputs('sha256:test-unclosed'), testProviderConfig, client, new JsonCache(cacheDir))
    ).rejects.toThrow(/Grader JSON object was not closed/);
  });

  it('throws a clear error when the grader score is not numeric', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-grade-nonnumeric-'));
    const client = {
      complete: async () => ({
        content: '{"score": "high", "reason": "vibes"}',
        model: 'grader',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
      })
    } as unknown as LlmClient;

    await expect(
      gradeOutputs(sampleTasks, sampleOutputs('sha256:test-nonnumeric'), testProviderConfig, client, new JsonCache(cacheDir))
    ).rejects.toThrow(/missing numeric score/);
  });

  it('treats an explicit score: 0 marker as a fail', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-grade-zero-'));
    const client = {
      complete: async () => ({
        content: 'score: 0 — the output is wrong and misses the point.',
        model: 'grader',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
      })
    } as unknown as LlmClient;

    const graded = await gradeOutputs(
      sampleTasks,
      sampleOutputs('sha256:test-zero-marker', 'A wrong answer.'),
      testProviderConfig,
      client,
      new JsonCache(cacheDir)
    );

    expect(graded[0]?.pass).toBe(false);
    expect(graded[0]?.score).toBe(0);
  });

  it('throws a clear error when an output references an unknown task', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-grade-unknown-task-'));
    const client = {
      complete: async () => {
        throw new Error('grader must not be called');
      }
    } as unknown as LlmClient;
    const outputs = sampleOutputs('sha256:test-unknown-task').map((o) => ({ ...o, taskId: 'nope' }));

    await expect(
      gradeOutputs(sampleTasks, outputs, testProviderConfig, client, new JsonCache(cacheDir))
    ).rejects.toThrow(/Missing task for output nope/);
  });

  it('grades deterministic tasks without calling the LLM', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-grade-deterministic-'));
    const tasks: GeneratedTask[] = [
      { id: 't001', prompt: 'Say hello', criterionType: 'deterministic', criterion: 'includes:hello' }
    ];
    const client = {
      complete: async () => {
        throw new Error('grader must not be called for deterministic tasks');
      }
    } as unknown as LlmClient;

    const graded = await gradeOutputs(
      tasks,
      sampleOutputs('sha256:test-deterministic', 'well hello there'),
      testProviderConfig,
      client,
      new JsonCache(cacheDir)
    );

    expect(graded[0]?.pass).toBe(true);
    expect(graded[0]?.score).toBe(1);
    expect(graded[0]?.reason).toContain('included hello');
  });
});
