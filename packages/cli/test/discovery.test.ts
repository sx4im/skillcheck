import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findWorkspaceRoot, findWorkspaceSkills } from '../src/discovery.js';

describe('workspace discovery', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-discovery-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('finds git root traversing upwards from nested directory', async () => {
    const gitDir = path.join(tempDir, '.git');
    const nested = path.join(tempDir, 'packages', 'deep', 'sub');
    await mkdir(gitDir, { recursive: true });
    await mkdir(nested, { recursive: true });

    const root = findWorkspaceRoot(nested);
    expect(root).toBe(tempDir);
  });

  it('falls back to starting directory if no git root exists', async () => {
    const nested = path.join(tempDir, 'sub');
    await mkdir(nested, { recursive: true });

    const root = findWorkspaceRoot(nested);
    expect(root).toBe(nested);
  });

  it('discovers standard agent skill and instruction files in workspace', async () => {
    await writeFile(path.join(tempDir, 'CLAUDE.md'), '# Claude instructions');
    await writeFile(path.join(tempDir, '.cursorrules'), '# Cursor rules');
    await mkdir(path.join(tempDir, 'skills', 'review'), { recursive: true });
    await writeFile(path.join(tempDir, 'skills', 'review', 'SKILL.md'), '# Review skill');
    await mkdir(path.join(tempDir, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(path.join(tempDir, 'node_modules', 'pkg', 'SKILL.md'), '# Ignored skill');

    const skills = await findWorkspaceSkills(tempDir);
    const relPaths = skills.map((s) => s.relativePath).sort();

    expect(relPaths).toEqual(['.cursorrules', 'CLAUDE.md', path.join('skills', 'review', 'SKILL.md')]);
    expect(skills.every((s) => !s.relativePath.includes('node_modules'))).toBe(true);
  });

  it('returns empty array when no skill files are found', async () => {
    const emptyDir = path.join(tempDir, 'empty');
    await mkdir(emptyDir, { recursive: true });
    const skills = await findWorkspaceSkills(emptyDir);
    expect(skills).toEqual([]);
  });
});
