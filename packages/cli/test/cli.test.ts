import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCheckOptions } from '../src/cli.js';
import { loadUserConfig, logoutUser, saveUserConfig } from '../src/config.js';
import { formatFatalError, formatResultCard, validateSkillInput } from '../src/ui.js';
import { currentVersion, isNewerVersion } from '../src/update.js';

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
    // +25pp effect (no satisfaction field) -> falls back to 75.0/100 -> "Good"
    expect(summary).toContain('Satisfaction');
    expect(summary).toContain('75.0/100');
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

describe('logout', () => {
  let prevConfigDir: string | undefined;
  let prevToken: string | undefined;

  beforeEach(async () => {
    prevConfigDir = process.env.SKILLCHECK_CONFIG_DIR;
    prevToken = process.env.SKILLCHECK_TOKEN;
    delete process.env.SKILLCHECK_TOKEN;
    process.env.SKILLCHECK_CONFIG_DIR = await mkdtemp(path.join(tmpdir(), 'skillcheck-logout-'));
  });

  afterEach(() => {
    if (prevConfigDir === undefined) delete process.env.SKILLCHECK_CONFIG_DIR;
    else process.env.SKILLCHECK_CONFIG_DIR = prevConfigDir;
    if (prevToken === undefined) delete process.env.SKILLCHECK_TOKEN;
    else process.env.SKILLCHECK_TOKEN = prevToken;
  });

  it('removes a saved key but keeps a custom apiUrl', () => {
    saveUserConfig({ apiUrl: 'https://example.test/api', token: 'chk_live_seed' });
    const result = logoutUser();
    expect(result.removed).toBe(true);
    expect(result.envOverride).toBe(false);
    expect(loadUserConfig()).toEqual({ apiUrl: 'https://example.test/api' });
  });

  it('reports nothing to remove when no key is saved', () => {
    expect(logoutUser().removed).toBe(false);
  });

  it('flags an env-var key that logout cannot clear', () => {
    saveUserConfig({ token: 'chk_live_seed' });
    process.env.SKILLCHECK_TOKEN = 'chk_live_env';
    expect(logoutUser().envOverride).toBe(true);
  });
});

describe('quota upsell', () => {
  it('shows the pricing link when a run is refused for quota', () => {
    const error = Object.assign(new Error("You've used all 10 free Skillcheck runs."), { status: 402 });
    const message = formatFatalError(error);
    expect(message).toContain('Out of free runs');
    expect(message).toContain('#pricing');
  });

  it('keeps the generic failure message for non-quota errors', () => {
    const message = formatFatalError(new Error('Some other failure'));
    expect(message).toContain('Skillcheck stopped');
    expect(message).not.toContain('#pricing');
  });
});

describe('update notifier', () => {
  it('detects a strictly newer release across each version field', () => {
    expect(isNewerVersion('0.3.2', '0.3.1')).toBe(true);
    expect(isNewerVersion('0.4.0', '0.3.9')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
  });

  it('does not flag the same or an older version', () => {
    expect(isNewerVersion('0.3.1', '0.3.1')).toBe(false);
    expect(isNewerVersion('0.3.0', '0.3.1')).toBe(false);
    expect(isNewerVersion('0.2.9', '0.3.0')).toBe(false);
  });

  it('ignores prerelease suffixes when comparing', () => {
    expect(isNewerVersion('0.3.1', '0.3.1-beta.1')).toBe(false);
    expect(isNewerVersion('0.3.2', '0.3.1-beta.1')).toBe(true);
  });

  it('reports this package\'s own version', () => {
    expect(currentVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
