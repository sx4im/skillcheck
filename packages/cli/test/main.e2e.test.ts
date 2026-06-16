import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// End-to-end coverage of the command router in cli.ts. We mock ONLY the network
// adapter (NvidiaNimClient) so the whole pipeline — normalize → generate → run →
// grade → score → render — runs for real, offline and deterministically. The fake
// routes on message content: the generator returns a task batch, the runner emits
// a pass marker only in the with-skill arm, and the blind grader passes any output
// carrying that marker. That yields a stable HELPS verdict (with 100%, without 0%)
// with a measurable token overhead, exercising every branch of evalSkill.
const PASS_MARKER = 'SKILL_PASS_MARKER';

vi.mock('../src/adapters/nvidia-nim.js', () => {
  class FakeNvidiaNimClient {
    constructor(
      public config: unknown,
      public options: unknown
    ) {}

    async complete(request: {
      messages: Array<{ role: string; content: string }>;
      responseFormat?: string;
    }): Promise<{ content: string; model: string; usage: Record<string, number> }> {
      const system = request.messages.find((m) => m.role === 'system')?.content ?? '';
      const user = request.messages.find((m) => m.role === 'user')?.content ?? '';
      const withSkill = /skill instructions/i.test(system);
      const usage = { promptTokens: withSkill ? 100 : 20, completionTokens: 5, totalTokens: withSkill ? 105 : 25 };

      if (/evaluation tasks/i.test(system)) {
        const tasks = Array.from({ length: 12 }, (_, i) => ({
          id: `t${i + 1}`,
          prompt: `Task number ${i + 1}`,
          criterion: `Output addresses task ${i + 1}`
        }));
        return { content: JSON.stringify({ tasks }), model: 'fake', usage };
      }

      if (/blind evaluator/i.test(system)) {
        const score = user.includes(PASS_MARKER) ? 1 : 0;
        return { content: JSON.stringify({ score, reason: 'graded' }), model: 'fake', usage };
      }

      // Runner arm.
      return {
        content: withSkill ? `${PASS_MARKER} the task is handled` : 'a plain baseline answer',
        model: 'fake',
        usage
      };
    }
  }
  return { NvidiaNimClient: FakeNvidiaNimClient };
});

// Imported after the mock is registered so cli.ts picks up the fake adapter.
const { main } = await import('../src/cli.js');

interface Captured {
  stdout: string;
  stderr: string;
}

async function runMain(argv: string[]): Promise<Captured> {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    out.push(a.map(String).join(' '));
  });
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    err.push(a.map(String).join(' '));
  });
  const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    await main(argv);
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    writeSpy.mockRestore();
  }
  return { stdout: out.join('\n'), stderr: err.join('\n') };
}

const ENV_KEYS = [
  'NVIDIA_API_KEY',
  'SKILLCHECK_TOKEN',
  'SKILLCHECK_API_KEY',
  'SKILLCHECK_API_URL',
  'SKILLCHECK_CONFIG_DIR',
  'SKILLCHECK_NO_UPDATE_CHECK'
];

describe('main() end-to-end (mocked model)', () => {
  let saved: Record<string, string | undefined>;
  let cwd: string;
  let workDir: string;

  beforeEach(async () => {
    saved = {};
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    // Direct mode with a throwaway key — the mocked client never uses it, but it
    // satisfies resolveEndpoint() so no real network config is consulted.
    process.env.NVIDIA_API_KEY = 'test-key';
    process.env.SKILLCHECK_NO_UPDATE_CHECK = '1';
    delete process.env.SKILLCHECK_TOKEN;
    delete process.env.SKILLCHECK_API_KEY;
    delete process.env.SKILLCHECK_API_URL;
    cwd = process.cwd();
    workDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-e2e-'));
    process.chdir(workDir);
    await writeFile(
      path.join(workDir, 'SKILL.md'),
      '---\ndomain: writing clear commit messages\n---\n# Commit Skill\n\nAlways explain the why.\n'
    );
  });

  afterEach(() => {
    process.chdir(cwd);
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.restoreAllMocks();
  });

  it('runs `eval` end-to-end and reports a HELPS verdict as JSON', async () => {
    const { stdout } = await runMain(['node', 'skillcheck', 'eval', 'SKILL.md', '--tasks', '2', '--trials', '1']);
    const result = JSON.parse(stdout);
    expect(result.result.verdict).toBe('helps');
    expect(result.result.with_skill_pass).toBe(1);
    expect(result.result.no_skill_pass).toBe(0);
    expect(result.result.effect_pp).toBe(100);
    expect(result.result.token_overhead).toBe(80); // 100 (with) - 20 (without)
    expect(result.config.tasks).toBe(2);
    expect(result.skill.domain).toMatch(/commit messages/);
  });

  it('runs `check --json` end-to-end through the friendly command', async () => {
    const { stdout } = await runMain(['node', 'skillcheck', 'check', 'SKILL.md', '--tasks', '2', '--trials', '1', '--json']);
    const result = JSON.parse(stdout);
    expect(result.result.verdict).toBe('helps');
  });

  it('renders the human result card for `check` on a non-TTY', async () => {
    const { stdout } = await runMain(['node', 'skillcheck', 'check', 'SKILL.md', '--tasks', '2', '--trials', '1']);
    expect(stdout).toContain('SKILLCHECK RESULT');
    expect(stdout).toContain('HELPS');
    expect(stdout).toContain('Satisfaction');
  });

  it('attaches a per-task breakdown with example outputs under `--explain --json`', async () => {
    const { stdout } = await runMain(['node', 'skillcheck', 'check', 'SKILL.md', '--tasks', '2', '--trials', '1', '--explain', '--json']);
    const result = JSON.parse(stdout);
    expect(result.explain.tasks).toHaveLength(2);
    const task = result.explain.tasks[0];
    expect(task.with_skill_pass_rate).toBe(1);
    expect(task.no_skill_pass_rate).toBe(0);
    expect(task.delta_pp).toBe(100);
    expect(task.label).toBe('helped');
    expect(task.example_with.output).toContain('the task is handled');
    expect(task.example_with.pass).toBe(true);
    expect(task.example_without.pass).toBe(false);
  });

  it('prints the per-task breakdown below the card for human output', async () => {
    const { stdout } = await runMain(['node', 'skillcheck', 'check', 'SKILL.md', '--tasks', '2', '--trials', '1', '--explain']);
    expect(stdout).toContain('Per-task breakdown');
    expect(stdout).toContain('helped');
    expect(stdout).toContain('with skill');
  });

  it('omits the breakdown when --explain is not set', async () => {
    const { stdout } = await runMain(['node', 'skillcheck', 'check', 'SKILL.md', '--tasks', '2', '--trials', '1', '--json']);
    expect(JSON.parse(stdout).explain).toBeUndefined();
  });

  it('saves a verifiable result with `--output`, then `verify` reproduces it', async () => {
    await runMain(['node', 'skillcheck', 'eval', 'SKILL.md', '--tasks', '2', '--trials', '1', '--output', 'result.json']);
    const saved = JSON.parse(await readFile(path.join(workDir, 'result.json'), 'utf8'));
    expect(saved.reproducibility.task_suite_path).toBeTruthy();
    expect(saved.result.verdict).toBe('helps');

    const { stdout } = await runMain(['node', 'skillcheck', 'verify', 'result.json', '--sample', '2']);
    const verified = JSON.parse(stdout);
    expect(verified.passed).toBe(true);
    expect(verified.verify_verdict).toBe('helps');
  });

  it('prints the version for `version` / `--version`', async () => {
    const { stdout } = await runMain(['node', 'skillcheck', 'version']);
    expect(stdout).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('rejects an unknown command with a helpful message', async () => {
    await expect(runMain(['node', 'skillcheck', 'frobnicate'])).rejects.toThrow(/Unknown command/i);
  });

  it('reports a missing-file path error rather than "unknown command"', async () => {
    await expect(runMain(['node', 'skillcheck', './nope.md'])).rejects.toThrow(/Path not found/i);
  });

  it('refuses to run without a key on a non-interactive terminal', async () => {
    delete process.env.NVIDIA_API_KEY;
    process.env.SKILLCHECK_CONFIG_DIR = await mkdtemp(path.join(tmpdir(), 'skillcheck-nokey-'));
    await expect(
      runMain(['node', 'skillcheck', 'check', 'SKILL.md', '--tasks', '2', '--trials', '1'])
    ).rejects.toThrow(/needs an API key/i);
  });
});
