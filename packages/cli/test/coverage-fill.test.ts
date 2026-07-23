import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { NvidiaNimClient } from '../src/adapters/nvidia-nim.js';
import { JsonCache } from '../src/cache.js';
import type { NvidiaConfig } from '../src/env.js';
import { gradeDeterministically } from '../src/deterministic.js';
import { evalSkill } from '../src/eval.js';
import { generateTasks } from '../src/generate.js';
import { gradeOutputs } from '../src/grade.js';
import { normalizeSkill } from '../src/normalize.js';
import { runTrials } from '../src/run.js';
import type { NormalizedSkill } from '../src/types.js';
import {
  colorLevel,
  layoutWidth,
  makePalette,
  padDisplay,
  stripAnsi,
  truncateDisplay,
  visibleWidth,
  wrapText
} from '../src/theme.js';
import type { GeneratedTask, TrialOutput } from '../src/types.js';
import { verifyResult } from '../src/verify.js';

const config: NvidiaConfig = {
  apiKey: 'test',
  baseUrl: 'https://example.test/v1',
  timeoutMs: 1000,
  requestDelayMs: 0,
  maxAttempts: 4,
  maxRetryDelayMs: 1,
  generatorModel: 'g',
  graderModel: 'gr',
  runnerModel: 'r'
};

function fakeClient(reply: (system: string, user: string) => string): NvidiaNimClient {
  return {
    complete: async ({ messages }: { messages: Array<{ role: string; content: string }> }) => ({
      content: reply(
        messages.find((m) => m.role === 'system')?.content ?? '',
        messages.find((m) => m.role === 'user')?.content ?? ''
      ),
      model: 'fake',
      usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 }
    })
  } as unknown as NvidiaNimClient;
}

function trial(over: Partial<TrialOutput>): TrialOutput {
  return {
    taskId: 't001',
    trial: 1,
    arm: 'with_skill',
    output: '',
    model: 'fake',
    promptTokens: 10,
    completionTokens: 1,
    totalTokens: 11,
    transcriptHash: `sha256:${Math.random()}`,
    ...over
  };
}

describe('theme color + width helpers', () => {
  const prev = { ...process.env };
  afterEach(() => {
    process.env.NO_COLOR = prev.NO_COLOR;
    process.env.FORCE_COLOR = prev.FORCE_COLOR;
    if (prev.NO_COLOR === undefined) delete process.env.NO_COLOR;
    if (prev.FORCE_COLOR === undefined) delete process.env.FORCE_COLOR;
  });

  it('paints with truecolor, 256, and plain palettes', () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = '3';
    const truecolor = makePalette({ isTTY: true });
    expect(truecolor.badge('HELPS', 'ok')).toContain('HELPS');
    expect(truecolor.brand(0.5)('x')).toContain('\x1b[');
    expect(colorLevel({ isTTY: true })).toBe(3);

    process.env.FORCE_COLOR = '2';
    expect(makePalette({ isTTY: true }).brand(0.5)('x')).toContain('38;5;');

    process.env.NO_COLOR = '1';
    const plain = makePalette({ isTTY: true });
    expect(plain.badge('X', 'ok')).toBe('X');
    expect(plain.accent('x')).toBe('x');
    expect(colorLevel({ isTTY: true })).toBe(0);
  });

  it('measures, pads, truncates, and wraps display text', () => {
    expect(visibleWidth('\x1b[1mhi\x1b[0m')).toBe(2);
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
    expect(padDisplay('ab', 5)).toBe('ab   ');
    expect(truncateDisplay('short', 10)).toBe('short');
    expect(truncateDisplay('abcdefghij', 5)).toMatch(/…/);
    expect(wrapText('one two three four', 8)).toEqual(['one two', 'three', 'four']);
    expect(wrapText('   ', 8)).toEqual(['']);
  });

  it('clamps layout width to sane bounds', () => {
    expect(layoutWidth({ columns: 5 })).toBe(42); // floor
    expect(layoutWidth({ columns: 9999 })).toBe(58); // ceiling
  });
});

describe('normalize edge cases', () => {
  it('derives a readable name from a markdown filename', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-norm-'));
    const file = path.join(dir, 'frontend-design.md');
    await writeFile(file, 'Plain markdown body with no heading.\n');
    const skill = await normalizeSkill(file);
    expect(skill.format).toBe('markdown');
    expect(skill.name).toBe('frontend design');
    expect(skill.domain).toBe('general agent skill');
  });

  it('falls back to the first .md by name inside a folder', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-norm-'));
    await writeFile(path.join(dir, 'zeta.md'), '# Zeta\n');
    await writeFile(path.join(dir, 'alpha.md'), '# Alpha\n');
    const skill = await normalizeSkill(dir);
    expect(skill.name).toBe('Alpha'); // sorted, first by name
  });

  it('rejects a folder with no markdown and a non-markdown file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-norm-'));
    await writeFile(path.join(dir, 'notes.txt'), 'nope');
    await expect(normalizeSkill(dir)).rejects.toThrow(/No \.md file/);
    await expect(normalizeSkill(path.join(dir, 'notes.txt'))).rejects.toThrow(/only analyzes Markdown/);
  });
});

describe('generateTasks happy path', () => {
  it('returns the requested number of validated tasks', async () => {
    const tasks = Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, prompt: `Prompt ${i}`, criterion: `Crit ${i}` }));
    const client = fakeClient(() => JSON.stringify({ tasks }));
    const result = await generateTasks({ domain: 'demo', count: 3 }, config, client, JsonCache.disabled());
    expect(result).toHaveLength(3);
    expect(result.map((t) => t.id)).toEqual(['t001', 't002', 't003']);
  });

  it('extracts JSON embedded in surrounding prose', async () => {
    const tasks = Array.from({ length: 4 }, (_, i) => ({ id: `x${i}`, prompt: `P${i}`, criterion: `C${i}` }));
    const client = fakeClient(() => `Sure! Here you go:\n${JSON.stringify({ tasks })}\nHope that helps.`);
    const result = await generateTasks({ domain: 'demo', count: 2 }, config, client, JsonCache.disabled());
    expect(result).toHaveLength(2);
  });
});

describe('grading paths', () => {
  const tasks: GeneratedTask[] = [
    { id: 't001', prompt: 'p', criterionType: 'rubric', criterion: 'must do the thing' }
  ];

  it('passes a JSON grader verdict and a deterministic includes criterion', async () => {
    const client = fakeClient(() => '{"score":1,"reason":"good"}');
    const graded = await gradeOutputs(
      tasks,
      [trial({ arm: 'with_skill', output: 'done' }), trial({ arm: 'no_skill', output: 'done', trial: 1, transcriptHash: 'sha256:b' })],
      config,
      client,
      JsonCache.disabled()
    );
    expect(graded.every((g) => g.pass)).toBe(true);
  });

  it('falls back to a heuristic when the grader ignores JSON mode', async () => {
    const passClient = fakeClient(() => 'The output clearly passes the requirement.');
    const failClient = fakeClient(() => 'It does not pass; the requirement is unmet.');
    const passed = await gradeOutputs(tasks, [trial({ output: 'x' })], config, passClient, JsonCache.disabled());
    const failed = await gradeOutputs(tasks, [trial({ output: 'y', transcriptHash: 'sha256:c' })], config, failClient, JsonCache.disabled());
    expect(passed[0]!.pass).toBe(true);
    expect(failed[0]!.pass).toBe(false);
  });

  it('grades deterministic regex / includes criteria offline', () => {
    expect(gradeDeterministically({ id: 't', prompt: '', criterionType: 'deterministic', criterion: 'regex:^OK$' }, 'OK').pass).toBe(true);
    expect(gradeDeterministically({ id: 't', prompt: '', criterionType: 'deterministic', criterion: 'regex:^OK$' }, 'no').pass).toBe(false);
    expect(gradeDeterministically({ id: 't', prompt: '', criterionType: 'deterministic', criterion: 'includes:foo' }, 'a foo b').pass).toBe(true);
    expect(() => gradeDeterministically({ id: 't', prompt: '', criterionType: 'deterministic', criterion: 'unknown:x' }, 'a')).toThrow(/Unsupported/);
    expect(() => gradeDeterministically({ id: 't', prompt: '', criterionType: 'rubric', criterion: 'x' }, 'a')).toThrow(/not deterministic/);
  });
});

describe('error surfaces', () => {
  it('refuses to verify a result that is missing reproducibility metadata', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-verify-'));
    const file = path.join(dir, 'result.json');
    await writeFile(file, JSON.stringify({ skill: {}, result: {}, config: {} }));
    await expect(verifyResult({ resultPath: file, sample: 1 })).rejects.toThrow(/cannot be verified/i);
  });

  it('rejects an empty task suite in eval', async () => {
    const prev = process.env.NVIDIA_API_KEY;
    process.env.NVIDIA_API_KEY = 'test-key';
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-eval-'));
    await writeFile(path.join(dir, 'SKILL.md'), '# Demo\n\ndomain: x\n');
    await writeFile(path.join(dir, 'tasks.json'), '[]');
    try {
      await expect(
        evalSkill({ inputPath: path.join(dir, 'SKILL.md'), tasks: 3, trials: 1, mode: 'forced', taskSuite: path.join(dir, 'tasks.json') })
      ).rejects.toThrow(/No evaluation tasks/i);
    } finally {
      if (prev === undefined) delete process.env.NVIDIA_API_KEY;
      else process.env.NVIDIA_API_KEY = prev;
    }
  });
});

describe('more grading + generation + run branches', () => {
  const skill: NormalizedSkill = {
    name: 'S',
    sourcePath: 'SKILL.md',
    format: 'SKILL.md',
    instructions: 'do it well',
    domain: 'd',
    assets: [],
    versionHash: 'h'
  };

  it('grades a deterministic task without calling the model, and a score-0 verdict as a fail', async () => {
    const detTask: GeneratedTask = { id: 't001', prompt: 'p', criterionType: 'deterministic', criterion: 'includes:DONE' };
    const throwClient = { complete: async () => { throw new Error('should not be called'); } } as unknown as NvidiaNimClient;
    const det = await gradeOutputs([detTask], [trial({ output: 'DONE here' })], config, throwClient, JsonCache.disabled());
    expect(det[0]!.pass).toBe(true);

    const rubric: GeneratedTask[] = [{ id: 't001', prompt: 'p', criterionType: 'rubric', criterion: 'c' }];
    const failClient = fakeClient(() => '{"score":0,"reason":"missed"}');
    const failed = await gradeOutputs(rubric, [trial({ output: 'x' })], config, failClient, JsonCache.disabled());
    expect(failed[0]!.pass).toBe(false);
  });

  it('retries the grader when its first JSON reply is malformed', async () => {
    const rubric: GeneratedTask[] = [{ id: 't001', prompt: 'p', criterionType: 'rubric', criterion: 'c' }];
    let calls = 0;
    const flaky = {
      complete: async () => {
        calls += 1;
        // A reply that starts with '{' but is never closed forces a JSON parse
        // error (the heuristic fallback only applies to non-'{' replies).
        return { content: calls === 1 ? '{"score": 1' : '{"score":1}', model: 'fake', usage: {} };
      }
    } as unknown as NvidiaNimClient;
    const graded = await gradeOutputs(rubric, [trial({ output: 'x' })], config, flaky, JsonCache.disabled());
    expect(graded[0]!.pass).toBe(true);
    expect(calls).toBe(2);
  });

  it('accepts a bare JSON array from the generator', async () => {
    const arr = Array.from({ length: 6 }, (_, i) => ({ id: `g${i}`, prompt: `P${i}`, criterion: `C${i}` }));
    const client = fakeClient(() => JSON.stringify(arr));
    const result = await generateTasks({ domain: 'd', count: 3 }, config, client, JsonCache.disabled());
    expect(result).toHaveLength(3);
  });

  it('runs trials in debug mode and tolerates a response with no usage block', async () => {
    const prev = process.env.SKILLCHECK_DEBUG;
    process.env.SKILLCHECK_DEBUG = '1';
    const noUsage = { complete: async () => ({ content: 'ans', model: 'fake' }) } as unknown as NvidiaNimClient;
    try {
      const outputs = await runTrials(
        skill,
        [{ id: 't001', prompt: 'p', criterionType: 'rubric', criterion: 'c' }],
        1,
        config,
        noUsage,
        JsonCache.disabled()
      );
      expect(outputs).toHaveLength(2);
      expect(outputs[0]!.promptTokens).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.SKILLCHECK_DEBUG;
      else process.env.SKILLCHECK_DEBUG = prev;
    }
  });
});
