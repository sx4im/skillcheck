import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Offline model fake (same shape as the e2e suite).
const PASS_MARKER = 'SKILL_PASS_MARKER';
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
      if (/evaluation tasks/i.test(system)) {
        const tasks = Array.from({ length: 8 }, (_, i) => ({ id: `t${i + 1}`, prompt: `Task ${i + 1}`, criterion: `Crit ${i + 1}` }));
        return { content: JSON.stringify({ tasks }), model: 'fake', usage };
      }
      if (/blind evaluator/i.test(system)) {
        return { content: JSON.stringify({ score: user.includes(PASS_MARKER) ? 1 : 0, reason: 'g' }), model: 'fake', usage };
      }
      return { content: /skill instructions/i.test(system) ? `${PASS_MARKER} ok` : 'baseline', model: 'fake', usage };
    }
  }
  return { NvidiaNimClient: FakeNvidiaNimClient };
});

// Answer the post-result prompt deterministically. promptText() builds its readline
// interface from node:readline/promises, so stubbing createInterface controls it.
let promptAnswer = 'n';
vi.mock('node:readline/promises', () => ({
  createInterface: () => ({ question: async () => promptAnswer, close() {} })
}));

const { main } = await import('../src/cli.js');

describe('interactive per-task breakdown offer', () => {
  let saved: Record<string, unknown>;
  let cwd: string;
  let workDir: string;

  beforeEach(async () => {
    saved = {
      NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
      stdinTTY: process.stdin.isTTY,
      stdoutTTY: process.stdout.isTTY
    };
    process.env.NVIDIA_API_KEY = 'test-key';
    process.env.SKILLCHECK_NO_UPDATE_CHECK = '1';
    // Pretend we're an interactive terminal so runCheck offers the breakdown.
    (process.stdin as { isTTY?: boolean }).isTTY = true;
    (process.stdout as { isTTY?: boolean }).isTTY = true;
    cwd = process.cwd();
    workDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-prompt-'));
    process.chdir(workDir);
    await writeFile(path.join(workDir, 'SKILL.md'), '# Demo\n\ndomain: demo tasks\n');
  });

  afterEach(() => {
    process.chdir(cwd);
    if (saved.NVIDIA_API_KEY === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = saved.NVIDIA_API_KEY as string;
    (process.stdin as { isTTY?: boolean }).isTTY = saved.stdinTTY as boolean | undefined;
    (process.stdout as { isTTY?: boolean }).isTTY = saved.stdoutTTY as boolean | undefined;
    vi.restoreAllMocks();
  });

  async function run(): Promise<string> {
    const out: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => out.push(a.map(String).join(' ')));
    // Swallow the animated card frames written straight to stdout.
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await main(['node', 'skillcheck', 'check', 'SKILL.md', '--tasks', '2', '--trials', '1']);
    } finally {
      logSpy.mockRestore();
      writeSpy.mockRestore();
    }
    return out.join('\n');
  }

  it('shows the breakdown when the user answers yes', async () => {
    promptAnswer = 'y';
    const out = await run();
    expect(out).toContain('SKILLCHECK RESULT');
    expect(out).toContain('Per-task breakdown');
  });

  it('keeps the breakdown hidden when the user declines', async () => {
    promptAnswer = 'n';
    const out = await run();
    expect(out).toContain('SKILLCHECK RESULT');
    expect(out).not.toContain('Per-task breakdown');
  });
});
