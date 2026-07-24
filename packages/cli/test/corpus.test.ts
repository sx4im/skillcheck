import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCorpusManifest, slugify, runCorpus } from '../src/corpus.js';

vi.mock('../src/adapters/nvidia-nim.js', async () => {
  const { FakeNvidiaNimClient } = await import('./helpers.js');
  return { NvidiaNimClient: FakeNvidiaNimClient };
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
});
