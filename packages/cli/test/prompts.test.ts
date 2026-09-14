import { describe, expect, it, vi } from 'vitest';
import { CancelledError } from '../src/ui/picker.js';
import { runMenuSelectionLoop, selectEffort, selectMenuOption } from '../src/ui/prompts.js';

vi.mock('../src/ui/picker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/picker.js')>();
  return {
    ...actual,
    withRawMode: async <T>(action: () => Promise<T>) => action(),
    drawLines: vi.fn(() => true)
  };
});

describe('prompts menu selection', () => {
  it('falls back to default effort in non-TTY environments', async () => {
    const origStdinTTY = process.stdin.isTTY;
    const origStdoutTTY = process.stdout.isTTY;
    try {
      (process.stdin as { isTTY?: boolean }).isTTY = false;
      (process.stdout as { isTTY?: boolean }).isTTY = false;

      const effort = await selectEffort();
      expect(effort.label).toBe('Standard');
      expect(effort.tasks).toBe(3);
      expect(effort.trials).toBe(3);
    } finally {
      (process.stdin as { isTTY?: boolean }).isTTY = origStdinTTY;
      (process.stdout as { isTTY?: boolean }).isTTY = origStdoutTTY;
    }
  });

  it('falls back to first option in non-TTY environments', async () => {
    const origStdinTTY = process.stdin.isTTY;
    const origStdoutTTY = process.stdout.isTTY;
    try {
      (process.stdin as { isTTY?: boolean }).isTTY = false;
      (process.stdout as { isTTY?: boolean }).isTTY = false;

      const value = await selectMenuOption('Pick a fruit', 'Subtitle', [
        { key: '1', name: 'Apple', value: 'apple' },
        { key: '2', name: 'Banana', value: 'banana' }
      ]);
      expect(value).toBe('apple');
    } finally {
      (process.stdin as { isTTY?: boolean }).isTTY = origStdinTTY;
      (process.stdout as { isTTY?: boolean }).isTTY = origStdoutTTY;
    }
  });

  describe('runMenuSelectionLoop', () => {
    it('navigates with arrows and selects on return', async () => {
      const picker = await import('../src/ui/picker.js');
      const keys = [
        { input: '', key: { name: 'down' } },
        { input: '', key: { name: 'down' } },
        { input: '', key: { name: 'up' } },
        { input: '', key: { name: 'return' } }
      ];
      vi.spyOn(picker, 'readKey').mockImplementation(async () => {
        const next = keys.shift();
        if (!next) throw new Error('Unexpected keypress');
        return next;
      });

      const selected = await runMenuSelectionLoop(
        5,
        0,
        (idx) => [`item ${idx}`]
      );

      // 0 -> down (1) -> down (2) -> up (1) -> return => 1
      expect(selected).toBe(1);
    });

    it('wraps around index on boundaries with j and k', async () => {
      const picker = await import('../src/ui/picker.js');
      const keys = [
        { input: 'k', key: {} }, // 0 -> wraps to 2
        { input: '', key: { name: 'return' } }
      ];
      vi.spyOn(picker, 'readKey').mockImplementation(async () => {
        const next = keys.shift();
        if (!next) throw new Error('Unexpected keypress');
        return next;
      });

      const selected = await runMenuSelectionLoop(
        3,
        0,
        (idx) => [`item ${idx}`]
      );

      expect(selected).toBe(2);
    });

    it('supports direct digit jump via onInput', async () => {
      const picker = await import('../src/ui/picker.js');
      const keys = [
        { input: '3', key: {} }
      ];
      vi.spyOn(picker, 'readKey').mockImplementation(async () => {
        const next = keys.shift();
        if (!next) throw new Error('Unexpected keypress');
        return next;
      });

      const selected = await runMenuSelectionLoop(
        4,
        0,
        (idx) => [`item ${idx}`],
        {
          onInput: (input) => (input === '3' ? 2 : undefined)
        }
      );

      expect(selected).toBe(2);
    });

    it('cancels on Ctrl+C', async () => {
      const picker = await import('../src/ui/picker.js');
      vi.spyOn(picker, 'readKey').mockResolvedValueOnce({
        input: '',
        key: { ctrl: true, name: 'c' }
      });

      await expect(
        runMenuSelectionLoop(3, 0, (idx) => [`item ${idx}`])
      ).rejects.toThrow(CancelledError);
    });

    it('cancels on q when cancelOnQ is true', async () => {
      const picker = await import('../src/ui/picker.js');
      vi.spyOn(picker, 'readKey').mockResolvedValueOnce({
        input: 'q',
        key: {}
      });

      await expect(
        runMenuSelectionLoop(3, 0, (idx) => [`item ${idx}`], { cancelOnQ: true })
      ).rejects.toThrow(CancelledError);
    });
  });
});
