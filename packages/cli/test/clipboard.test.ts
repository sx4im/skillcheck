import { describe, expect, it } from 'vitest';
import { copyToClipboardOsc52, formatPrMarkdown, buildOsc52Sequence } from '../src/ui/clipboard.js';
import type { EvalResult } from '../src/eval.js';

describe('OSC 52 clipboard export', () => {
  it('builds standard OSC 52 sequence with base64 encoded text', () => {
    const text = 'hello world';
    const seq = buildOsc52Sequence(text, false);
    const b64 = Buffer.from(text, 'utf8').toString('base64');
    expect(seq).toBe(`\x1b]52;c;${b64}\x07`);
  });

  it('wraps sequence in DCS passthrough when inside tmux', () => {
    const text = 'tmux test';
    const seq = buildOsc52Sequence(text, true);
    const b64 = Buffer.from(text, 'utf8').toString('base64');
    expect(seq).toBe(`\x1bPtmux;\x1b\x1b]52;c;${b64}\x07\x1b\\`);
  });

  it('writes OSC 52 sequence to stream via copyToClipboardOsc52', () => {
    const chunks: string[] = [];
    const fakeStream = {
      write: (data: string) => {
        chunks.push(data);
        return true;
      }
    };
    const ok = copyToClipboardOsc52('copied content', fakeStream as unknown as NodeJS.WriteStream);
    expect(ok).toBe(true);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toContain(Buffer.from('copied content').toString('base64'));
  });

  it('formats comprehensive GitHub PR markdown from EvalResult', () => {
    const sampleResult: EvalResult = {
      skill: {
        name: 'TDD Workflow',
        source: 'skills/tdd/SKILL.md',
        format: 'SKILL.md',
        commit_hash: 'abc1234',
        domain: 'tdd',
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
        effect_pp: 25.0,
        mean_effect_pp: 25.0,
        satisfaction: 80.0,
        ci_pp: [8.0, 42.0],
        verdict: 'helps',
        with_skill_pass: 0.8,
        no_skill_pass: 0.55,
        token_overhead: 350,
        value_per_1k_tokens: 71.4
      },
      tasks: [
        {
          id: 't1',
          prompt: 'Write failing test first',
          criterion_type: 'rubric',
          criterion: 'Red-green-refactor cycle verified',
          with_skill_pass_rate: 1.0,
          no_skill_pass_rate: 0.5
        },
        {
          id: 't2',
          prompt: 'Refactor without breaking tests',
          criterion_type: 'rubric',
          criterion: 'Clean design and green tests',
          with_skill_pass_rate: 0.6,
          no_skill_pass_rate: 0.6
        }
      ],
      reproducibility: { transcript_hashes: ['h1', 'h2'] },
      history: [],
      run_date: '2026-10-01'
    };

    const markdown = formatPrMarkdown(sampleResult);
    expect(markdown).toContain('### 🧪 Skillcheck Evaluation: `TDD Workflow`');
    expect(markdown).toContain('**Verdict**: `HELPS`');
    expect(markdown).toContain('+25.0 pp');
    expect(markdown).toContain('80.0%');
    expect(markdown).toContain('55.0%');
    expect(markdown).toContain('+350 tokens');
    expect(markdown).toContain('<details>');
    expect(markdown).toContain('Per-task breakdown (2 tasks)');
    expect(markdown).toContain('github.com/sx4im/skillcheck');
  });
});
