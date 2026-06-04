import type { GeneratedTask } from './types.js';

export interface DeterministicGrade {
  score: number;
  reason: string;
  pass: boolean;
}

export function gradeDeterministically(task: GeneratedTask, output: string): DeterministicGrade {
  if (task.criterionType !== 'deterministic') {
    throw new Error(`Task ${task.id} is not deterministic`);
  }

  if (task.criterion.startsWith('regex:')) {
    const pattern = task.criterion.slice('regex:'.length);
    const pass = new RegExp(pattern, 's').test(output);
    return {
      score: pass ? 1 : 0,
      reason: pass ? `matched regex ${pattern}` : `did not match regex ${pattern}`,
      pass
    };
  }

  if (task.criterion.startsWith('includes:')) {
    const expected = task.criterion.slice('includes:'.length);
    const pass = output.includes(expected);
    return {
      score: pass ? 1 : 0,
      reason: pass ? `included ${expected}` : `did not include ${expected}`,
      pass
    };
  }

  throw new Error(`Unsupported deterministic criterion for ${task.id}: ${task.criterion}`);
}
