import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { GeneratedTask, TaskDifficulty, TrialOutput } from './types.js';

export interface CheckpointData {
  skillHash: string;
  taskSuiteHash: string;
  trials: number;
  difficulty: TaskDifficulty;
  runnerModel: string;
  graderModel: string;
  generatorModel: string;
  /** The exact tasks the interrupted run used — reused verbatim on --resume. */
  tasks: GeneratedTask[];
  completedOutputs: TrialOutput[];
  updatedAt: string;
}

export function defaultCheckpointDir(): string {
  return path.join(homedir(), '.config', 'skillcheck', 'checkpoints');
}

export function checkpointPath(skillHash: string, dir = defaultCheckpointDir()): string {
  const safeHash = skillHash.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
  return path.join(dir, `${safeHash}.json`);
}

/**
 * Atomically save checkpoint data to disk using a write-then-rename strategy
 * to prevent partial writes if interrupted mid-flush.
 */
export async function saveCheckpoint(filePath: string, data: CheckpointData): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tempFile = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(tempFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tempFile, filePath);
}

/**
 * Load and validate checkpoint data. Returns null if missing, unparseable,
 * or corrupted.
 */
export async function loadCheckpoint(filePath: string): Promise<CheckpointData | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<CheckpointData>;

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.skillHash !== 'string' ||
      typeof parsed.taskSuiteHash !== 'string' ||
      typeof parsed.trials !== 'number' ||
      (parsed.difficulty !== 'standard' && parsed.difficulty !== 'hard' && parsed.difficulty !== 'adversarial') ||
      typeof parsed.runnerModel !== 'string' ||
      typeof parsed.graderModel !== 'string' ||
      typeof parsed.generatorModel !== 'string' ||
      !Array.isArray(parsed.tasks) ||
      !Array.isArray(parsed.completedOutputs)
    ) {
      return null;
    }

    return parsed as CheckpointData;
  } catch {
    return null;
  }
}

/**
 * Clear checkpoint file once an evaluation has reached complete terminal scoring.
 */
export async function clearCheckpoint(filePath: string): Promise<void> {
  try {
    await rm(filePath, { force: true });
  } catch {
    // Ignore ENOENT
  }
}
