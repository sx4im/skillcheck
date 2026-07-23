import { describe, expect, it } from 'vitest';
import { gradeDeterministically } from '../src/deterministic.js';

describe('gradeDeterministically', () => {
  it('grades regex deterministic assertions', () => {
    const task = {
      id: 'regex',
      prompt: 'answer token',
      criterionType: 'deterministic' as const,
      criterion: 'regex:^\\s*TOKEN\\s*$'
    };

    expect(gradeDeterministically(task, 'TOKEN').pass).toBe(true);
    expect(gradeDeterministically(task, 'wrong').pass).toBe(false);
  });

  it('grades includes deterministic assertions', () => {
    const task = {
      id: 'includes',
      prompt: 'answer token',
      criterionType: 'deterministic' as const,
      criterion: 'includes:TOKEN'
    };

    expect(gradeDeterministically(task, 'prefix TOKEN suffix').score).toBe(1);
    expect(gradeDeterministically(task, 'missing').score).toBe(0);
  });
});
