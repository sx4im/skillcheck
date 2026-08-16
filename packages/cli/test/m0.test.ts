import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LlmClient } from '../src/adapters/types.js';
import { runM0Gate } from '../src/m0/run.js';

// Apply the canary SKU rule the M0 skill encodes, so the with-skill arm answers
// correctly and the no-skill arm (no system prompt) blindly guesses INVALID.
// That gives the gate a real, deterministic signal without any network.
function classify(candidate: string): 'VALID' | 'INVALID' {
  const match = /^SC-(\d{4})-([a-z])$/.exec(candidate);
  if (!match) return 'INVALID';
  const sum = match[1].split('').reduce((acc, d) => acc + Number(d), 0);
  const expected = ['q', 'r', 's'][sum % 3];
  return match[2] === expected ? 'VALID' : 'INVALID';
}

function fakeClientFactory(): LlmClient {
  return {
    complete: async ({ messages }: { messages: Array<{ role: string; content: string }> }) => {
      const hasSkill = messages.some((m) => m.role === 'system');
      const prompt = messages.find((m) => m.role === 'user')?.content ?? '';
      const candidate = /Candidate:\s*([A-Za-z0-9-]+)/.exec(prompt)?.[1] ?? '';
      const answer = hasSkill ? classify(candidate) : 'INVALID';
      return { content: answer, model: 'fake', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
    }
  } as unknown as LlmClient;
}

describe('runM0Gate', () => {
  // runM0Gate reads environment configuration; provide a test key so execution is hermetic.
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.NVIDIA_API_KEY;
    process.env.NVIDIA_API_KEY = 'test-key';
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = savedKey;
  });

  it('passes repeatability and the empty control with a deterministic runner', async () => {
    const report = await runM0Gate(fakeClientFactory);

    expect(report.config.tasks).toBeGreaterThan(0);
    expect(report.repeatability.runs).toHaveLength(3);
    expect(report.repeatability.passed).toBe(true);
    // Empty control: both arms identical (no skill) → effect overlaps zero.
    expect(report.emptyControl.passed).toBe(true);
    expect(report.passed).toBe(true);
    // Each repeat run graded both arms for every task and trial.
    const firstRun = report.repeatability.runs[0]!;
    expect(firstRun.armResults.length).toBe(report.config.tasks * report.config.trials * 2);
  });
});
