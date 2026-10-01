import { describe, expect, it, vi } from 'vitest';
import { parseTaskSuite, selectSuiteTasks } from '../src/eval.js';
import type { GeneratedTask } from '../src/types.js';

function suite(tasks: Array<Record<string, unknown>>): string {
  return JSON.stringify(tasks);
}

describe('parseTaskSuite deterministic criteria', () => {
  it('accepts valid regex, not_regex, includes, and excludes criteria', () => {
    const tasks = parseTaskSuite(
      suite([
        { id: 't1', prompt: 'p', criterionType: 'deterministic', criterion: 'regex:^\\s*TOKEN\\s*$' },
        { id: 't2', prompt: 'p', criterionType: 'deterministic', criterion: 'not_regex:secret' },
        { id: 't3', prompt: 'p', criterionType: 'deterministic', criterion: 'includes:TOKEN' },
        { id: 't4', prompt: 'p', criterionType: 'deterministic', criterion: 'excludes:lodash' },
        { id: 't5', prompt: 'p', criterionType: 'rubric', criterion: 'any rubric text' }
      ])
    );
    expect(tasks).toHaveLength(5);
    expect(tasks[0]!.criterionType).toBe('deterministic');
  });

  it('rejects an invalid regex criterion before any model calls happen', () => {
    expect(() =>
      parseTaskSuite(suite([{ id: 'bad-regex', prompt: 'p', criterionType: 'deterministic', criterion: 'regex:(' }]))
    ).toThrow(/Invalid regex in deterministic criterion of task bad-regex/);
  });

  it('rejects an invalid not_regex criterion and names the task', () => {
    expect(() =>
      parseTaskSuite(
        suite([{ prompt: 'p', criterionType: 'deterministic', criterion: 'not_regex:[unclosed' }])
      )
    ).toThrow(/Invalid regex in deterministic criterion of task t001/);
  });

  it('still rejects unknown criterion types', () => {
    expect(() =>
      parseTaskSuite(suite([{ prompt: 'p', criterionType: 'fuzzy', criterion: 'whatever' }]))
    ).toThrow(/Unsupported criterion type/);
  });
});

describe('selectSuiteTasks explicit-suite handling', () => {
  const makeSuite = (n: number): GeneratedTask[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `t${i + 1}`,
      prompt: 'p',
      criterionType: 'rubric',
      criterion: 'criterion text'
    }));

  it('uses the full suite when --tasks was not passed explicitly', () => {
    const selected = selectSuiteTasks(makeSuite(10), { tasks: 3 });
    expect(selected).toHaveLength(10);
  });

  it('uses the full suite when tasksExplicit is false', () => {
    const selected = selectSuiteTasks(makeSuite(10), { tasks: 3, tasksExplicit: false });
    expect(selected).toHaveLength(10);
  });

  it('truncates with a loud warning when --tasks was passed explicitly', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const selected = selectSuiteTasks(makeSuite(10), { tasks: 4, tasksExplicit: true });
      expect(selected).toHaveLength(4);
      expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/--task-suite has 10 tasks but --tasks=4/));
    } finally {
      errSpy.mockRestore();
    }
  });

  it('does not warn when the explicit --tasks covers the whole suite', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const selected = selectSuiteTasks(makeSuite(3), { tasks: 5, tasksExplicit: true });
      expect(selected).toHaveLength(3);
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });
});
