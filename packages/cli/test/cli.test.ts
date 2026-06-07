import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
    expect(summary).toContain('The skill HELPED');
    expect(summary).toContain('+25.0 pp');
    expect(summary).toContain('+5.0 pp to +45.0 pp');
    expect(summary).toContain('Saved JSON      skillcheck-results/docs-skill.json');
    // +25pp effect -> 75/100 satisfaction -> "Good"
    expect(summary).toContain('Satisfaction');
    expect(summary).toContain('75/100');
    expect(summary).toContain('GOOD');
  });

  it('accepts any .md file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-validate-'));
    const md = path.join(dir, 'my-skill.md');
    await writeFile(md, '# My Skill\n\nDo the thing.\n');
    await expect(validateSkillInput(md)).resolves.toBe(md);
  });

  it('rejects files that are not Markdown', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-validate-'));
    const txt = path.join(dir, 'notes.txt');
    await writeFile(txt, 'not markdown');
    await expect(validateSkillInput(txt)).rejects.toThrow(/only checks Markdown/i);
  });

  it('rejects a missing path', async () => {
    await expect(validateSkillInput('/tmp/does-not-exist-skillcheck.md')).rejects.toThrow(/does not exist/i);
  });
});
