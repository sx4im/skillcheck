import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LlmClient } from '../src/adapters/types.js';
import { JsonCache } from '../src/cache.js';
import { generateTasks } from '../src/generate.js';
import { testProviderConfig } from './helpers.js';

describe('generateTasks', () => {
  it('retries when the generator returns malformed JSON', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-generate-cache-'));
    let calls = 0;
    const client = {
      complete: async () => {
        calls += 1;
        return {
          content:
            calls === 1
              ? '{"tasks":[{"id":"t1","prompt":"broken"'
              : '{"tasks":[{"id":"t1","prompt":"Do one thing","criterion":"Output must satisfy one thing"},{"id":"t2","prompt":"Do another thing","criterion":"Output must satisfy another thing"}]}',
          model: 'generator',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
        };
      }
    } as unknown as LlmClient;

    const tasks = await generateTasks({ domain: 'retry testing', count: 1 }, testProviderConfig, client, new JsonCache(cacheDir));

    expect(calls).toBe(2);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.prompt).toMatch(/thing/);
  });

  it('retries a short batch, then accepts a partial one on the final attempt', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-generate-cache-'));
    let calls = 0;
    const shortBatch =
      '{"tasks":[{"id":"t1","prompt":"Only one task","criterion":"Output must satisfy the task"}]}';
    const client = {
      complete: async () => {
        calls += 1;
        return {
          content: shortBatch, // always fewer than the 3 requested
          model: 'generator',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
        };
      }
    } as unknown as LlmClient;

    const tasks = await generateTasks({ domain: 'short batches', count: 3 }, testProviderConfig, client, new JsonCache(cacheDir));

    expect(calls).toBe(3); // tried three times for the full count
    expect(tasks).toHaveLength(1); // then settled for what it got
  });

  it('adds hard-difficulty guidance to the generator prompt', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-generate-cache-'));
    let userPrompt = '';
    const client = {
      complete: async (request: { messages: Array<{ role: string; content: string }> }) => {
        userPrompt = request.messages.map((message) => message.content).join('\n');
        return {
          content:
            '{"tasks":[{"id":"t1","prompt":"Do one thing","criterion":"Output must satisfy one thing"}]}',
          model: 'generator',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
        };
      }
    } as unknown as LlmClient;

    await generateTasks({ domain: 'hard things', count: 1, difficulty: 'hard' }, testProviderConfig, client, new JsonCache(cacheDir));

    expect(userPrompt).toMatch(/edge cases/i);
    expect(userPrompt).toMatch(/non-obvious failure modes/i);
  });

  it('adds adversarial-difficulty guidance to the generator prompt', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-generate-cache-'));
    let userPrompt = '';
    const client = {
      complete: async (request: { messages: Array<{ role: string; content: string }> }) => {
        userPrompt = request.messages.map((message) => message.content).join('\n');
        return {
          content:
            '{"tasks":[{"id":"t1","prompt":"Do one thing","criterion":"Output must satisfy one thing"}]}',
          model: 'generator',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
        };
      }
    } as unknown as LlmClient;

    await generateTasks({ domain: 'hard things', count: 1, difficulty: 'adversarial' }, testProviderConfig, client, new JsonCache(cacheDir));

    expect(userPrompt).toMatch(/boundary-condition/i);
    expect(userPrompt).toMatch(/anti-pattern/i);
  });

  it('keeps the standard generator prompt unchanged when difficulty is omitted', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-generate-cache-'));
    let userPrompt = '';
    const client = {
      complete: async (request: { messages: Array<{ role: string; content: string }> }) => {
        userPrompt = request.messages.map((message) => message.content).join('\n');
        return {
          content:
            '{"tasks":[{"id":"t1","prompt":"Do one thing","criterion":"Output must satisfy one thing"}]}',
          model: 'generator',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
        };
      }
    } as unknown as LlmClient;

    await generateTasks({ domain: 'plain things', count: 1 }, testProviderConfig, client, new JsonCache(cacheDir));

    expect(userPrompt).not.toMatch(/edge cases/i);
    expect(userPrompt).not.toMatch(/boundary-condition/i);
  });
});
