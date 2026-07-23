import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRotReport, runRot } from '../src/rot.js';

type Verdict = 'helps' | 'placebo' | 'harms';

function storedResult(name: string, commit: string, verdict: Verdict, runDate: string, effect = 20) {
  return {
    skill: { name, source: `repo/${name}`, format: 'SKILL.md', commit_hash: commit, domain: `${name} domain` },
    config: { runner_model: 'openai/gpt-oss-120b' },
    result: { effect_pp: effect, ci_pp: [effect - 5, effect + 5], verdict },
    run_date: runDate
  };
}

async function writeResults(files: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-rot-'));
  for (const [name, value] of Object.entries(files)) {
    await writeFile(path.join(dir, name), JSON.stringify(value));
  }
  return dir;
}

describe('rot status classification', () => {
  it('marks a single result as new', async () => {
    const dir = await writeResults({ 'a.json': storedResult('Alpha', 'c1', 'helps', '2026-01-01') });
    const report = await buildRotReport(dir);
    expect(report.summary).toMatchObject({ skills: 1, new: 1, stable: 0, rot: 0 });
    expect(report.skills[0]!.status).toBe('new');
  });

  it('marks a still-helping skill as stable across runs', async () => {
    const dir = await writeResults({
      'a1.json': storedResult('Beta', 'c2', 'helps', '2026-01-01'),
      'a2.json': storedResult('Beta', 'c2', 'helps', '2026-02-01')
    });
    const report = await buildRotReport(dir);
    expect(report.summary).toMatchObject({ skills: 1, stable: 1, rot: 0 });
    expect(report.skills[0]!.status).toBe('stable');
  });

  it('flags a skill that regressed from helps to placebo as rot', async () => {
    const dir = await writeResults({
      'a1.json': storedResult('Gamma', 'c3', 'helps', '2026-01-01'),
      'a2.json': storedResult('Gamma', 'c3', 'placebo', '2026-03-01', 2)
    });
    const report = await buildRotReport(dir);
    expect(report.summary.rot).toBe(1);
    const skill = report.skills[0]!;
    expect(skill.status).toBe('rot');
    expect(skill.changed_from?.verdict).toBe('helps');
  });

  it('runRot writes the report to the requested output path', async () => {
    const dir = await writeResults({ 'a.json': storedResult('Delta', 'c4', 'helps', '2026-01-01') });
    const output = path.join(dir, 'report', 'rot.json');
    const report = await runRot({ resultsDir: dir, output, tasks: 1, trials: 1 });
    expect(report.summary.skills).toBe(1);
    const written = JSON.parse(await (await import('node:fs/promises')).readFile(output, 'utf8'));
    expect(written.summary.skills).toBe(1);
  });
});
