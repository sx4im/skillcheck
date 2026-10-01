import { mkdtemp, writeFile } from 'node:fs/promises';
import { evalResultFixture } from './eval-result-fixture.js';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main, parseCheckOptions, parseEvalOptions } from '../src/cli.js';
import { loadUserConfig, logoutUser, saveUserConfig } from '../src/config.js';
import { formatFatalError, formatResultCard, validateSkillInput } from '../src/ui.js';
import { currentVersion, isNewerVersion } from '../src/update.js';

describe('friendly CLI check command', () => {
  it('uses quick defaults without saving a result by default', () => {
    const options = parseCheckOptions(['node', 'skillcheck', 'check', './SKILL.md']);

    expect(options.evalOptions.inputPath).toBe('./SKILL.md');
    expect(options.evalOptions.tasks).toBe(3);
    expect(options.evalOptions.trials).toBe(3);
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

  it('accepts options before or after the skill path', () => {
    const optsBefore = parseCheckOptions(['node', 'skillcheck', '--explain', './SKILL.md', '--tasks', '5'], 2);
    expect(optsBefore.evalOptions.inputPath).toBe('./SKILL.md');
    expect(optsBefore.evalOptions.explain).toBe(true);
    expect(optsBefore.evalOptions.tasks).toBe(5);

    const optsAfter = parseCheckOptions(['node', 'skillcheck', 'check', '--explain', './SKILL.md'], 3);
    expect(optsAfter.evalOptions.inputPath).toBe('./SKILL.md');
    expect(optsAfter.evalOptions.explain).toBe(true);
  });

  it.each([2, 3])('accepts inline values before and after the path (start index %i)', (startIndex) => {
    const prefix = startIndex === 3 ? ['node', 'skillcheck', 'check'] : ['node', 'skillcheck'];
    const inline = [...prefix, '--tasks=5', './SKILL.md', '--trials=2', '--concurrency=3', '--json'];
    const separated = [...prefix, '--tasks', '5', './SKILL.md', '--trials', '2', '--concurrency', '3', '--json'];

    expect(parseCheckOptions(inline, startIndex)).toEqual(parseCheckOptions(separated, startIndex));
    expect(parseCheckOptions(inline, startIndex).effortPinned).toBe(true);
  });

  it('preserves equals signs in string option values and the skill path', () => {
    const options = parseCheckOptions([
      'node', 'skillcheck', 'check', './name=value.md',
      '--output=results/run=a=b.json', '--runner=provider/model=v1',
      '--grader=grader=v2', '--generator=generator=v3', '--task-suite=suite=a.json'
    ]);

    expect(options.evalOptions).toMatchObject({
      inputPath: './name=value.md',
      output: 'results/run=a=b.json',
      runner: 'provider/model=v1',
      grader: 'grader=v2',
      generator: 'generator=v3',
      taskSuite: 'suite=a.json',
      saveArtifacts: true
    });
  });

  it.each([
    ['--tasks=', /Missing value for --tasks/],
    ['--tasks=0', /--tasks must be a positive integer/],
    ['--tasks=1.5', /--tasks must be a positive integer/],
    ['--tasks=300', /--tasks must be at most 50/],
    ['--trials=99', /--trials must be at most 10/],
    ['--task=5', /Unknown option --task=5/],
    ['--json=true', /Unknown option --json=true/]
  ])('rejects invalid inline argument %s', (argument, error) => {
    expect(() => parseCheckOptions(['node', 'skillcheck', 'check', './SKILL.md', argument])).toThrow(error);
  });

  it.each([
    ['--tasks=5', '--tasks', '2'],
    ['--tasks', '5', '--tasks=2']
  ])('keeps the first value when option formats are mixed: %j', (...args) => {
    expect(parseCheckOptions(['node', 'skillcheck', 'check', './SKILL.md', ...args]).evalOptions.tasks).toBe(5);
  });

  it('supports matrix command option parsing before or after path', () => {
    const matrixOptsAfter = parseCheckOptions(['node', 'skillcheck', 'matrix', './SKILL.md', '--tasks', '5'], 3);
    expect(matrixOptsAfter.evalOptions.inputPath).toBe('./SKILL.md');
    expect(matrixOptsAfter.evalOptions.tasks).toBe(5);

    const matrixOptsBefore = parseCheckOptions(['node', 'skillcheck', 'matrix', '--tasks', '5', './SKILL.md'], 3);
    expect(matrixOptsBefore.evalOptions.inputPath).toBe('./SKILL.md');
    expect(matrixOptsBefore.evalOptions.tasks).toBe(5);
  });

  it('formats a readable result summary', () => {
    const summary = formatResultCard(
      evalResultFixture({
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
      }),
      'skillcheck-results/docs-skill.json'
    );

    expect(summary).toMatch(/Skill\s+Docs Skill/);
    expect(summary).toContain('HELPS');
    expect(summary).toContain('The skill HELPED');
    expect(summary).toContain('+25.0 pp');
    expect(summary).toContain('+5.0 pp to +45.0 pp');
    expect(summary).toMatch(/Saved JSON\s+skillcheck-results\/docs-skill\.json/);
    // The typed result supplies satisfaction explicitly.
    expect(summary).toContain('Satisfaction');
    expect(summary).toContain('75.0/100');
    expect(summary).toContain('GOOD');
  });

  it('pins effort only when --tasks or --trials is given (else the run asks interactively)', () => {
    expect(parseCheckOptions(['node', 'skillcheck', 'check', './SKILL.md']).effortPinned).toBe(false);
    expect(parseCheckOptions(['node', 'skillcheck', 'check', './SKILL.md', '--tasks', '5']).effortPinned).toBe(true);
    expect(parseCheckOptions(['node', 'skillcheck', 'check', './SKILL.md', '--trials', '3']).effortPinned).toBe(true);
  });

  it('rejects mistyped options instead of silently ignoring them', () => {
    expect(() => parseCheckOptions(['node', 'skillcheck', 'check', './SKILL.md', '--task', '5'])).toThrow(
      /Unknown option --task/
    );
  });

  it('caps tasks and trials at sane bounds', () => {
    expect(() => parseCheckOptions(['node', 'skillcheck', 'check', './SKILL.md', '--tasks', '300'])).toThrow(
      /--tasks must be at most 50/
    );
    expect(() => parseCheckOptions(['node', 'skillcheck', 'check', './SKILL.md', '--trials', '99'])).toThrow(
      /--trials must be at most 10/
    );
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

describe('help', () => {
  async function runMain(argv: string[]): Promise<string> {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map((arg) => String(arg)).join(' '));
    });
    try {
      await main(argv);
    } finally {
      spy.mockRestore();
    }
    return logs.join('\n');
  }

  it('prints usage for `--help`', async () => {
    const out = await runMain(['node', 'skillcheck', '--help']);
    expect(out).toMatch(/Usage/);
    expect(out).toMatch(/Commands/);
  });

  it('prints usage for `check --help` instead of erroring on a missing path', async () => {
    const out = await runMain(['node', 'skillcheck', 'check', '--help']);
    expect(out).toMatch(/Usage/);
    expect(out).toMatch(/check <path>/);
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

  it('runs demo command without throwing', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await main(['node', 'skillcheck', 'demo']);
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('prints general help when running `help`', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await main(['node', 'skillcheck', 'help']);
      expect(logSpy).toHaveBeenCalled();
      const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(output).toContain('Usage');
      expect(output).toContain('Commands');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('prints command-specific help for `help check` and `check --help`', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await main(['node', 'skillcheck', 'help', 'check']);
      const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(output).toContain('Skillcheck check');
      expect(output).toContain('--tasks');
      expect(output).toContain('--trials');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('suggests closest match on mistyped command', async () => {
    await expect(main(['node', 'skillcheck', 'chek'])).rejects.toThrow(
      /Unknown command: chek[\s\S]*Did you mean: `skillcheck check`\?/
    );
  });

  it('outputs completion script when running `completion`', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await main(['node', 'skillcheck', 'completion', 'bash']);
      expect(writeSpy).toHaveBeenCalled();
      const output = writeSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('_skillcheck_completions()');
    } finally {
      writeSpy.mockRestore();
    }
  });

  it('accepts --clipboard flag in check options', () => {
    const opts = parseCheckOptions(['node', 'skillcheck', 'check', './SKILL.md', '--clipboard']);
    expect(opts.clipboard).toBe(true);
  });

  it('accepts --resume and --inspect flags in check options', () => {
    const opts = parseCheckOptions(['node', 'skillcheck', 'check', './SKILL.md', '--resume', '--inspect']);
    expect(opts.evalOptions.resume).toBe(true);
    expect(opts.inspect).toBe(true);
  });

  it('accepts --resume in eval options (was previously rejected as unknown)', () => {
    const opts = parseEvalOptions(['node', 'skillcheck', 'eval', './SKILL.md', '--resume']);
    expect(opts.resume).toBe(true);
    expect(opts.inputPath).toBe('./SKILL.md');
  });

  it('detects explicit --tasks in both --tasks N and --tasks=N forms', () => {
    const implicit = parseEvalOptions(['node', 'skillcheck', 'eval', './SKILL.md']);
    expect(implicit.tasksExplicit).toBe(false);

    const spaceForm = parseEvalOptions(['node', 'skillcheck', 'eval', './SKILL.md', '--tasks', '5']);
    expect(spaceForm.tasks).toBe(5);
    expect(spaceForm.tasksExplicit).toBe(true);

    const equalsForm = parseEvalOptions(['node', 'skillcheck', 'eval', './SKILL.md', '--tasks=7']);
    expect(equalsForm.tasks).toBe(7);
    expect(equalsForm.tasksExplicit).toBe(true);
  });

  it('handles help for watch and hook commands', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await main(['node', 'skillcheck', 'help', 'watch']);
      expect(logSpy).toHaveBeenCalled();
      const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(output).toContain('Skillcheck watch');

      logSpy.mockClear();
      await main(['node', 'skillcheck', 'help', 'hook']);
      const hookOutput = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(hookOutput).toContain('Skillcheck hook');
    } finally {
      logSpy.mockRestore();
    }
  });
});
