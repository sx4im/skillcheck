import { execFile as execFileCallback } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { findWorkspaceRoot } from './discovery.js';
import { evalSkill } from './eval.js';

const execFile = promisify(execFileCallback);

const PROMPT_FILE_PATTERNS = [
  /skill\.md$/i,
  /claude\.md$/i,
  /\.cursorrules$/i,
  /agents\.md$/i,
  /copilot-instructions\.md$/i,
  /\.cursor\/rules\/.*\.mdc?$/i,
  /\.claude\/skills\/.*\.md$/i
];

const IGNORED_PATHS = [
  'node_modules/',
  'results/',
  'docs/',
  'fixtures/',
  '.git/'
];

/**
 * Check if a file path qualifies as an agent instruction or skill file.
 */
export function isPromptFilePath(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, '/');
  if (IGNORED_PATHS.some((ignored) => norm.startsWith(ignored) || norm.includes(`/${ignored}`))) {
    return false;
  }
  return PROMPT_FILE_PATTERNS.some((pattern) => pattern.test(norm));
}

export function preCommitScriptContent(): string {
  return `#!/bin/sh
# Skillcheck Git Pre-Commit Hook
# Prevents committing prompt regressions (HARMS/PLACEBO).
# Bypass with: git commit --no-verify, or set SKILLCHECK_SKIP_HOOK=1

if [ "$SKILLCHECK_SKIP_HOOK" = "1" ]; then
  exit 0
fi

if command -v skillcheck >/dev/null 2>&1; then
  skillcheck hook run
elif [ -f "./dist/bin/skillcheck.js" ]; then
  node ./dist/bin/skillcheck.js hook run
else
  npx @sx4im/skillcheck hook run
fi
`;
}

/**
 * Install pre-commit hook into .git/hooks directory.
 */
export function installGitHook(targetDir = findWorkspaceRoot()): { installed: boolean; path: string; message: string } {
  const gitDir = path.join(targetDir, '.git');
  if (!existsSync(gitDir)) {
    throw new Error(`Cannot install git hook: no .git directory found at ${targetDir}`);
  }

  const hooksDir = path.join(gitDir, 'hooks');
  mkdirSync(hooksDir, { recursive: true });

  const hookFile = path.join(hooksDir, 'pre-commit');
  const snippet = preCommitScriptContent();

  if (existsSync(hookFile)) {
    const existing = readFileSync(hookFile, 'utf8');
    if (existing.includes('skillcheck hook run')) {
      return { installed: true, path: hookFile, message: 'Skillcheck pre-commit hook is already installed.' };
    }
    writeFileSync(hookFile, `${existing.trimEnd()}\n\n${snippet}\n`, 'utf8');
  } else {
    writeFileSync(hookFile, snippet, 'utf8');
  }

  try {
    chmodSync(hookFile, 0o755);
  } catch {
    // Ignore on non-POSIX / Windows
  }

  return { installed: true, path: hookFile, message: `Skillcheck pre-commit hook installed to ${hookFile}` };
}

/**
 * Identify all staged agent skill / instruction files.
 */
export async function findStagedSkillFiles(cwd = findWorkspaceRoot()): Promise<string[]> {
  try {
    const { stdout } = await execFile('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], { cwd });
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => Boolean(line) && isPromptFilePath(line));
  } catch {
    return [];
  }
}

/**
 * Run pre-commit check on staged prompt files with a fast micro-sample profile.
 */
export async function runPreCommitCheck(options: { strict?: boolean; cwd?: string } = {}): Promise<{ passed: boolean; message: string }> {
  if (process.env.SKILLCHECK_SKIP_HOOK === '1') {
    return { passed: true, message: 'Pre-commit check skipped via SKILLCHECK_SKIP_HOOK=1.' };
  }

  const staged = await findStagedSkillFiles(options.cwd);
  if (staged.length === 0) {
    return { passed: true, message: 'No agent prompt files staged. Skipping check.' };
  }

  console.log(`[skillcheck] Checking staged prompt files: ${staged.join(', ')}...`);

  for (const filePath of staged) {
    const fullPath = path.resolve(options.cwd ?? process.cwd(), filePath);
    try {
      const result = await evalSkill({
        inputPath: fullPath,
        tasks: 3,
        trials: 2,
        mode: 'forced',
        concurrency: 4,
        saveArtifacts: false
      });

      if (result.result.verdict === 'harms') {
        return {
          passed: false,
          message: `Commit rejected: ${filePath} resulted in a HARMS verdict (${result.result.effect_pp >= 0 ? '+' : ''}${result.result.effect_pp.toFixed(1)} pp effect size).`
        };
      }

      if (options.strict && result.result.verdict === 'placebo') {
        return {
          passed: false,
          message: `Commit rejected: ${filePath} resulted in a PLACEBO verdict (strict mode enabled).`
        };
      }

      console.log(`[skillcheck] ✓ ${filePath}: ${result.result.verdict.toUpperCase()} (${result.result.effect_pp >= 0 ? '+' : ''}${result.result.effect_pp.toFixed(1)} pp)`);
    } catch (err) {
      console.warn(`[skillcheck] Warning: Evaluation failed for ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { passed: true, message: 'Skillcheck verified: all staged prompts passed.' };
}
