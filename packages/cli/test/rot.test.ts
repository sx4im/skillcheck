import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRotReport, parseCorpusManifest } from '../src/rot.js';

function result(verdict: 'helps' | 'placebo' | 'harms', runner: string, runDate: string) {
  return {
    skill: {
      name: 'Rot Canary',
      source: 'fixtures/m4/rot-canary/SKILL.md',
      format: 'SKILL.md',
      commit_hash: 'rot-canary-hash',
      domain: 'rot detection'
    },
    config: {
      runner_model: runner,
      runner_version: runner,
      grader_model: 'grader',
      generator_model: 'generator',
      trials: 3,
      tasks: 1,
      mode: 'forced-injection'
    },
    result: {
      effect_pp: verdict === 'helps' ? 50 : 0,
      ci_pp: verdict === 'helps' ? [16.67, 83.33] : [0, 0],
      verdict,
      with_skill_pass: verdict === 'helps' ? 1 : 0,
      no_skill_pass: 0,
      token_overhead: 100,
      value_per_1k_tokens: verdict === 'helps' ? 500 : 0
    },
    tasks: [],
    reproducibility: {
      task_suite_path: 'fixtures/m4/tasks.json',
      transcript_hashes: []
    },
    run_date: runDate
  };
}

describe('buildRotReport', () => {
  it('flags a skill that moved from helps to placebo', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-rot-'));
    await writeFile(path.join(dir, 'baseline.json'), `${JSON.stringify(result('helps', 'old-model', '2026-06-03'))}\n`);
    await writeFile(path.join(dir, 'new-model.json'), `${JSON.stringify(result('placebo', 'new-model', '2026-06-04'))}\n`);

    const report = await buildRotReport(dir, 'new-model');

    expect(report.summary.rot).toBe(1);
    expect(report.skills[0]?.status).toBe('rot');
    expect(report.skills[0]?.changed_from?.verdict).toBe('helps');
    expect(report.skills[0]?.latest.verdict).toBe('placebo');
  });

  it('skips malformed JSON artifacts', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-rot-'));
    await writeFile(path.join(dir, 'empty.json'), '');
    await writeFile(path.join(dir, 'valid.json'), `${JSON.stringify(result('helps', 'old-model', '2026-06-04'))}\n`);

    const report = await buildRotReport(dir);

    expect(report.summary.skills).toBe(1);
    expect(report.summary.new).toBe(1);
  });
});

describe('parseCorpusManifest', () => {
  it('parses the committed YAML manifest shape', () => {
    const manifest = parseCorpusManifest(`name: seed\nrepo: https://example.test/repo.git\ncommit: abc123\nskills:\n  - id: nextjs\n    path: by-framework/nextjs/CLAUDE.md\n`);

    expect(manifest.name).toBe('seed');
    expect(manifest.repo).toBe('https://example.test/repo.git');
    expect(manifest.skills).toEqual([{ id: 'nextjs', path: 'by-framework/nextjs/CLAUDE.md' }]);
  });
});
