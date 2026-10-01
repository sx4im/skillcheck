import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evalSkill } from '../src/eval.js';
import { ShiftingGeneratorClient } from './helpers.js';

vi.mock('../src/adapters/openai-compat.js', async () => {
  const { ShiftingGeneratorClient } = await import('./helpers.js');
  return { OpenAiCompatClient: ShiftingGeneratorClient };
});

// Regression test for resume with LLM-generated tasks: the checkpoint used to
// store only the task-suite hash, and --resume regenerated tasks via the LLM.
// A fresh generation never matches the stored hash, so resume silently
// restarted from zero (re-billing every trial). The checkpoint must store the
// tasks themselves and reuse them on --resume without calling the generator.
const ENV_KEYS = [
  'NVIDIA_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GROQ_API_KEY',
  'MISTRAL_API_KEY',
  'OPENROUTER_API_KEY',
  'SKILLCHECK_PROVIDER',
  'SKILLCHECK_TOKEN',
  'SKILLCHECK_API_KEY',
  'SKILLCHECK_API_URL',
  'SKILLCHECK_CONFIG_DIR',
  'HOME'
];

const SKILL_MD = '---\ndomain: writing clear commit messages\n---\n# Commit Skill\n\nAlways explain the why.\n';

describe('evalSkill --resume with generated tasks', () => {
  let workDir: string;
  let homeDir: string;
  let cwd: string;
  let saved: Record<string, string | undefined>;

  beforeEach(async () => {
    cwd = process.cwd();
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    // Direct mode with a throwaway key - the mocked client never uses it, but
    // it satisfies resolveActiveProvider without consulting real config.
    process.env.NVIDIA_API_KEY = 'test-key-not-real';
    homeDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-resume-home-'));
    process.env.HOME = homeDir; // isolates ~/.config/skillcheck/checkpoints
    process.env.SKILLCHECK_CONFIG_DIR = await mkdtemp(path.join(tmpdir(), 'skillcheck-resume-cfg-'));
    workDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-resume-'));
    process.chdir(workDir);
    await writeFile(path.join(workDir, 'SKILL.md'), SKILL_MD);
    ShiftingGeneratorClient.reset();
  });

  afterEach(async () => {
    process.chdir(cwd);
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await rm(workDir, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
    if (process.env.SKILLCHECK_CONFIG_DIR?.includes('skillcheck-resume-cfg-')) {
      await rm(process.env.SKILLCHECK_CONFIG_DIR, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('reuses stored tasks on --resume: generator not called again, completed trials not re-run', async () => {
    const options = {
      inputPath: path.join(workDir, 'SKILL.md'),
      tasks: 2,
      trials: 2,
      mode: 'forced' as const,
      useCache: false,
      saveArtifacts: false,
      concurrency: 1
    };

    // Interrupt mid-trials: 1 generate + 4 runner calls succeed, the 5th call
    // throws. 4 of the 8 trial jobs are checkpointed.
    ShiftingGeneratorClient.failAfterCalls = 5;
    await expect(evalSkill(options)).rejects.toThrow('simulated interruption');
    expect(ShiftingGeneratorClient.generateCalls).toBe(1);

    // Resume to completion. The generator must NOT run again (its output would
    // differ, which is exactly what broke resume), and the 4 completed trials
    // must be skipped: 4 remaining runners + 8 graders = 12 more calls.
    ShiftingGeneratorClient.failAfterCalls = Number.POSITIVE_INFINITY;
    const result = await evalSkill({ ...options, resume: true });

    expect(ShiftingGeneratorClient.generateCalls).toBe(1);
    expect(ShiftingGeneratorClient.otherCalls).toBe(5 + 12);
    expect(result.config.tasks).toBe(2);
    expect(result.tasks).toHaveLength(2);
    expect(result.reproducibility.transcript_hashes).toHaveLength(8);
    // The resumed run kept the FIRST generation's tasks, not a fresh set.
    expect(result.tasks[0].prompt).toContain('from generation 1');
  });

  it('refuses to reuse a checkpoint from a different difficulty and regenerates tasks', async () => {
    const options = {
      inputPath: path.join(workDir, 'SKILL.md'),
      tasks: 2,
      trials: 2,
      mode: 'forced' as const,
      useCache: false,
      saveArtifacts: false,
      concurrency: 1,
      difficulty: 'standard' as const
    };

    // Interrupt mid-trials under standard difficulty:
    ShiftingGeneratorClient.failAfterCalls = 5;
    await expect(evalSkill(options)).rejects.toThrow('simulated interruption');
    expect(ShiftingGeneratorClient.generateCalls).toBe(1);

    // Resume under hard difficulty:
    ShiftingGeneratorClient.failAfterCalls = Number.POSITIVE_INFINITY;
    const result = await evalSkill({ ...options, difficulty: 'hard', resume: true });

    // The generator must be invoked again for a fresh set of hard tasks:
    expect(ShiftingGeneratorClient.generateCalls).toBe(2);
    expect(result.config.tasks).toBe(2);
    expect(result.tasks[0].prompt).toContain('from generation 2');
  });
});
