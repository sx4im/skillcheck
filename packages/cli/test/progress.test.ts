import { describe, expect, it } from 'vitest';
import { formatElapsed, formatProgressBar, formatDualArmBar } from '../src/ui/progress.js';

describe('progress telemetry', () => {
  it('formats elapsed time into human readable format', () => {
    expect(formatElapsed(500)).toBe('0s');
    expect(formatElapsed(12000)).toBe('12s');
    expect(formatElapsed(65000)).toBe('1m 05s');
    expect(formatElapsed(125000)).toBe('2m 05s');
  });

  it('renders progress bar with exact ratio', () => {
    const half = formatProgressBar(5, 10, 10);
    expect(half).toContain('▰▰▰▰▰');
    expect(half).toContain('▱▱▱▱▱');

    const full = formatProgressBar(10, 10, 10);
    expect(full).toContain('▰▰▰▰▰▰▰▰▰▰');
    expect(full).not.toContain('▱');

    const empty = formatProgressBar(0, 10, 10);
    expect(empty).toContain('▱▱▱▱▱▱▱▱▱▱');
    expect(empty).not.toContain('▰');
  });

  it('renders dual arm bar distinguishing Arm A (with skill) and Arm B (without skill)', () => {
    const dual = formatDualArmBar(4, 2, 8, 8);
    expect(dual).toContain('A:');
    expect(dual).toContain('B:');
  });
});
