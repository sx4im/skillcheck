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
  const ext = path.extname(basename).toLowerCase();
  if (ext === '.mdc') {
    return 'mdc';
  }
  // Any Markdown file is accepted as a generic skill document.
  if (ext === '.md') {
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
    .filter((entry) => {
      if (!entry.isFile()) return false;
      const ext = path.extname(entry.name).toLowerCase();
      return ext === '.md' || ext === '.mdc';
    })
    .map((entry) => entry.name)
    .sort();
  if (markdown[0]) {
    const filePath = path.join(dirPath, markdown[0]);
    return { filePath, format: formatForFile(filePath) ?? 'markdown' };
  }
  return undefined;
}

async function resolveSkillFile(inputPath: string): Promise<{ filePath: string; format: SkillFormat }> {
  const stats = await stat(inputPath);
  if (stats.isDirectory()) {
    const found = await firstMarkdownInDir(inputPath);
    if (!found) {
      throw new Error(`No .md file found in ${inputPath}. Skillcheck only analyzes Markdown (.md, .mdc) and .cursorrules skill files.`);
    }
    return found;
  }

  const format = formatForFile(inputPath);
  if (!format) {
    throw new Error(`Skillcheck only analyzes Markdown (.md, .mdc) and .cursorrules files. "${path.basename(inputPath)}" is not supported.`);
  }
  return { filePath: inputPath, format };
}

function extractFrontMatter(rawText: string): Record<string, string> {
  // Normalize CRLF so skills authored on Windows parse the same as LF files.
  const text = rawText.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) {
    return {};
  }

  const end = text.indexOf('\n---', 4);
  if (end === -1) {
    return {};
  }

  const fields: Record<string, string> = {};
  const lines = text.slice(4, end).split('\n');
  for (let i = 0; i < lines.length; ) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]!.trim());
    if (!match) {
      i += 1;
      continue;
    }
    const key = match[1]!.toLowerCase();
    const inline = match[2]!.trim();
    // Block scalar (`>`, `|`, with optional chomping indicator): the value
    // lives on the following indented lines. Without this, `description: >`
    // would capture the marker itself as the value. Both styles fold to one
    // line — front-matter values here are used as single-line domains/labels.
    if (/^[|>][+-]?$/.test(inline)) {
      const folded: string[] = [];
      i += 1;
      while (i < lines.length && (lines[i]!.trim() === '' || /^\s+\S/.test(lines[i]!))) {
        if (lines[i]!.trim() !== '') {
          folded.push(lines[i]!.trim());
        }
        i += 1;
      }
      fields[key] = folded.join(' ');
      continue;
    }
    if (inline) {
      fields[key] = inline.replace(/^["']|["']$/g, '');
    }
    i += 1;
  }
  return fields;
}

function firstHeading(text: string): string | undefined {
  return text
    .split('\n')
    .map((line) => /^#\s+(.+)$/.exec(line.trim())?.[1]?.trim())
    .find(Boolean);
}

// Headings that describe the file rather than the engineering domain it
// governs. Official agent skills (CLAUDE.md, AGENTS.md, .cursorrules) almost
// always open with one of these, which would otherwise become the domain.
const GENERIC_HEADINGS = new Set([
  'claude.md',
  'agents.md',
  'skill.md',
  '.cursorrules',
  'cursorrules',
  'instructions',
  'guidelines',
  'rules',
  'overview',
  'developer guidelines'
]);

function isGenericHeading(heading: string, fileName?: string): boolean {
  const norm = heading.trim().toLowerCase().replace(/:$/, '');
  if (GENERIC_HEADINGS.has(norm)) {
    return true;
  }
  if (fileName) {
    const fileNorm = fileName.trim().toLowerCase();
    const fileBase = fileNorm.replace(/\.(md|mdc)$/, '');
    if (norm === fileNorm || norm === fileBase) {
      return true;
    }
  }
  return false;
}

function allHeadings(text: string): string[] {
  const headings: string[] = [];
  for (const line of text.split('\n')) {
    const match = /^#{1,6}\s+(.+)$/.exec(line.trim());
    if (match?.[1]?.trim()) {
      headings.push(match[1].trim());
    }
  }
  return headings;
}

function firstSubstantiveHeading(text: string, fileName?: string): string | undefined {
  return allHeadings(text).find((heading) => !isGenericHeading(heading, fileName));
}

function inferDomain(text: string, fileName?: string): string {
  return firstSubstantiveHeading(text, fileName) || 'general agent skill';
}

function extractDomain(text: string, fileName?: string): string {
  const frontMatter = extractFrontMatter(text);
  const declared =
    frontMatter.domain ||
    frontMatter.description ||
    frontMatter.when_to_use ||
    frontMatter['when-to-use'] ||
    frontMatter.name;
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

  return inferDomain(text, fileName);
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

function nameFromPath(filePath: string, format: SkillFormat): string {
  const base = path.basename(filePath);
  if (format === 'markdown' || format === 'mdc') {
    // A user-named file (e.g. frontend-design.md) is more meaningful than its
    // parent folder — turn "frontend-design.md" into "frontend design".
    const stem = base.replace(/\.(md|mdc)$/i, '').replace(/[-_]+/g, ' ').trim();
    return stem || path.basename(path.dirname(filePath)) || base;
  }
  // Conventional files (SKILL.md, AGENTS.md, …) take their identity from the folder.
  return path.basename(path.dirname(filePath)) || base;
}

/**
 * Detects whether a skill's instructions reference running scripts, shell commands,
 * or reading/writing files as part of its documented workflow.
 */
export function isToolDependent(instructions: string): boolean {
  if (!instructions || typeof instructions !== 'string') {
    return false;
  }

  // 1. Explicit command execution verbs + script targets
  const commandExecutionRegex =
    /\b(run|execute|exec|call|launch|invoke)\s+([`"']?[\w./-]+\.(sh|py|js|ts|rb|pl)[`"']?|bash|shell|terminal|script|scripts\/[\w./-]+)/i;
  if (commandExecutionRegex.test(instructions)) {
    return true;
  }

  // 2. Direct shell commands in text or code blocks
  const directShellRegex =
    /(^|\s|`)(bash|sh|zsh|python|python3|node|npm|npx|pytest|cargo|git|curl|wget)\s+([`"']?[\w./-]+\.(sh|py|js|ts|rb|pl|json|csv|md)|check|test|run|commit|checkout|install|build|package)(?=\s|`|$|\.|,)/im;
  if (directShellRegex.test(instructions)) {
    return true;
  }

  // 3. Executable script path invocation patterns
  const scriptPathRegex = /(^|\s|`)\.?\/?[\w./-]*scripts\/[\w./-]+\.(sh|py|js|ts|rb|pl)\b/im;
  if (scriptPathRegex.test(instructions)) {
    return true;
  }

  // 4. File Save operations (writing/saving to a file with an explicit extension)
  const fileSaveRegex =
    /\b(write|save|output|export)\s+.*?\b(to|into)\s+[`"']?[\w./-]+\.(json|csv|txt|yaml|yml|md|xml|html)[`"']?/i;
  if (fileSaveRegex.test(instructions)) {
    return true;
  }

  // 5. File Read operations (reading/loading from a file with an explicit extension)
  const fileReadRegex =
    /\b(read|load|parse)\s+.*?\b(from|of)\s+[`"']?[\w./-]+\.(json|csv|txt|yaml|yml|md|xml|html)[`"']?/i;
  if (fileReadRegex.test(instructions)) {
    return true;
  }

  // 6. Terminal / Shell environment usage phrases
  const toolEnvironmentRegex =
    /\b(using|via|in|from)\s+(the\s+)?(bash|terminal|shell|command line)\b/i;
  if (toolEnvironmentRegex.test(instructions)) {
    return true;
  }

  return false;
}

export async function normalizeSkill(
  inputPath: string,
  options?: { domain?: string }
): Promise<NormalizedSkill> {
  const { filePath, format } = await resolveSkillFile(inputPath);
  const instructions = await readFile(filePath, 'utf8');
  // Prefer a declared name (front matter), then the first heading, then the path.
  const name =
    extractFrontMatter(instructions).name || firstHeading(instructions) || nameFromPath(filePath, format);

  const explicitDomain = options?.domain
    ? options.domain.replace(/\s+/g, ' ').trim().slice(0, 200)
    : undefined;
  const domain =
    explicitDomain ||
    extractDomain(instructions, path.basename(filePath));

  return {
    name,
    sourcePath: filePath,
    format,
    instructions,
    domain,
    assets: await listAssets(filePath),
    versionHash: sha256(instructions),
    toolDependent: isToolDependent(instructions)
  };
}
