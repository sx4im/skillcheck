import { describe, expect, it } from 'vitest';
import { parseCheckOptions } from '../src/cli.js';
import { formatResultCard, validateSkillInput } from '../src/ui.js';

describe('friendly CLI check command', () => {
  it('uses quick defaults without saving a result by default', () => {
    const options = parseCheckOptions(['node', 'skillcheck', 'check', './SKILL.md']);

    expect(options.evalOptions.inputPath).toBe('./SKILL.md');
    expect(options.evalOptions.tasks).toBe(3);
    expect(options.evalOptions.trials).toBe(2);
    expect(options.evalOptions.output).toBeUndefined();
    expect(options.evalOptions.saveArtifacts).toBe(false);
    expect(options.json).toBe(false);
  });

  it('accepts explicit output, task count, trial count, and JSON mode', () => {
    const options = parseCheckOptions([
      'node',
      'skillcheck',
      'check',
      './AGENTS.md',
      '--tasks',
      '5',
      '--trials',
      '4',
      '--output',
      'result.json',
      '--json'
    ]);

    expect(options.evalOptions.inputPath).toBe('./AGENTS.md');
    expect(options.evalOptions.tasks).toBe(5);
    expect(options.evalOptions.trials).toBe(4);
    expect(options.evalOptions.output).toBe('result.json');
    expect(options.evalOptions.saveArtifacts).toBe(true);
    expect(options.json).toBe(true);
  });

  it('formats a readable result summary', () => {
    const summary = formatResultCard(
      {
        skill: { name: 'Docs Skill' },
        config: { tasks: 3, trials: 2 },
        result: {
          verdict: 'helps',
          effect_pp: 25,
          ci_pp: [5, 45],
          with_skill_pass: 0.75,
          no_skill_pass: 0.5,
          token_overhead: 120
        }
      },
      'skillcheck-results/docs-skill.json'
    );

    expect(summary).toContain('Skill           Docs Skill');
    expect(summary).toContain('HELPS');
    expect(summary).toContain('25.0 pp');
    expect(summary).toContain('[5.0, 45.0] pp');
    expect(summary).toContain('Saved JSON      skillcheck-results/docs-skill.json');
  });

  it('rejects paths that are not supported skill files', async () => {
    await expect(validateSkillInput('/tmp/not-a-skill.md')).rejects.toThrow(/Please give me a path to/);
  });
});
