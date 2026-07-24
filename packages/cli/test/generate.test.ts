import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NvidiaNimClient } from '../src/adapters/nvidia-nim.js';
import { JsonCache } from '../src/cache.js';
import { generateTasks } from '../src/generate.js';
import { testNvidiaConfig } from './helpers.js';

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
    } as unknown as NvidiaNimClient;

    const tasks = await generateTasks({ domain: 'retry testing', count: 1 }, testNvidiaConfig, client, new JsonCache(cacheDir));

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
    } as unknown as NvidiaNimClient;

    const tasks = await generateTasks({ domain: 'short batches', count: 3 }, testNvidiaConfig, client, new JsonCache(cacheDir));

    expect(calls).toBe(3); // tried three times for the full count
    expect(tasks).toHaveLength(1); // then settled for what it got
  });
});
