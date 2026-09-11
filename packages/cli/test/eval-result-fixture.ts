import type { EvalResult } from '../src/eval.js';

type Overrides = Omit<Partial<EvalResult>, 'skill' | 'config' | 'result'> & {
  skill?: Partial<EvalResult['skill']>;
  config?: Partial<EvalResult['config']>;
  result?: Partial<EvalResult['result']>;
};

export function evalResultFixture(overrides: Overrides = {}): EvalResult {
  return {
    tasks: [],
    reproducibility: { transcript_hashes: [] },
    history: [],
    run_date: '2026-01-01',
    ...overrides,
    skill: { name: 'Demo', source: './SKILL.md', format: 'markdown', commit_hash: 'abc', domain: 'general', tool_dependent: false, ...overrides.skill },
    config: { runner_model: 'runner', grader_model: 'grader', generator_model: 'generator', trials: 2, tasks: 3, temperature: 0.7, mode: 'forced', ...overrides.config },
    result: { effect_pp: 25, mean_effect_pp: 25, satisfaction: 75, ci_pp: [5, 45], verdict: 'helps', with_skill_pass: 0.75, no_skill_pass: 0.5, token_overhead: 120, value_per_1k_tokens: 0, ...overrides.result }
  };
}
