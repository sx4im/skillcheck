import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evalSkill } from '../src/eval.js';

vi.mock('../src/adapters/openai-compat.js', async () => {
  const { OutOfOrderMockClient } = await import('./helpers.js');
  return { OpenAiCompatClient: OutOfOrderMockClient };
});

const SKILL_MD = '---\ndomain: testing\n---\n# Test Skill\nInstructions.\n';

describe('eval transcript_hashes ordering', () => {
  let workDir: string;
  let savedEnv: string | undefined;

  beforeEach(async () => {
    savedEnv = process.env.NVIDIA_API_KEY;
    process.env.NVIDIA_API_KEY = 'test-key';
    workDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-transcript-'));
    await writeFile(path.join(workDir, 'SKILL.md'), SKILL_MD);
    await writeFile(
      path.join(workDir, 'tasks.json'),
      JSON.stringify([
        { id: 't1', prompt: 'prompt 1', criterion: 'crit 1' },
        { id: 't2', prompt: 'prompt 2', criterion: 'crit 2' }
      ])
    );
  });

  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = savedEnv;
    await rm(workDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('orders transcript_hashes according to canonical job order, not completion time', async () => {
    const result = await evalSkill({
      inputPath: path.join(workDir, 'SKILL.md'),
      taskSuite: path.join(workDir, 'tasks.json'),
      tasks: 2,
      trials: 2,
      mode: 'forced',
      concurrency: 4,
      useCache: false,
      saveArtifacts: false
    });

    const hashes = result.reproducibility.transcript_hashes;
    expect(hashes).toHaveLength(8);

    // Run again with a single concurrency so it completes sequentially
    const sequentialResult = await evalSkill({
      inputPath: path.join(workDir, 'SKILL.md'),
      taskSuite: path.join(workDir, 'tasks.json'),
      tasks: 2,
      trials: 2,
      mode: 'forced',
      concurrency: 1,
      useCache: false,
      saveArtifacts: false
    });

    // Transcript hashes list must be identical regardless of concurrency or network timing
    expect(hashes).toEqual(sequentialResult.reproducibility.transcript_hashes);
  });
});
