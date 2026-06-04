import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { evalSkill } from './eval.js';

const execFile = promisify(execFileCallback);

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
  runner?: string;
  skills: CorpusRunEntry[];
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function unquote(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '');
}

function assertCorpusManifest(value: unknown): CorpusManifest {
  const manifest = value as Partial<CorpusManifest>;
  if (!manifest.name || !Array.isArray(manifest.skills)) {
    throw new Error('Corpus manifest JSON must include name and skills');
  }
  for (const [index, skill] of manifest.skills.entries()) {
    if (!skill.id || !skill.path) {
      throw new Error(`Corpus skill ${index + 1} must include id and path`);
    }
  }
  return manifest as CorpusManifest;
}

export function parseCorpusManifest(text: string): CorpusManifest {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    return assertCorpusManifest(JSON.parse(trimmed) as unknown);
  }

  const manifest: CorpusManifest = { name: '', skills: [] };
  let currentSkill: Partial<CorpusSkill> | undefined;

  for (const rawLine of text.split('\n')) {
    const withoutComment = rawLine.replace(/\s+#.*$/, '');
    if (!withoutComment.trim()) {
      continue;
    }

    const topLevel = /^([A-Za-z_]+):\s*(.*)$/.exec(withoutComment);
    if (topLevel && !rawLine.startsWith(' ')) {
      const [, key, value = ''] = topLevel;
      if (key === 'name') manifest.name = unquote(value);
      if (key === 'repo') manifest.repo = unquote(value);
      if (key === 'commit') manifest.commit = unquote(value);
      continue;
    }

    const skillStart = /^\s*-\s*id:\s*(.+)$/.exec(withoutComment);
    if (skillStart) {
      currentSkill = { id: unquote(skillStart[1]!) };
      manifest.skills.push(currentSkill as CorpusSkill);
      continue;
    }

    const skillField = /^\s+([A-Za-z_]+):\s*(.+)$/.exec(withoutComment);
    if (skillField && currentSkill) {
      const [, key, value] = skillField;
      if (key === 'path') currentSkill.path = unquote(value!);
      if (key === 'id') currentSkill.id = unquote(value!);
      if (key === 'source') currentSkill.source = unquote(value!);
      if (key === 'repo') currentSkill.repo = unquote(value!);
      if (key === 'commit') currentSkill.commit = unquote(value!);
    }
  }

  if (!manifest.name || manifest.skills.some((skill) => !skill.id || !skill.path)) {
    throw new Error('Corpus manifest YAML must include name and skills with id/path');
  }
  return manifest;
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
  const checkoutDir = path.join('.cache', 'sources', `${slugify(source)}-${repoSlug(repo)}-${(commit ?? 'head').slice(0, 12)}`);
  const sparseDirs = [...new Set(paths.map(sparseDir))].sort();

  if (!(await pathExists(path.join(checkoutDir, '.git')))) {
    await mkdir(path.dirname(checkoutDir), { recursive: true });
    await execFile('git', ['clone', '--filter=blob:none', '--no-checkout', repo, checkoutDir]);
  }

  await execFile('git', ['-C', checkoutDir, 'sparse-checkout', 'init', '--cone']);
  await execFile('git', ['-C', checkoutDir, 'sparse-checkout', 'set', ...sparseDirs]);
  if (commit) {
    await execFile('git', ['-C', checkoutDir, 'fetch', '--depth', '1', 'origin', commit]);
    await execFile('git', ['-C', checkoutDir, 'checkout', '--quiet', commit]);
  } else {
    await execFile('git', ['-C', checkoutDir, 'checkout', '--quiet']);
  }
  return checkoutDir;
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
    const key = repo ? `${repo}#${commit ?? 'HEAD'}` : `local:${path.dirname(path.resolve(corpusPath))}`;
    const current = grouped.get(key) ?? { source, repo, commit, paths: [] };
    current.paths.push(skill.path);
    grouped.set(key, current);
  }

  for (const [key, group] of grouped) {
    roots.set(
      key,
      group.repo
        ? await prepareGitSource(group.source, group.repo, group.commit, group.paths)
        : path.dirname(path.resolve(corpusPath))
    );
  }

  return roots;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function runCorpus(options: CorpusRunOptions): Promise<CorpusRunReport> {
  const manifest = parseCorpusManifest(await readFile(options.corpus, 'utf8'));
  const skills = manifest.skills.slice(0, options.limit ?? manifest.skills.length);
  const roots = await prepareSources(options.corpus, manifest, skills);
  const entries: CorpusRunEntry[] = [];

  for (const skill of skills) {
    const repo = skill.repo ?? manifest.repo;
    const commit = skill.commit ?? manifest.commit;
    const source = sourceName(manifest, skill);
    const key = repo ? `${repo}#${commit ?? 'HEAD'}` : `local:${path.dirname(path.resolve(options.corpus))}`;
    const root = roots.get(key);
    if (!root) {
      throw new Error(`No prepared source root for ${source}`);
    }

    const outputPath = path.join(options.outputDir, `${slugify(source)}-${slugify(skill.id)}.json`);
    const inputPath = path.join(root, skill.path);
    console.error(`[corpus] eval ${source}/${skill.id}`);
    await evalSkill({
      inputPath,
      output: outputPath,
      tasks: options.tasks,
      trials: options.trials,
      mode: 'forced',
      runner: options.runner,
      sourceLabel: sourceLabel(manifest, skill)
    });

    entries.push({
      id: skill.id,
      source,
      ...(repo ? { repo } : {}),
      ...(commit ? { commit } : {}),
      path: skill.path,
      input_path: inputPath,
      output_path: outputPath
    });
  }

  const report: CorpusRunReport = {
    corpus: options.corpus,
    output_dir: options.outputDir,
    tasks: options.tasks,
    trials: options.trials,
    ...(options.runner ? { runner: options.runner } : {}),
    skills: entries
  };
  await writeJson(path.join(options.outputDir, 'summary.json'), report);
  return report;
}
