import { describe, expect, it } from 'vitest';
import { renderInspectorScreen } from '../src/ui/inspector.js';
import type { EvalResult } from '../src/eval.js';

describe('Skillcheck Lens terminal inspector', () => {
  const sampleResult: EvalResult = {
    skill: {
      name: 'Security Guard',
      source: 'SKILL.md',
      format: 'SKILL.md',
      commit_hash: '1234567',
      domain: 'security',
      tool_dependent: false
    },
    config: {
      runner_model: 'claude-3-5-sonnet',
      grader_model: 'gpt-4o',
      generator_model: 'gpt-4o',
      trials: 3,
      tasks: 2,
      temperature: 0,
      mode: 'forced'
    },
    result: {
      effect_pp: 33.3,
      mean_effect_pp: 33.3,
      satisfaction: 82.0,
      ci_pp: [10.0, 56.6],
      verdict: 'helps',
      with_skill_pass: 0.833,
      no_skill_pass: 0.5,
      token_overhead: 450,
      value_per_1k_tokens: 74.0
    },
    tasks: [
      {
        id: 't1',
        prompt: 'Prevent SQL injection in query builder',
        criterion_type: 'rubric',
        criterion: 'Uses parameterized query',
        with_skill_pass_rate: 1.0,
        no_skill_pass_rate: 0.33
      },
      {
        id: 't2',
        prompt: 'Sanitize HTML input to block XSS',
        criterion_type: 'rubric',
        criterion: 'Escapes script tags',
        with_skill_pass_rate: 0.67,
        no_skill_pass_rate: 0.67
      }
    ],
    reproducibility: { transcript_hashes: ['h1', 'h2'] },
    history: [],
    run_date: '2026-10-01'
  };

  it('renders inspector screen with task list and active task details', () => {
    const lines = renderInspectorScreen(sampleResult, 0, 80);
    const content = lines.join('\n');

    expect(content).toContain('Skillcheck Lens');
    expect(content).toContain('Security Guard');
    expect(content).toContain('Task 1');
    expect(content).toContain('Prevent SQL injection');
    expect(content).toContain('Uses parameterized query');
    expect(content).toContain('With Skill');
    expect(content).toContain('Without Skill');
    expect(content).toContain('100.0%');
    expect(content).toContain('33.0%');
  });

  it('updates rendered details when another task index is selected', () => {
    const lines = renderInspectorScreen(sampleResult, 1, 80);
    const content = lines.join('\n');

    expect(content).toContain('Task 2');
    expect(content).toContain('Sanitize HTML input');
    expect(content).toContain('Escapes script tags');
  });
});
