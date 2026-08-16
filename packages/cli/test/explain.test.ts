import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evalSkill } from '../src/eval.js';

vi.mock('../src/adapters/nvidia-nim.js', async () => {
  const { FakeNvidiaNimClient } = await import('./helpers.js');
  return { NvidiaNimClient: FakeNvidiaNimClient };
});

describe('eval --explain payload', () => {
  let saved: string | undefined;
  let dir: string;

  beforeEach(async () => {
    saved = process.env.NVIDIA_API_KEY;
    process.env.NVIDIA_API_KEY = 'test-key';
    dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-explain-'));
    await writeFile(path.join(dir, 'SKILL.md'), '# Demo\n\ndomain: demo\n');
    await writeFile(
      path.join(dir, 'tasks.json'),
      JSON.stringify([
        { id: 'a', prompt: 'HELP task', criterion: 'c' },
        { id: 'b', prompt: 'SAME task', criterion: 'c' },
        { id: 'c', prompt: 'HURT task', criterion: 'c' }
      ])
    );
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = saved;
    vi.restoreAllMocks();
  });

  it('classifies helped / hurt / no-change and picks contrasting examples', async () => {
    const result = await evalSkill({
      inputPath: path.join(dir, 'SKILL.md'),
      tasks: 3,
      trials: 1,
      mode: 'forced',
      taskSuite: path.join(dir, 'tasks.json'),
      explain: true
    });

    const byLabel = new Map(result.explain!.tasks.map((t) => [t.label, t]));
    expect(new Set(byLabel.keys())).toEqual(new Set(['helped', 'hurt', 'no change']));

    const helped = byLabel.get('helped')!;
    expect(helped.delta_pp).toBe(100);
    expect(helped.example_with!.pass).toBe(true);
    expect(helped.example_without!.pass).toBe(false);

    const hurt = byLabel.get('hurt')!;
    expect(hurt.delta_pp).toBe(-100);
    expect(hurt.example_without!.pass).toBe(true);
  });

  it('omits the explain payload unless requested', async () => {
    const result = await evalSkill({
      inputPath: path.join(dir, 'SKILL.md'),
      tasks: 3,
      trials: 1,
      mode: 'forced',
      taskSuite: path.join(dir, 'tasks.json')
    });
    expect(result.explain).toBeUndefined();
  });
});
