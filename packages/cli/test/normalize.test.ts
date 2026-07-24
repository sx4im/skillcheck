import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeSkill } from '../src/normalize.js';

describe('normalizeSkill', () => {
  it('normalizes SKILL.md front matter', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-normalize-'));
    await writeFile(
      path.join(dir, 'SKILL.md'),
      `---\ndescription: API documentation editing\n---\n# Doc Editor\n\nUse precise docs language.\n`
    );

    const skill = await normalizeSkill(dir);

    expect(skill.format).toBe('SKILL.md');
    expect(skill.name).toBe('Doc Editor');
    expect(skill.domain).toBe('API documentation editing');
    expect(skill.instructions).toContain('Use precise docs language.');
  });

  it('normalizes AGENTS.md by path', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-normalize-'));
    const file = path.join(dir, 'AGENTS.md');
    await writeFile(file, '# Agent Rules\n\ndescription: TypeScript migrations\n');

    const skill = await normalizeSkill(file);

    expect(skill.format).toBe('AGENTS.md');
    expect(skill.domain).toBe('TypeScript migrations');
  });

  it('normalizes .cursorrules by path', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-normalize-'));
    const file = path.join(dir, '.cursorrules');
    await writeFile(file, 'when_to_use: React accessibility reviews\n\nCheck labels and keyboard flow.');

    const skill = await normalizeSkill(file);

    expect(skill.format).toBe('.cursorrules');
    expect(skill.domain).toBe('React accessibility reviews');
  });

  it('normalizes CLAUDE.md for awesome-claude-md corpus entries', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-normalize-'));
    await writeFile(path.join(dir, 'CLAUDE.md'), '# Next.js Rules\n\ndescription: Next.js app development\n');

    const skill = await normalizeSkill(dir);

    expect(skill.format).toBe('CLAUDE.md');
    expect(skill.domain).toBe('Next.js app development');
  });

  it('parses front matter in CRLF (Windows) files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-normalize-'));
    await writeFile(
      path.join(dir, 'SKILL.md'),
      `---\r\nname: CRLF Skill\r\ndescription: Windows line endings\r\n---\r\n# Heading\r\n\r\nBody.\r\n`
    );

    const skill = await normalizeSkill(dir);

    expect(skill.name).toBe('CRLF Skill');
    expect(skill.domain).toBe('Windows line endings');
  });

  it('uses only the heading when no domain is declared', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-normalize-'));
    await writeFile(
      path.join(dir, 'CLAUDE.md'),
      '# Rust Project Rules\n\nNever reveal this body-only lint instruction to task generation.\n'
    );

    const skill = await normalizeSkill(dir);

    expect(skill.domain).toBe('Rust Project Rules');
    expect(skill.domain).not.toContain('lint instruction');
  });

  it('derives a readable name from a markdown filename', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-norm-'));
    const file = path.join(dir, 'frontend-design.md');
    await writeFile(file, 'Plain markdown body with no heading.\n');
    const skill = await normalizeSkill(file);
    expect(skill.format).toBe('markdown');
    expect(skill.name).toBe('frontend design');
    expect(skill.domain).toBe('general agent skill');
  });

  it('falls back to the first .md by name inside a folder', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-norm-'));
    await writeFile(path.join(dir, 'zeta.md'), '# Zeta\n');
    await writeFile(path.join(dir, 'alpha.md'), '# Alpha\n');
    const skill = await normalizeSkill(dir);
    expect(skill.name).toBe('Alpha'); // sorted, first by name
  });

  it('rejects a folder with no markdown and a non-markdown file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-norm-'));
    await writeFile(path.join(dir, 'notes.txt'), 'nope');
    await expect(normalizeSkill(dir)).rejects.toThrow(/No \.md file/);
    await expect(normalizeSkill(path.join(dir, 'notes.txt'))).rejects.toThrow(/only analyzes Markdown/);
  });
});
