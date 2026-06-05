import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NvidiaNimClient } from '../src/adapters/nvidia-nim.js';
import { JsonCache } from '../src/cache.js';
import type { NvidiaConfig } from '../src/env.js';
import { generateTasks } from '../src/generate.js';

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

    const tasks = await generateTasks({ domain: 'retry testing', count: 1 }, config, client, new JsonCache(cacheDir));

    expect(calls).toBe(2);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.prompt).toMatch(/thing/);
  });
});
