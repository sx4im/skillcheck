import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/eval.js', () => ({
  evalSkill: vi.fn()
}));

import { evalSkill } from '../src/eval.js';
import {
  installGitHook,
  isPromptFilePath,
  preCommitScriptContent,
  runPreCommitCheck
} from '../src/hook.js';

const execFileAsync = promisify(execFile);
const mockedEvalSkill = vi.mocked(evalSkill);

function fakeEvalResult(verdict: 'helps' | 'placebo' | 'harms', effect_pp = 5) {
  return { result: { verdict, effect_pp } } as unknown as Awaited<ReturnType<typeof evalSkill>>;
}

describe('git pre-commit hook gating', () => {
  let tempDir: string;
  let gitDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-hook-'));
    gitDir = path.join(tempDir, '.git');
    await mkdir(gitDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('identifies agent prompt files correctly', () => {
    expect(isPromptFilePath('CLAUDE.md')).toBe(true);
    expect(isPromptFilePath('.cursorrules')).toBe(true);
    expect(isPromptFilePath('.cursor/rules/api.mdc')).toBe(true);
    expect(isPromptFilePath('.claude/skills/review.md')).toBe(true);
    expect(isPromptFilePath('skills/tdd/SKILL.md')).toBe(true);
    expect(isPromptFilePath('package.json')).toBe(false);
    expect(isPromptFilePath('src/index.ts')).toBe(false);
    expect(isPromptFilePath('node_modules/pkg/SKILL.md')).toBe(false);
    expect(isPromptFilePath('results/tasks/123.json')).toBe(false);
  });

  it('generates pre-commit hook script with skip bypass check', () => {
    const script = preCommitScriptContent();
    expect(script).toContain('#!/bin/sh');
    expect(script).toContain('SKILLCHECK_SKIP_HOOK');
    expect(script).toContain('skillcheck hook run');
  });

  it('installs pre-commit hook into .git/hooks directory and makes it executable', async () => {
    const res = installGitHook(tempDir);
    expect(res.installed).toBe(true);
    expect(res.path).toContain('pre-commit');

    const { readFile } = await import('node:fs/promises');
    const content = await readFile(res.path, 'utf8');
    expect(content).toContain('skillcheck hook run');
  });

  it('is idempotent and does not duplicate hook script on re-installation', async () => {
    const first = installGitHook(tempDir);
    const { readFile } = await import('node:fs/promises');
    const firstContent = await readFile(first.path, 'utf8');

    const second = installGitHook(tempDir);
    expect(second.installed).toBe(true);
    const secondContent = await readFile(second.path, 'utf8');

    expect(secondContent).toBe(firstContent);
  });
});

describe('runPreCommitCheck', () => {
  let repoDir: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    repoDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-hook-eval-'));
    await execFileAsync('git', ['init'], { cwd: repoDir });
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  async function stageSkillFile(relPath: string, stagedContent: string, workingContent?: string) {
    const fullPath = path.join(repoDir, relPath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, stagedContent, 'utf8');
    await execFileAsync('git', ['add', relPath], { cwd: repoDir });
    if (workingContent !== undefined) {
      await writeFile(fullPath, workingContent, 'utf8');
    }
  }

  it('fails closed when every evaluation errors instead of reporting a false pass', async () => {
    await stageSkillFile('SKILL.md', '# Skill\nDo the thing.');
    mockedEvalSkill.mockRejectedValue(new Error('provider rate limited'));

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await runPreCommitCheck({ cwd: repoDir });
      expect(result.passed).toBe(false);
      expect(result.message).toContain('SKILL.md');
      expect(result.message).toMatch(/could not evaluate/i);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('evaluates the staged blob, not the working-tree file', async () => {
    const staged = '# Skill\nVersion A (staged).';
    const working = '# Skill\nVersion B (unstaged edits).';
    await stageSkillFile('SKILL.md', staged, working);

    const evaluatedContents: string[] = [];
    mockedEvalSkill.mockImplementation(async (opts) => {
      const { readFile } = await import('node:fs/promises');
      evaluatedContents.push(await readFile(opts.inputPath, 'utf8'));
      return fakeEvalResult('helps');
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const result = await runPreCommitCheck({ cwd: repoDir });
      expect(result.passed).toBe(true);
    } finally {
      logSpy.mockRestore();
    }

    expect(evaluatedContents).toHaveLength(1);
    expect(evaluatedContents[0]).toBe(staged);
  });

  it('still rejects a HARMS verdict', async () => {
    await stageSkillFile('SKILL.md', '# Skill\nDo the thing.');
    mockedEvalSkill.mockResolvedValue(fakeEvalResult('harms', -30));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const result = await runPreCommitCheck({ cwd: repoDir });
      expect(result.passed).toBe(false);
      expect(result.message).toMatch(/HARMS/);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('skips cleanly when no prompt files are staged', async () => {
    await writeFile(path.join(repoDir, 'notes.txt'), 'hello', 'utf8');
    await execFileAsync('git', ['add', 'notes.txt'], { cwd: repoDir });

    const result = await runPreCommitCheck({ cwd: repoDir });
    expect(result.passed).toBe(true);
    expect(mockedEvalSkill).not.toHaveBeenCalled();
  });
});
