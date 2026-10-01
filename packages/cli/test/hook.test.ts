import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  installGitHook,
  isPromptFilePath,
  preCommitScriptContent
} from '../src/hook.js';

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
