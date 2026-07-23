import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NvidiaNimClient } from '../src/adapters/nvidia-nim.js';
import { JsonCache } from '../src/cache.js';
import type { NvidiaConfig } from '../src/env.js';
import { gradeOutputs } from '../src/grade.js';
import type { GeneratedTask, TrialOutput } from '../src/types.js';

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
    } as unknown as NvidiaNimClient;
    const config = {
      baseUrl: 'https://example.test',
      apiKey: 'test',
      timeoutMs: 1000,
      requestDelayMs: 0,
      maxAttempts: 8,
      maxRetryDelayMs: 60000,
      generatorModel: 'generator',
      graderModel: 'grader',
      runnerModel: 'runner'
    } satisfies NvidiaConfig;
    const tasks: GeneratedTask[] = [
      {
        id: 't001',
        prompt: 'Do the task',
        criterionType: 'rubric',
        criterion: 'Output must satisfy the task.'
      }
    ];
    const outputs: TrialOutput[] = [
      {
        taskId: 't001',
        trial: 1,
        arm: 'with_skill',
        output: 'The task is satisfied.',
        model: 'runner',
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        transcriptHash: 'sha256:test'
      }
    ];

    const graded = await gradeOutputs(tasks, outputs, config, client, new JsonCache(cacheDir));

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
    } as unknown as NvidiaNimClient;
    const config = {
      baseUrl: 'https://example.test',
      apiKey: 'test',
      timeoutMs: 1000,
      requestDelayMs: 0,
      maxAttempts: 8,
      maxRetryDelayMs: 60000,
      generatorModel: 'generator',
      graderModel: 'grader',
      runnerModel: 'runner'
    } satisfies NvidiaConfig;
    const tasks: GeneratedTask[] = [
      {
        id: 't001',
        prompt: 'Do the task',
        criterionType: 'rubric',
        criterion: 'Output must satisfy the task.'
      }
    ];
    const outputs: TrialOutput[] = [
      {
        taskId: 't001',
        trial: 1,
        arm: 'with_skill',
        output: 'The task is satisfied.',
        model: 'runner',
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        transcriptHash: 'sha256:test'
      }
    ];

    const graded = await gradeOutputs(tasks, outputs, config, client, new JsonCache(cacheDir));

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
    } as unknown as NvidiaNimClient;
    const config = {
      baseUrl: 'https://example.test',
      apiKey: 'test',
      timeoutMs: 1000,
      requestDelayMs: 0,
      maxAttempts: 8,
      maxRetryDelayMs: 60000,
      generatorModel: 'generator',
      graderModel: 'grader',
      runnerModel: 'runner'
    } satisfies NvidiaConfig;
    const tasks: GeneratedTask[] = [
      {
        id: 't001',
        prompt: 'Do the task',
        criterionType: 'rubric',
        criterion: 'Output must satisfy the task.'
      }
    ];
    const outputs: TrialOutput[] = [
      {
        taskId: 't001',
        trial: 1,
        arm: 'with_skill',
        output: 'An unrelated answer.',
        model: 'runner',
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        transcriptHash: 'sha256:test-negated'
      }
    ];

    const graded = await gradeOutputs(tasks, outputs, config, client, new JsonCache(cacheDir));

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
    } as unknown as NvidiaNimClient;
    const config = {
      baseUrl: 'https://example.test',
      apiKey: 'test',
      timeoutMs: 1000,
      requestDelayMs: 0,
      maxAttempts: 8,
      maxRetryDelayMs: 60000,
      generatorModel: 'generator',
      graderModel: 'grader',
      runnerModel: 'runner'
    } satisfies NvidiaConfig;
    const tasks: GeneratedTask[] = [
      {
        id: 't001',
        prompt: 'Do the task',
        criterionType: 'rubric',
        criterion: 'Output must satisfy the task.'
      }
    ];
    const outputs: TrialOutput[] = [
      {
        taskId: 't001',
        trial: 1,
        arm: 'with_skill',
        output: 'A correct answer.',
        model: 'runner',
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        transcriptHash: 'sha256:test-score-marker'
      }
    ];

    const graded = await gradeOutputs(tasks, outputs, config, client, new JsonCache(cacheDir));

    expect(graded[0]?.pass).toBe(true);
  });
});
