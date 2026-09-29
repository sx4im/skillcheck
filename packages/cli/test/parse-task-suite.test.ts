import { describe, expect, it } from 'vitest';
import { parseTaskSuite } from '../src/eval.js';

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
