import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { ValidationError } from './errors.js';
import { canonicalSkillPath, isInside, readBoundedFile } from './core/normalize/files.js';
import { singleLine } from './core/security/output.js';
import { evalSkill } from './eval.js';
import { slugify, writeJson } from './hash.js';
import { asyncPool } from './run.js';

const execFile = promisify(execFileCallback);

export { slugify };

export interface CorpusSkill {
  id: string;
  path: string;
  source?: string;
  repo?: string;
  commit?: string;
}

export interface CorpusManifest {
  name: string;
  repo?: string;
  commit?: string;
  skills: CorpusSkill[];
}

export interface CorpusRunOptions {
  corpus: string;
  outputDir: string;
  tasks: number;
  trials: number;
  concurrency: number;
  runner?: string;
  limit?: number;
}

export interface CorpusRunEntry {
  id: string;
  source: string;
  repo?: string;
  commit?: string;
  path: string;
  input_path: string;
  output_path: string;
}

export interface CorpusRunReport {
  corpus: string;
  output_dir: string;
  tasks: number;
  trials: number;
  concurrency: number;
  runner?: string;
  skills: CorpusRunEntry[];
}

function requiredText(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function objectFields(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ValidationError('Corpus manifest contains an invalid record or unknown field.');
  }
  return value as Record<string, unknown>;
}

export function parseCorpusManifest(text: string): CorpusManifest {
  let value: unknown;
  try {
    value = text.trimStart().startsWith('{') ? JSON.parse(text) : parse(text, { maxAliasCount: 0 });
  } catch (cause) {
    throw new ValidationError('Corpus manifest must be valid JSON or YAML.', { cause });
  }
  const manifest = objectFields(value, ['name', 'repo', 'commit', 'skills']);
  if (!requiredText(manifest.name) || !Array.isArray(manifest.skills)) {
    throw new ValidationError('Corpus manifest must include name and skills.');
  }
  if (manifest.skills.length > 500) throw new ValidationError('Corpus manifest is limited to 500 skills.');
  if ([manifest.repo, manifest.commit].some((item) => item !== undefined && !requiredText(item))) {
    throw new ValidationError('Corpus repo and commit must be non-empty strings.');
  }
  const skills = manifest.skills.map((entry, index): CorpusSkill => {
    const skill = objectFields(entry, ['id', 'path', 'source', 'repo', 'commit']);
    if (!requiredText(skill.id) || !requiredText(skill.path)) {
      throw new ValidationError('Corpus skill ' + (index + 1) + ' must include id and path.');
    }
    if ([skill.source, skill.repo, skill.commit].some((item) => item !== undefined && !requiredText(item))) {
      throw new ValidationError('Corpus skill ' + (index + 1) + ' optional fields must be non-empty strings.');
    }
    if (path.isAbsolute(skill.path) || path.win32.isAbsolute(skill.path) || skill.path.split(/[\\/]/).includes('..')) {
      throw new ValidationError('Path traversal detected in corpus skill ' + (index + 1) + '.');
    }
    return skill as unknown as CorpusSkill;
  });
  return { ...manifest, name: manifest.name, skills };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function hasValidJsonFile(filePath: string): Promise<boolean> {
  try {
    JSON.parse(await readFile(filePath, 'utf8'));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    if (error instanceof SyntaxError) {
      return false;
    }
    throw error;
  }
}

function repoSlug(repo: string): string {
  return slugify(repo.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, ''));
}

function sparseDir(skillPath: string): string {
  const dir = path.posix.dirname(skillPath);
  return dir === '.' ? skillPath : dir;
}

function sourceName(manifest: CorpusManifest, skill: CorpusSkill): string {
  if (skill.source) {
    return skill.source;
  }
  const repo = skill.repo ?? manifest.repo;
  return repo ? repo.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '') : manifest.name;
}

function sourceLabel(manifest: CorpusManifest, skill: CorpusSkill): string {
  const repo = skill.repo ?? manifest.repo;
  const commit = skill.commit ?? manifest.commit ?? 'HEAD';
  if (!repo) {
    return `${sourceName(manifest, skill)}:${skill.path}`;
  }
  return `${repo.replace(/\.git$/, '')}/blob/${commit}/${skill.path}`;
}

async function prepareGitSource(source: string, repo: string, commit: string | undefined, paths: string[]): Promise<string> {
  if (repo.startsWith('-') || !/^(https?:\/\/|git@|ssh:\/\/|[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+:)/.test(repo)) {
    throw new ValidationError('Invalid or unsafe git repository URL.');
  }
  if (commit && (commit.startsWith('-') || !/^[a-zA-Z0-9_./-]+$/.test(commit))) {
    throw new ValidationError('Invalid or unsafe git commit ref.');
  }

  const checkoutDir = path.join('.cache', 'sources', `${slugify(source)}-${repoSlug(repo)}-${(commit ?? 'head').slice(0, 12)}`);
  const sparseDirs = [...new Set(paths.map(sparseDir))].sort();
  const safeSparseDirs = sparseDirs.filter((d) => !d.startsWith('-'));

  const fetchOptions = { timeout: 120_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } };
  if (!(await pathExists(path.join(checkoutDir, '.git')))) {
    await mkdir(path.dirname(checkoutDir), { recursive: true });
    await execFile('git', ['clone', '--filter=blob:none', '--no-checkout', '--', repo, checkoutDir], fetchOptions);
  }

  await execFile('git', ['-C', checkoutDir, 'sparse-checkout', 'init', '--cone']);
  if (safeSparseDirs.length > 0) {
    await execFile('git', ['-C', checkoutDir, 'sparse-checkout', 'set', '--', ...safeSparseDirs]);
  }
  if (commit) {
    await execFile('git', ['-C', checkoutDir, 'fetch', '--depth', '1', 'origin', commit], fetchOptions);
    await execFile('git', ['-C', checkoutDir, 'checkout', '--detach', '--quiet', 'FETCH_HEAD', '--']);
  } else {
    await execFile('git', ['-C', checkoutDir, 'checkout', '--detach', '--quiet', 'HEAD', '--']);
  }
  return checkoutDir;
}

// Identity of a prepared source root: repo#commit for git sources, the corpus
// file's directory for local skills. Shared by prepareSources and runOne so
// the two cannot drift and read the wrong checkout.
function sourceKey(repo: string | undefined, commit: string | undefined, corpusPath: string): string {
  return repo ? `${repo}#${commit ?? 'HEAD'}` : `local:${path.dirname(path.resolve(corpusPath))}`;
}

async function prepareSources(
  corpusPath: string,
  manifest: CorpusManifest,
  skills: CorpusSkill[]
): Promise<Map<string, string>> {
  const roots = new Map<string, string>();
  const grouped = new Map<string, { source: string; repo?: string; commit?: string; paths: string[] }>();

  for (const skill of skills) {
    const repo = skill.repo ?? manifest.repo;
    const commit = skill.commit ?? manifest.commit;
    const source = sourceName(manifest, skill);
    const key = sourceKey(repo, commit, corpusPath);
    const current = grouped.get(key) ?? { source, repo, commit, paths: [] };
    current.paths.push(skill.path);
    grouped.set(key, current);
  }

  await asyncPool(Array.from(grouped.entries()), 4, async ([key, group]) => {
    roots.set(
      key,
      group.repo
        ? await prepareGitSource(group.source, group.repo, group.commit, group.paths)
        : path.dirname(path.resolve(corpusPath))
    );
  });

  return roots;
}

export async function runCorpus(options: CorpusRunOptions): Promise<CorpusRunReport> {
  const manifest = parseCorpusManifest(await readBoundedFile(options.corpus));
  const skills = manifest.skills.slice(0, options.limit ?? manifest.skills.length);
  const roots = await prepareSources(options.corpus, manifest, skills);
  const entries: CorpusRunEntry[] = new Array(skills.length);

  async function runOne(skill: CorpusSkill, index: number): Promise<void> {
    const repo = skill.repo ?? manifest.repo;
    const commit = skill.commit ?? manifest.commit;
    const source = sourceName(manifest, skill);
    const key = sourceKey(repo, commit, options.corpus);
    const root = roots.get(key);
    if (!root) {
      throw new Error(`No prepared source root for ${source}`);
    }

    const resolvedRoot = path.resolve(root);
    const inputPath = path.resolve(root, skill.path);
    if (!isInside(resolvedRoot, inputPath)) {
      throw new ValidationError(`Path traversal detected: "${skill.path}" resolves outside source root "${root}"`);
    }

    await canonicalSkillPath(inputPath, resolvedRoot);
    const outputPath = path.join(options.outputDir, `${slugify(source)}-${slugify(skill.id)}.json`);
    const entry: CorpusRunEntry = {
      id: skill.id,
      source,
      ...(repo ? { repo } : {}),
      ...(commit ? { commit } : {}),
      path: skill.path,
      input_path: inputPath,
      output_path: outputPath
    };

    if (await hasValidJsonFile(outputPath)) {
      console.error(singleLine(`[corpus] skip ${source}/${skill.id}; existing result`));
      entries[index] = entry;
      return;
    }

    console.error(singleLine(`[corpus] eval ${source}/${skill.id}`));
    await evalSkill({
      inputPath,
      output: outputPath,
      tasks: options.tasks,
      trials: options.trials,
      mode: 'forced',
      runner: options.runner,
      workspaceRoot: resolvedRoot,
      sourceLabel: sourceLabel(manifest, skill),
      useCache: true
    });

    entries[index] = entry;
  }

  let nextIndex = 0;
  await asyncPool(skills, Math.max(1, options.concurrency), async (skill) => {
    const index = nextIndex;
    nextIndex += 1;
    await runOne(skill, index);
  });

  if (entries.some((entry) => !entry)) {
    throw new Error('Corpus run completed without producing all result entries');
  }

  const report: CorpusRunReport = {
    corpus: options.corpus,
    output_dir: options.outputDir,
    tasks: options.tasks,
    trials: options.trials,
    concurrency: options.concurrency,
    ...(options.runner ? { runner: options.runner } : {}),
    skills: entries as CorpusRunEntry[]
  };
  await writeJson(path.join(options.outputDir, 'summary.json'), report);
  return report;
}
