import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  saveCheckpoint,
  loadCheckpoint,
  clearCheckpoint,
  type CheckpointData
} from '../src/checkpoint.js';
import type { TrialOutput } from '../src/types.js';

describe('checkpointed evaluation persistence', () => {
  let tempDir: string;
  let cpFile: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-cp-'));
    cpFile = path.join(tempDir, 'checkpoint.json');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const sampleOutputs: TrialOutput[] = [
    {
      taskId: 't1',
      trial: 1,
      arm: 'with_skill',
      output: 'test output',
      model: 'runner',
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      transcriptHash: 'h1'
    }
  ];

  it('saves and loads valid checkpoint data atomically', async () => {
    const data: CheckpointData = {
      skillHash: 'hash-123',
      taskSuiteHash: 'suite-456',
      trials: 3,
      runnerModel: 'runner-a',
      graderModel: 'grader-a',
      generatorModel: 'generator-a',
      completedOutputs: sampleOutputs,
      updatedAt: new Date().toISOString()
    };

    await saveCheckpoint(cpFile, data);
    const loaded = await loadCheckpoint(cpFile);

    expect(loaded).not.toBeNull();
    expect(loaded?.skillHash).toBe('hash-123');
    expect(loaded?.runnerModel).toBe('runner-a');
    expect(loaded?.graderModel).toBe('grader-a');
    expect(loaded?.generatorModel).toBe('generator-a');
    expect(loaded?.completedOutputs).toHaveLength(1);
    expect(loaded?.completedOutputs[0]?.transcriptHash).toBe('h1');
  });

  it('returns null when loading non-existent checkpoint', async () => {
    const missing = await loadCheckpoint(path.join(tempDir, 'missing.json'));
    expect(missing).toBeNull();
  });

  it('safely handles corrupted or malformed checkpoint files by returning null', async () => {
    const corruptedFile = path.join(tempDir, 'bad.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(corruptedFile, '{ "invalid": [');

    const result = await loadCheckpoint(corruptedFile);
    expect(result).toBeNull();
  });

  it('clears checkpoint cleanly', async () => {
    const data: CheckpointData = {
      skillHash: 'hash-123',
      taskSuiteHash: 'suite-456',
      trials: 3,
      runnerModel: 'runner-a',
      graderModel: 'grader-a',
      generatorModel: 'generator-a',
      completedOutputs: sampleOutputs,
      updatedAt: new Date().toISOString()
    };

    await saveCheckpoint(cpFile, data);
    await clearCheckpoint(cpFile);

    const after = await loadCheckpoint(cpFile);
    expect(after).toBeNull();
  });

  it('rejects legacy checkpoints missing model fields so a model change never reuses stale outputs', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      cpFile,
      JSON.stringify({
        skillHash: 'hash-123',
        taskSuiteHash: 'suite-456',
        trials: 3,
        completedOutputs: sampleOutputs,
        updatedAt: new Date().toISOString()
      })
    );

    expect(await loadCheckpoint(cpFile)).toBeNull();
  });
});
