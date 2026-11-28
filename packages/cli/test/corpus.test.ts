import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCorpusManifest, slugify, runCorpus } from '../src/corpus.js';

vi.mock('../src/providers/openai-compat.js', async () => {
  const { FakeOpenAiCompatClient } = await import('./helpers.js');
  return { OpenAiCompatClient: FakeOpenAiCompatClient };
});

describe('corpus helpers', () => {
  it('slugifies arbitrary labels', () => {
    expect(slugify('Hello, World! 2.0')).toBe('hello-world-2-0');
    expect(slugify('  --leading and trailing--  ')).toBe('leading-and-trailing');
  });

  it('parses a JSON manifest', () => {
    const manifest = parseCorpusManifest(JSON.stringify({ name: 'c', skills: [{ id: 'a', path: 'A.md' }] }));
    expect(manifest.name).toBe('c');
    expect(manifest.skills).toEqual([{ id: 'a', path: 'A.md' }]);
  });

  it('rejects a manifest missing a name or skill path', () => {
    expect(() => parseCorpusManifest(JSON.stringify({ skills: [] }))).toThrow(/name and skills/);
    expect(() => parseCorpusManifest(JSON.stringify({ name: 'c', skills: [{ id: 'a' }] }))).toThrow(/id and path/);
  });

  it.each([
    ['name: repo\nskills: [', /valid JSON or YAML/],
    ['name: repo\nskills: []\nunknown: no', /unknown field/],
    ['name: repo\nrepo: true\nskills: []', /non-empty strings/],
    ['name: repo\nskills: [{id: a, path: a.md, commit: true}]', /optional fields/],
    ['name: repo\nskills: [{id: a, path: ../elsewhere.md}]', /traversal/],
    ['name: repo\nskills: [{id: a, path: /elsewhere.md}]', /traversal/]
  ])('checks the manifest before reading sources (%s)', (manifest, error) => {
    expect(() => parseCorpusManifest(manifest)).toThrow(error);
  });

  it('requires named records and caps corpus size', () => {
    const skills = Array.from({ length: 501 }, (_, i) => ({ id: 'skill-' + i, path: 'SKILL.md' }));
    expect(() => parseCorpusManifest(JSON.stringify({ name: 'large', skills }))).toThrow(/limited to 500/);
  });
});

describe('runCorpus (local manifest, mocked model)', () => {
  let saved: string | undefined;
  let cwd: string;
  let dir: string;

  beforeEach(async () => {
    saved = process.env.NVIDIA_API_KEY;
    process.env.NVIDIA_API_KEY = 'test-key';
    cwd = process.cwd();
    dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-corpus-'));
    process.chdir(dir);
    await mkdir(path.join(dir, 'skilldir'), { recursive: true });
    await writeFile(path.join(dir, 'skilldir', 'SKILL.md'), '# Demo\n\ndomain: example tasks\n');
    await writeFile(path.join(dir, 'corpus.yaml'), 'name: test-corpus\nskills:\n  - id: demo\n    path: skilldir/SKILL.md\n');
  });

  afterEach(() => {
    process.chdir(cwd);
    if (saved === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = saved;
    vi.restoreAllMocks();
  });

  it('evaluates every skill and writes a summary plus per-skill results', async () => {
    const report = await runCorpus({
      corpus: 'corpus.yaml',
      outputDir: 'out',
      tasks: 1,
      trials: 1,
      concurrency: 1
    });

    expect(report.skills).toHaveLength(1);
    const entry = report.skills[0]!;
    expect(entry.id).toBe('demo');
    expect(entry.source).toBe('test-corpus');

    const summary = JSON.parse(await readFile(path.join(dir, 'out', 'summary.json'), 'utf8'));
    expect(summary.skills).toHaveLength(1);

    const result = JSON.parse(await readFile(path.join(dir, entry.output_path), 'utf8'));
    expect(result.result.verdict).toBe('helps');

    // A warm re-run reuses the existing result instead of re-evaluating.
    const second = await runCorpus({ corpus: 'corpus.yaml', outputDir: 'out', tasks: 1, trials: 1, concurrency: 1 });
    expect(second.skills[0]!.output_path).toBe(entry.output_path);
  });

  it.each([
    ['file:///workspace/project', 'main', /unsafe git repository/],
    ['https://example.test/repo.git', '--unknown', /unsafe git commit/]
  ])('rejects invalid remote source metadata before spawning Git', async (repo, commit, error) => {
    await writeFile('corpus.yaml', JSON.stringify({ name: 'remote', repo, commit, skills: [{ id: 'demo', path: 'SKILL.md' }] }));
    await expect(runCorpus({ corpus: 'corpus.yaml', outputDir: 'out', tasks: 1, trials: 1, concurrency: 1 })).rejects.toThrow(error);
  });
});
