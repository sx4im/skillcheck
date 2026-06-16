import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Route the runner by task prompt so a single eval produces one helped, one
// hurt, and one no-change task — covering every branch of the explain builder
// (labels + the example-selection preferences) offline.
const PASS = 'SKILL_PASS_MARKER';
vi.mock('../src/adapters/nvidia-nim.js', () => {
  class FakeNvidiaNimClient {
    constructor(
      public config: unknown,
      public options: unknown
    ) {}
    async complete(request: { messages: Array<{ role: string; content: string }> }) {
      const system = request.messages.find((m) => m.role === 'system')?.content ?? '';
      const user = request.messages.find((m) => m.role === 'user')?.content ?? '';
      const usage = { promptTokens: 10, completionTokens: 2, totalTokens: 12 };
      if (/blind evaluator/i.test(system)) {
        return { content: JSON.stringify({ score: user.includes(PASS) ? 1 : 0, reason: 'g' }), model: 'fake', usage };
      }
      const withSkill = /skill instructions/i.test(system);
      let pass = false;
      if (/HELP/.test(user)) pass = withSkill;
      else if (/HURT/.test(user)) pass = !withSkill;
      // SAME: never passes → no change
      return { content: pass ? `${PASS} ok` : 'plain miss', model: 'fake', usage };
    }
  }
  return { NvidiaNimClient: FakeNvidiaNimClient };
});

const { evalSkill } = await import('../src/eval.js');

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
    const result = (await evalSkill({
      inputPath: path.join(dir, 'SKILL.md'),
      tasks: 3,
      trials: 1,
      mode: 'forced',
      taskSuite: path.join(dir, 'tasks.json'),
      explain: true
    })) as { explain: { tasks: Array<Record<string, unknown>> } };

    const byLabel = new Map(result.explain.tasks.map((t) => [t.label as string, t]));
    expect(new Set(byLabel.keys())).toEqual(new Set(['helped', 'hurt', 'no change']));

    const helped = byLabel.get('helped')!;
    expect(helped.delta_pp).toBe(100);
    expect((helped.example_with as { pass: boolean }).pass).toBe(true);
    expect((helped.example_without as { pass: boolean }).pass).toBe(false);

    const hurt = byLabel.get('hurt')!;
    expect(hurt.delta_pp).toBe(-100);
    expect((hurt.example_without as { pass: boolean }).pass).toBe(true);
  });

  it('omits the explain payload unless requested', async () => {
    const result = (await evalSkill({
      inputPath: path.join(dir, 'SKILL.md'),
      tasks: 3,
      trials: 1,
      mode: 'forced',
      taskSuite: path.join(dir, 'tasks.json')
    })) as Record<string, unknown>;
    expect(result.explain).toBeUndefined();
  });
});
