import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from './hash.js';
import type { NormalizedSkill, SkillFormat } from './types.js';

const SUPPORTED_FILES: Array<{ file: string; format: SkillFormat }> = [
  { file: 'SKILL.md', format: 'SKILL.md' },
  { file: 'AGENTS.md', format: 'AGENTS.md' },
  { file: 'CLAUDE.md', format: 'CLAUDE.md' },
  { file: '.cursorrules', format: '.cursorrules' }
];

function formatForFile(filePath: string): SkillFormat | undefined {
  const basename = path.basename(filePath);
  const known = SUPPORTED_FILES.find((candidate) => candidate.file === basename);
  if (known) {
    return known.format;
  }
  // Any Markdown file is accepted as a generic skill document.
  if (path.extname(basename).toLowerCase() === '.md') {
    return 'markdown';
  }
  return undefined;
}

async function firstMarkdownInDir(dirPath: string): Promise<{ filePath: string; format: SkillFormat } | undefined> {
  // Prefer the conventional skill files, then fall back to the first *.md by name.
  for (const candidate of SUPPORTED_FILES) {
    const filePath = path.join(dirPath, candidate.file);
    try {
      if ((await stat(filePath)).isFile()) {
        return { filePath, format: candidate.format };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  const entries = await readdir(dirPath, { withFileTypes: true });
  const markdown = entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.md')
    .map((entry) => entry.name)
    .sort();
  if (markdown[0]) {
    return { filePath: path.join(dirPath, markdown[0]), format: 'markdown' };
  }
  return undefined;
}

async function resolveSkillFile(inputPath: string): Promise<{ filePath: string; format: SkillFormat }> {
  const stats = await stat(inputPath);
  if (stats.isDirectory()) {
    const found = await firstMarkdownInDir(inputPath);
    if (!found) {
      throw new Error(`No .md file found in ${inputPath}. Skillcheck only analyzes Markdown (.md) skill files.`);
    }
    return found;
  }

  const format = formatForFile(inputPath);
  if (!format) {
    throw new Error(`Skillcheck only analyzes Markdown (.md) files. "${path.basename(inputPath)}" is not a .md file.`);
  }
  return { filePath: inputPath, format };
}

function extractFrontMatter(text: string): Record<string, string> {
  if (!text.startsWith('---\n')) {
    return {};
  }

  const end = text.indexOf('\n---', 4);
  if (end === -1) {
    return {};
  }

  const fields: Record<string, string> = {};
  for (const line of text.slice(4, end).split('\n')) {
    const match = /^([A-Za-z0-9_-]+):\s*(.+)$/.exec(line.trim());
    if (match) {
      fields[match[1]!.toLowerCase()] = match[2]!.trim().replace(/^["']|["']$/g, '');
    }
  }
  return fields;
}

function firstHeading(text: string): string | undefined {
  return text
    .split('\n')
    .map((line) => /^#\s+(.+)$/.exec(line.trim())?.[1]?.trim())
    .find(Boolean);
}

function inferDomain(text: string): string {
  return firstHeading(text) || 'general agent skill';
}

function extractDomain(text: string): string {
  const frontMatter = extractFrontMatter(text);
  const declared =
    frontMatter.domain ||
    frontMatter.description ||
    frontMatter.when_to_use ||
    frontMatter['when-to-use'];
  if (declared) {
    return declared;
  }

  const descriptionLine = /^description:\s*(.+)$/im.exec(text)?.[1]?.trim();
  if (descriptionLine) {
    return descriptionLine;
  }

  const whenLine = /^(when_to_use|when to use|when-to-use):\s*(.+)$/im.exec(text)?.[2]?.trim();
  if (whenLine) {
    return whenLine;
  }

  return inferDomain(text);
}

async function listAssets(skillFilePath: string): Promise<string[]> {
  const dir = path.dirname(skillFilePath);
  const skillName = path.basename(skillFilePath);
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.name !== skillName && !entry.name.startsWith('.git'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export async function normalizeSkill(inputPath: string): Promise<NormalizedSkill> {
  const { filePath, format } = await resolveSkillFile(inputPath);
  const instructions = await readFile(filePath, 'utf8');
  const name = firstHeading(instructions) || path.basename(path.dirname(filePath)) || path.basename(filePath);

  return {
    name,
    sourcePath: filePath,
    format,
    instructions,
    domain: extractDomain(instructions),
    assets: await listAssets(filePath),
    versionHash: sha256(instructions)
  };
}
