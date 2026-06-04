import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { evalSkill } from './eval.js';

const execFile = promisify(execFileCallback);

type Verdict = 'helps' | 'placebo' | 'harms';
type RotStatus = 'new' | 'stable' | 'rot';

interface StoredResult {
  skill: {
    name: string;
    source: string;
    format: string;
    commit_hash: string;
    domain: string;
  };
  config: {
    runner_model: string;
    runner_version?: string;
  };
  result: {
    effect_pp: number;
    ci_pp: [number, number];
    verdict: Verdict;
  };
  run_date: string;
}

export interface RotHistoryEntry {
  result_id: string;
  file_path: string;
  runner_model: string;
  runner_version: string;
  run_date: string;
  effect_pp: number;
  ci_pp: [number, number];
  verdict: Verdict;
}

export interface RotSkillReport {
  key: string;
  skill: StoredResult['skill'];
  status: RotStatus;
  latest: RotHistoryEntry;
  changed_from?: RotHistoryEntry;
  history: RotHistoryEntry[];
}

export interface RotReport {
  generated_at: string;
  results_dir: string;
  model?: string;
  summary: {
    skills: number;
    new: number;
    stable: number;
    rot: number;
  };
  skills: RotSkillReport[];
}

export interface RotOptions {
  resultsDir: string;
  output?: string;
  model?: string;
  corpus?: string;
  tasks: number;
  trials: number;
}

interface CorpusSkill {
  id: string;
  path: string;
}

interface CorpusManifest {
  name: string;
  repo?: string;
  commit?: string;
  skills: CorpusSkill[];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function resultKey(result: StoredResult): string {
  return `${slugify(result.skill.name)}:${result.skill.commit_hash}`;
}

function isVerdict(value: unknown): value is Verdict {
  return value === 'helps' || value === 'placebo' || value === 'harms';
}

function asStoredResult(value: unknown): StoredResult | undefined {
  const candidate = value as Partial<StoredResult>;
  if (
    !candidate.skill?.name ||
    !candidate.skill.source ||
    !candidate.skill.format ||
    !candidate.skill.commit_hash ||
    !candidate.skill.domain ||
    !candidate.config?.runner_model ||
    !candidate.result?.ci_pp ||
    !isVerdict(candidate.result.verdict) ||
    typeof candidate.result.effect_pp !== 'number' ||
    !candidate.run_date
  ) {
    return undefined;
  }
  return candidate as StoredResult;
}

async function listJsonFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return listJsonFiles(fullPath);
      }
      return entry.isFile() && entry.name.endsWith('.json') ? [fullPath] : [];
    })
  );
  return files.flat();
}

async function readStoredResults(resultsDir: string): Promise<Array<{ file: string; result: StoredResult }>> {
  const files = await listJsonFiles(resultsDir);
  const results: Array<{ file: string; result: StoredResult }> = [];

  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
    } catch {
      continue;
    }
    const result = asStoredResult(parsed);
    if (result) {
      results.push({ file, result });
    }
  }

  return results;
}

function compareHistory(a: RotHistoryEntry, b: RotHistoryEntry): number {
  const dateDelta = Date.parse(a.run_date) - Date.parse(b.run_date);
  return dateDelta === 0 ? a.file_path.localeCompare(b.file_path) : dateDelta;
}

function historyEntry(resultsDir: string, file: string, result: StoredResult): RotHistoryEntry {
  const relative = path.relative(resultsDir, file);
  return {
    result_id: `${slugify(result.skill.name)}-${slugify(path.dirname(relative))}-${slugify(path.basename(relative, '.json'))}`,
    file_path: relative,
    runner_model: result.config.runner_model,
    runner_version: result.config.runner_version ?? result.config.runner_model,
    run_date: result.run_date,
    effect_pp: result.result.effect_pp,
    ci_pp: result.result.ci_pp,
    verdict: result.result.verdict
  };
}

function summarizeSkill(key: string, skill: StoredResult['skill'], history: RotHistoryEntry[]): RotSkillReport {
  const sorted = [...history].sort(compareHistory);
  const latest = sorted.at(-1);
  if (!latest) {
    throw new Error(`No history for ${key}`);
  }
  const changedFrom = [...sorted.slice(0, -1)].reverse().find((entry) => entry.verdict === 'helps');
  const status: RotStatus = sorted.length === 1 ? 'new' : changedFrom && latest.verdict !== 'helps' ? 'rot' : 'stable';

  return {
    key,
    skill,
    status,
    latest,
    ...(status === 'rot' ? { changed_from: changedFrom } : {}),
    history: sorted
  };
}

export async function buildRotReport(resultsDir: string, model?: string): Promise<RotReport> {
  const absoluteResultsDir = path.resolve(resultsDir);
  const storedResults = await readStoredResults(absoluteResultsDir);
  const grouped = new Map<string, { skill: StoredResult['skill']; history: RotHistoryEntry[] }>();

  for (const { file, result } of storedResults) {
    const key = resultKey(result);
    const current = grouped.get(key) ?? { skill: result.skill, history: [] };
    current.history.push(historyEntry(absoluteResultsDir, file, result));
    grouped.set(key, current);
  }

  const skills = [...grouped.entries()]
    .map(([key, group]) => summarizeSkill(key, group.skill, group.history))
    .sort((a, b) => a.skill.name.localeCompare(b.skill.name));

  return {
    generated_at: new Date().toISOString(),
    results_dir: resultsDir,
    ...(model ? { model } : {}),
    summary: {
      skills: skills.length,
      new: skills.filter((skill) => skill.status === 'new').length,
      stable: skills.filter((skill) => skill.status === 'stable').length,
      rot: skills.filter((skill) => skill.status === 'rot').length
    },
    skills
  };
}

function unquote(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '');
}

export function parseCorpusManifest(text: string): CorpusManifest {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as CorpusManifest;
    if (!parsed.name || !Array.isArray(parsed.skills)) {
      throw new Error('Corpus manifest JSON must include name and skills');
    }
    return parsed;
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

async function prepareCorpus(corpusPath: string, manifest: CorpusManifest): Promise<string> {
  if (!manifest.repo) {
    return path.dirname(path.resolve(corpusPath));
  }

  const checkoutDir = path.join('.cache', 'sources', slugify(manifest.name));
  if (!(await pathExists(path.join(checkoutDir, '.git')))) {
    await mkdir(path.dirname(checkoutDir), { recursive: true });
    await execFile('git', ['clone', manifest.repo, checkoutDir]);
  }
  if (manifest.commit) {
    await execFile('git', ['-C', checkoutDir, 'fetch', '--tags', '--quiet']);
    await execFile('git', ['-C', checkoutDir, 'checkout', '--quiet', manifest.commit]);
  }
  return checkoutDir;
}

async function rerunCorpus(options: RotOptions): Promise<void> {
  if (!options.corpus) {
    return;
  }

  const manifest = parseCorpusManifest(await readFile(options.corpus, 'utf8'));
  const baseDir = await prepareCorpus(options.corpus, manifest);
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${slugify(options.model ?? 'env-runner')}`;
  const outputDir = path.join(options.resultsDir, 'rot-runs', runId);

  for (const skill of manifest.skills) {
    await evalSkill({
      inputPath: path.join(baseDir, skill.path),
      output: path.join(outputDir, `${slugify(skill.id)}.json`),
      tasks: options.tasks,
      trials: options.trials,
      mode: 'forced',
      runner: options.model
    });
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function runRot(options: RotOptions): Promise<RotReport> {
  await rerunCorpus(options);
  const report = await buildRotReport(options.resultsDir, options.model);
  if (options.output) {
    await writeJson(options.output, report);
  }
  return report;
}
