import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evalSkill } from '../src/eval.js';
import { formatResultCard } from '../src/ui/card.js';
import { evalResultFixture } from './eval-result-fixture.js';

vi.mock('../src/adapters/openai-compat.js', async () => {
  const { FakeOpenAiCompatClient } = await import('./helpers.js');
  return { OpenAiCompatClient: FakeOpenAiCompatClient };
});

const SKILL_MD = '---\ndomain: code review\n---\n# Review Skill\nReview code carefully.\n';

describe('small sample honesty', () => {
  let workDir: string;
  let savedEnv: string | undefined;

  beforeEach(async () => {
    savedEnv = process.env.NVIDIA_API_KEY;
    process.env.NVIDIA_API_KEY = 'test-key';
    workDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-sample-'));
    await writeFile(path.join(workDir, 'SKILL.md'), SKILL_MD);
  });

  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = savedEnv;
    await rm(workDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('flags low_sample: true and logs a warning when tasks x trials is below threshold', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Quick profile: 2 tasks x 1 trial = 2 observations (< 9 threshold)
    const result = await evalSkill({
      inputPath: path.join(workDir, 'SKILL.md'),
      tasks: 2,
      trials: 1,
      mode: 'forced',
      useCache: false,
      saveArtifacts: false
    });

    expect(result.result.low_sample).toBe(true);
    expect(result.low_sample).toBe(true);
    expect(['helps', 'placebo', 'harms']).toContain(result.result.verdict);

    const warningLogged = errorSpy.mock.calls.some((args) =>
      args.some((arg) => typeof arg === 'string' && /low sample/i.test(arg))
    );
    expect(warningLogged).toBe(true);
  });

  it('flags low_sample: false and does not log a warning when tasks x trials is at or above threshold', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Standard profile: 3 tasks x 3 trials = 9 observations (>= 9 threshold)
    const result = await evalSkill({
      inputPath: path.join(workDir, 'SKILL.md'),
      tasks: 3,
      trials: 3,
      mode: 'forced',
      useCache: false,
      saveArtifacts: false
    });

    expect(result.result.low_sample).toBe(false);
    expect(result.low_sample).toBe(false);

    const warningLogged = errorSpy.mock.calls.some((args) =>
      args.some((arg) => typeof arg === 'string' && /low sample/i.test(arg))
    );
    expect(warningLogged).toBe(false);
  });

  it('renders a warning note on the result card when low_sample is true', () => {
    const lowSampleResult = evalResultFixture({
      config: { tasks: 2, trials: 1 },
      result: {
        effect_pp: 20,
        mean_effect_pp: 20,
        satisfaction: 70,
        ci_pp: [5, 35],
        verdict: 'helps',
        with_skill_pass: 0.8,
        no_skill_pass: 0.6,
        token_overhead: 50,
        value_per_1k_tokens: 4,
        low_sample: true
      },
      low_sample: true
    });

    const card = formatResultCard(lowSampleResult);
    expect(card).toMatch(/small sample/i);
  });
});
