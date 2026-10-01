import { execFile as execFileCallback } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
 * Write the staged blob (`git show :0:<path>`) to a temp file and return its
 * path. The pre-commit hook evaluates this — the exact bytes about to be
 * committed — rather than the working-tree file, which may hold unstaged
 * edits that are not part of the commit.
 */
async function materializeStagedBlob(relPath: string, cwd: string): Promise<string> {
  const { stdout } = await execFile('git', ['show', `:0:${relPath}`], {
    cwd,
    maxBuffer: 16 * 1024 * 1024
  });
  const ext = path.extname(relPath) || '.md';
  const tmpFile = path.join(
    tmpdir(),
    `skillcheck-staged-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
  );
  writeFileSync(tmpFile, stdout, 'utf8');
  return tmpFile;
}

/**
 * Run pre-commit check on staged prompt files with a fast micro-sample profile.
 *
 * Fail-closed: a file whose evaluation errors counts as a failure and blocks
 * the commit. An evaluation that did not run is not a passed evaluation.
 */
export async function runPreCommitCheck(options: { strict?: boolean; cwd?: string } = {}): Promise<{ passed: boolean; message: string }> {
  if (process.env.SKILLCHECK_SKIP_HOOK === '1') {
    return { passed: true, message: 'Pre-commit check skipped via SKILLCHECK_SKIP_HOOK=1.' };
  }

  const cwd = options.cwd ?? process.cwd();
  const staged = await findStagedSkillFiles(cwd);
  if (staged.length === 0) {
    return { passed: true, message: 'No agent prompt files staged. Skipping check.' };
  }

  console.log(`[skillcheck] Checking staged prompt files: ${staged.join(', ')}...`);

  const failed: string[] = [];
  for (const filePath of staged) {
    let tmpFile: string | null = null;
    try {
      tmpFile = await materializeStagedBlob(filePath, cwd);
      const result = await evalSkill({
        inputPath: tmpFile,
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
      failed.push(filePath);
      console.error(`[skillcheck] ERROR: evaluation failed for ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (tmpFile) {
        try {
          rmSync(tmpFile, { force: true });
        } catch {
          // best effort cleanup
        }
      }
    }
  }

  if (failed.length > 0) {
    return {
      passed: false,
      message: `Commit rejected: Skillcheck could not evaluate ${failed.length} staged file(s): ${failed.join(', ')}. Fix your provider configuration and retry, or bypass deliberately with git commit --no-verify / SKILLCHECK_SKIP_HOOK=1.`
    };
  }

  return { passed: true, message: 'Skillcheck verified: all staged prompts passed.' };
}
