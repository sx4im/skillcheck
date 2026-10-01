import { describe, expect, it } from 'vitest';
import { createDebouncedWatcher, calculateTokenDelta } from '../src/watch.js';

describe('watch mode hot-reloading', () => {
  it('calculates token delta between previous and current text', () => {
    const prev = 'short instruction';
    const curr = 'short instruction with several more detailed rules and constraints';

    const delta = calculateTokenDelta(prev, curr);
    expect(delta.difference).toBeGreaterThan(0);
    expect(delta.sign).toBe('+');
  });

  it('debounces rapid file system events into single execution', async () => {
    let executions = 0;
    const trigger = createDebouncedWatcher(() => {
      executions += 1;
    }, 50);

    trigger();
    trigger();
    trigger();

    expect(executions).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(executions).toBe(1);
  });
});
