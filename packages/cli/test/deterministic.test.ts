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

  it('grades excludes deterministic assertions', () => {
    const task = {
      id: 'excludes',
      prompt: 'avoid lodash',
      criterionType: 'deterministic' as const,
      criterion: 'excludes:lodash'
    };

    expect(gradeDeterministically(task, 'const value = debounce(fn);')).toEqual({
      score: 1,
      reason: 'did not include lodash',
      pass: true
    });
    expect(gradeDeterministically(task, "import debounce from 'lodash';")).toEqual({
      score: 0,
      reason: 'forbidden text found: lodash',
      pass: false
    });
  });

  it('grades not_regex deterministic assertions across lines', () => {
    const task = {
      id: 'not-regex',
      prompt: 'avoid inline styles',
      criterionType: 'deterministic' as const,
      criterion: 'not_regex:style\\s*=\\s*\\{.*color:\\s*red'
    };

    expect(gradeDeterministically(task, '<div className="warning">Safe</div>').pass).toBe(true);
    expect(gradeDeterministically(task, '<div style={{\n  color: red\n}}>Unsafe</div>').pass).toBe(false);
  });

  it('supports empty negative assertions', () => {
    const excludes = {
      id: 'empty-excludes',
      prompt: 'empty exclusion',
      criterionType: 'deterministic' as const,
      criterion: 'excludes:'
    };
    const notRegex = { ...excludes, id: 'empty-not-regex', criterion: 'not_regex:' };

    expect(gradeDeterministically(excludes, 'anything').pass).toBe(false);
    expect(gradeDeterministically(notRegex, 'anything').pass).toBe(false);
  });
});
