import { existsSync, readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export interface LeaderboardResult {
  id: string;
  filePath: string;
  rot?: RotSkillReport;
  skill: {
    name: string;
    source: string;
    format: string;
    commit_hash: string;
    domain: string;
  };
  config: {
    runner_model: string;
    runner_version: string;
    grader_model: string;
    generator_model: string;
    trials: number;
    tasks: number;
    mode: string;
  };
  result: {
    effect_pp: number;
    ci_pp: [number, number];
    verdict: 'helps' | 'placebo' | 'harms';
    with_skill_pass: number;
    no_skill_pass: number;
    token_overhead: number;
    value_per_1k_tokens: number;
  };
  tasks: Array<{
    id: string;
    prompt: string;
    criterion_type: string;
    criterion: string;
    arm_a_pass_rate: number;
    arm_b_pass_rate: number;
  }>;
  reproducibility: {
    task_suite_path: string;
    transcript_hashes: string[];
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
  verdict: 'helps' | 'placebo' | 'harms';
}

export interface RotSkillReport {
  key: string;
  status: 'new' | 'stable' | 'rot';
  latest: RotHistoryEntry;
  changed_from?: RotHistoryEntry;
  history: RotHistoryEntry[];
}

interface RotReport {
  skills: RotSkillReport[];
}

function repoRoot(): string {
  const cwd = path.resolve(/* turbopackIgnore: true */ process.cwd());
  return cwd.endsWith(path.join('packages', 'site')) ? path.resolve(cwd, '..', '..') : cwd;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function configuredPath(root: string, value: string): string {
  return path.isAbsolute(value) ? value : path.join(root, value);
}

function defaultResultsDir(root: string): string {
  const latestLaunchPointer = path.join(root, 'results/launch/latest-qwen-next-dir.txt');
  if (existsSync(latestLaunchPointer)) {
    const latestLaunchDir = readFileSync(latestLaunchPointer, 'utf8').trim();
    if (latestLaunchDir) {
      return configuredPath(root, latestLaunchDir);
    }
  }
  return path.join(root, 'results');
}

function resultsDir(root: string): string {
  return process.env.SKILLCHECK_RESULTS_DIR ? configuredPath(root, process.env.SKILLCHECK_RESULTS_DIR) : defaultResultsDir(root);
}

function rotReportPath(root: string): string {
  return configuredPath(root, process.env.SKILLCHECK_ROT_REPORT ?? 'results/rot/report.json');
}

function resultKey(result: Omit<LeaderboardResult, 'id' | 'filePath' | 'rot'>): string {
  return `${slugify(result.skill.name)}:${result.skill.commit_hash}`;
}

async function listJsonFiles(dir: string): Promise<string[]> {
  // results/ is git-ignored, so a fresh clone has none — an empty leaderboard,
  // not a build crash.
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

function isLeaderboardResult(value: unknown): value is Omit<LeaderboardResult, 'id' | 'filePath'> {
  const candidate = value as Partial<LeaderboardResult>;
  return Boolean(candidate.skill?.name && candidate.result?.ci_pp && candidate.reproducibility?.task_suite_path);
}

function isRotReport(value: unknown): value is RotReport {
  return Array.isArray((value as RotReport).skills);
}

async function loadRotByKey(root: string): Promise<Map<string, RotSkillReport>> {
  try {
    const parsed = JSON.parse(await readFile(rotReportPath(root), 'utf8')) as unknown;
    if (!isRotReport(parsed)) {
      return new Map();
    }
    return new Map(parsed.skills.map((skill) => [skill.key, skill]));
  } catch {
    return new Map();
  }
}

export async function loadResults(): Promise<LeaderboardResult[]> {
  const root = repoRoot();
  const files = await listJsonFiles(resultsDir(root));
  const rotByKey = await loadRotByKey(root);
  const results: LeaderboardResult[] = [];

  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
    } catch {
      continue;
    }
    if (!isLeaderboardResult(parsed)) {
      continue;
    }
    const relative = path.relative(root, file);
    results.push({
      ...parsed,
      id: `${slugify(parsed.skill.name)}-${slugify(path.dirname(relative))}-${slugify(path.basename(relative, '.json'))}`,
      filePath: relative,
      rot: rotByKey.get(resultKey(parsed))
    });
  }

  return results.sort((a, b) => b.result.effect_pp - a.result.effect_pp || a.skill.name.localeCompare(b.skill.name));
}

export async function loadResult(id: string): Promise<LeaderboardResult | undefined> {
  return (await loadResults()).find((result) => result.id === id);
}
