import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LlmClient } from '../src/adapters/types.js';
import { JsonCache } from '../src/cache.js';
import { generateTasks } from '../src/generate.js';
import { isToolDependent, normalizeSkill } from '../src/normalize.js';
import { testProviderConfig } from './helpers.js';

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

  it('normalizes .cursor/rules/*.mdc by path and folder', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-normalize-'));
    const rulesDir = path.join(dir, '.cursor', 'rules');
    await mkdir(rulesDir, { recursive: true });
    const file = path.join(rulesDir, 'api.mdc');
    await writeFile(file, '---\ndescription: API documentation editing\n---\n# API Guide\n\nUse precise docs language.\n');

    const skill = await normalizeSkill(file);
    expect(skill.format).toBe('mdc');
    expect(skill.name).toBe('API Guide');
    expect(skill.domain).toBe('API documentation editing');

    const dirSkill = await normalizeSkill(rulesDir);
    expect(dirSkill.format).toBe('mdc');
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

  it('skips a generic CLAUDE.md heading for a substantive secondary heading', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-normalize-'));
    const file = path.join(dir, 'CLAUDE.md');
    await writeFile(file, '# CLAUDE.md\n\n## TypeScript & React Best Practices\n\nFollow these rules.\n');

    const skill = await normalizeSkill(file);

    expect(skill.domain).toBe('TypeScript & React Best Practices');
  });

  it('falls back to general agent skill when every heading is generic', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-normalize-'));
    const file = path.join(dir, 'AGENTS.md');
    await writeFile(file, '# AGENTS.md\n\nInstructions for building Golang microservices.\n');

    const skill = await normalizeSkill(file);

    expect(skill.domain).toBe('general agent skill');
  });

  it('falls back to general agent skill when no substantive heading exists', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-normalize-'));
    const skillDir = path.join(dir, 'my-skill');
    await mkdir(skillDir);
    const file = path.join(skillDir, 'CLAUDE.md');
    await writeFile(file, '# Instructions\n');

    const skill = await normalizeSkill(file);

    expect(skill.domain).toBe('general agent skill');
  });

  it('derives a readable name from a markdown filename without using body prose for domain', async () => {
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

  it('never uses sentences from the skill body as declared domain for headingless AGENTS.md', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-normalize-'));
    const file = path.join(dir, 'AGENTS.md');
    const firstLine = 'Always answer in formal English and never use contractions.';
    await writeFile(file, `${firstLine}\n\nAdditional instructions for the agent.\n`);

    const skill = await normalizeSkill(file);

    expect(skill.domain).not.toContain(firstLine);
    expect(skill.domain).toBe('general agent skill');
  });

  it('asserts the generator request contains no sentence from the skill body', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-normalize-'));
    const file = path.join(dir, 'AGENTS.md');
    const firstLine = 'Always answer in formal English and never use contractions.';
    await writeFile(file, `${firstLine}\n\nAdditional instructions.\n`);

    const skill = await normalizeSkill(file);
    let capturedUserPrompt = '';
    const fakeClient = {
      complete: async (req: { messages: Array<{ role: string; content: string }> }) => {
        capturedUserPrompt = req.messages[1]?.content ?? '';
        return {
          content: '{"tasks":[{"id":"t1","prompt":"test","criterion":"crit"}]}',
          model: 'gen',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
        };
      }
    } as unknown as LlmClient;

    await generateTasks({ domain: skill.domain, count: 1 }, testProviderConfig, fakeClient, JsonCache.disabled());

    expect(capturedUserPrompt).not.toContain(firstLine);
    expect(capturedUserPrompt).toContain('Declared domain:\ngeneral agent skill');
  });

  it('overrides inferred domain when explicit domain option is provided', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-normalize-'));
    const file = path.join(dir, 'AGENTS.md');
    await writeFile(file, '# Agent Rules\n\nSome body text.\n');

    const skill = await normalizeSkill(file, { domain: 'Explicit Custom Domain' });

    expect(skill.domain).toBe('Explicit Custom Domain');
  });

  it('collapses whitespace and newlines in domain option', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-normalize-'));
    const file = path.join(dir, 'AGENTS.md');
    await writeFile(file, '# Agent Rules\n\nSome body text.\n');

    const skill = await normalizeSkill(file, { domain: '  TypeScript   \n\n  migration  and   refactoring \t rules  ' });

    expect(skill.domain).toBe('TypeScript migration and refactoring rules');
  });

  it('caps domain option at 200 characters', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-normalize-'));
    const file = path.join(dir, 'AGENTS.md');
    await writeFile(file, '# Agent Rules\n\nSome body text.\n');

    const longDomain = 'a'.repeat(250);
    const skill = await normalizeSkill(file, { domain: longDomain });

    expect(skill.domain).toBe('a'.repeat(200));
    expect(skill.domain).toHaveLength(200);
  });

  it('caps domain option by code points so an emoji at the 200-character boundary is preserved', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-normalize-'));
    const file = path.join(dir, 'AGENTS.md');
    await writeFile(file, '# Agent Rules\n\nSome body text.\n');

    const domainWithEmojiAtBoundary = 'a'.repeat(199) + '🎯';
    const skill = await normalizeSkill(file, { domain: domainWithEmojiAtBoundary });

    expect(skill.domain).toBe('a'.repeat(199) + '🎯');
  });

  it('produces byte-identical generator prompt for files with front matter', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-normalize-'));
    const file = path.join(dir, 'SKILL.md');
    await writeFile(
      file,
      `---\nname: doc-editor\ndescription: API documentation editing\n---\n# Doc Editor\n\nUse precise docs language.\n`
    );

    const skill = await normalizeSkill(file);
    let capturedUserPrompt = '';
    const fakeClient = {
      complete: async (req: { messages: Array<{ role: string; content: string }> }) => {
        capturedUserPrompt = req.messages[1]?.content ?? '';
        return {
          content: '{"tasks":[{"id":"t1","prompt":"test","criterion":"crit"}]}',
          model: 'gen',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
        };
      }
    } as unknown as LlmClient;

    await generateTasks({ domain: skill.domain, count: 3 }, testProviderConfig, fakeClient, JsonCache.disabled());

    const expectedPrompt = `Declared domain:\nAPI documentation editing\n\nGenerate 6 concise tasks. Return exactly {"tasks":[{"id":"t1","prompt":"one concrete task under 80 words","criterion":"one pass/fail rubric under 60 words"}]}. Keep every criterion a single string, not an array. Do not include markdown or commentary.`;
    expect(capturedUserPrompt).toBe(expectedPrompt);
  });
});

describe('isToolDependent detection heuristic', () => {
  it('detects tool dependency when instructions reference script execution or file saving', () => {
    expect(isToolDependent('Save test cases to `evals/evals.json`')).toBe(true);
    expect(isToolDependent('Run `python3 scripts/quick_validate.py` to validate.')).toBe(true);
    expect(isToolDependent('Execute `git commit -m "feat: add"` in terminal')).toBe(true);
  });

  it('does not flag pure prompt guidelines, rhetorical mentions, or passive file reading without extensions', () => {
    expect(isToolDependent('Always write a failing test before writing code.')).toBe(false);
    expect(isToolDependent('Read the uploaded resume file the user provided, then write a summary... Do not save anything')).toBe(false);
    expect(isToolDependent('Analyze the situation using the tool of structured thinking and form a hypothesis.')).toBe(false);
    expect(isToolDependent('Templates live in scripts/ directory for reference.')).toBe(false);
  });
});
