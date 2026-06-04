import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export interface LeaderboardResult {
  id: string;
  filePath: string;
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

async function listJsonFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
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

export async function loadResults(): Promise<LeaderboardResult[]> {
  const root = repoRoot();
  const files = await listJsonFiles(path.join(root, 'results'));
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
      filePath: relative
    });
  }

  return results.sort((a, b) => b.result.effect_pp - a.result.effect_pp || a.skill.name.localeCompare(b.skill.name));
}

export async function loadResult(id: string): Promise<LeaderboardResult | undefined> {
  return (await loadResults()).find((result) => result.id === id);
}
