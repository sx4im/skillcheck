import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export interface DiscoveredSkill {
  name: string;
  path: string;
  relativePath: string;
  format: string;
}

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.cache',
  '.next',
  'coverage',
  '.turbo'
]);

const CONVENTIONAL_NAMES = new Set([
  'skill.md',
  'claude.md',
  '.cursorrules',
  'agents.md',
  'copilot-instructions.md'
]);

/**
 * Traverse upward from startDir to locate the Git repository root.
 * Falls back to startDir if no .git directory exists.
 */
export function findWorkspaceRoot(startDir = process.cwd()): string {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;

  while (current !== root) {
    if (existsSync(path.join(current, '.git'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // Check filesystem root as well
  if (existsSync(path.join(root, '.git'))) {
    return root;
  }

  return path.resolve(startDir);
}

/**
 * Recursively scan a workspace directory for agent skills and prompt files.
 * Ignores build artifacts and node_modules to keep search bounded and fast (<50ms).
 */
export async function findWorkspaceSkills(root = findWorkspaceRoot(), maxDepth = 4): Promise<DiscoveredSkill[]> {
  const discovered: DiscoveredSkill[] = [];
  const baseDir = path.resolve(root);

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (
        IGNORED_DIRECTORIES.has(entry) ||
        (entry.startsWith('.') && entry !== '.cursorrules' && entry !== '.cursor' && entry !== '.claude')
      ) {
        continue;
      }

      const fullPath = path.join(dir, entry);
      let entryStat;
      try {
        entryStat = await stat(fullPath);
      } catch {
        continue;
      }

      if (entryStat.isDirectory()) {
        await walk(fullPath, depth + 1);
      } else if (entryStat.isFile()) {
        const lower = entry.toLowerCase();
        const isConventional = CONVENTIONAL_NAMES.has(lower);
        const isMdc = lower.endsWith('.mdc');
        const isCursorRule = dir.includes(path.join('.cursor', 'rules')) && (lower.endsWith('.md') || isMdc);
        const isClaudeSkill = dir.includes(path.join('.claude', 'skills')) && lower.endsWith('.md');

        if (isConventional || isCursorRule || isClaudeSkill) {
          const rel = path.relative(baseDir, fullPath);
          discovered.push({
            name: entry === 'SKILL.md' ? path.basename(dir) : entry,
            path: fullPath,
            relativePath: rel,
            format: isMdc ? 'mdc' : lower.endsWith('.md') ? 'markdown' : 'cursorrules'
          });
        }
      }
    }
  }

  await walk(baseDir, 0);
  return discovered.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
