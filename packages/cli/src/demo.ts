import { sleep } from './adapters/http.js';
import type { EvalResult } from './eval.js';
import { printBanner, printCheckHeader, printResultCard, startProgress } from './ui.js';
import { paint } from './ui/theme.js';

export async function runDemo(): Promise<void> {
  printBanner();
  printCheckHeader('demo/SKILL.md (Code Review & Security Auditor)', 3, 3);

  const progress = startProgress();

  if (progress) {
    progress.update({ phase: 'generating', completed: 1, total: 3 });
    await sleep(250);
    progress.update({ phase: 'generating', completed: 2, total: 3 });
    await sleep(250);
    progress.update({ phase: 'generating', completed: 3, total: 3 });
    await sleep(200);

    const totalTrials = 6;
    for (let i = 1; i <= totalTrials; i += 1) {
      progress.update({ phase: 'running', completed: i, total: totalTrials });
      await sleep(100);
    }

    for (let i = 1; i <= totalTrials; i += 1) {
      progress.update({ phase: 'grading', completed: i, total: totalTrials });
      await sleep(100);
    }

    progress.update({ phase: 'scoring' });
    await sleep(200);
    progress.finish();
  }

  const demoResult: EvalResult = {
    skill: {
      name: 'Code Review & Security Auditor',
      source: 'demo/SKILL.md',
      format: 'SKILL.md',
      commit_hash: '9a8b7c6d5e4f3a2b1c0d',
      domain: 'security-review',
      tool_dependent: false
    },
    config: {
      runner_model: 'anthropic/claude-3.5-sonnet',
      grader_model: 'openai/gpt-4o',
      generator_model: 'openai/gpt-4o',
      trials: 3,
      tasks: 3,
      temperature: 0,
      mode: 'forced'
    },
    result: {
      effect_pp: 22.2,
      mean_effect_pp: 22.2,
      satisfaction: 78.5,
      ci_pp: [5.6, 38.9],
      verdict: 'helps',
      with_skill_pass: 0.778,
      no_skill_pass: 0.556,
      token_overhead: 412,
      value_per_1k_tokens: 53.88,
      low_sample: true
    },
    low_sample: true,
    tasks: [
      {
        id: 'task-1',
        prompt: 'Audit an Express endpoint for IDOR vulnerabilities and missing authorization checks.',
        criterion_type: 'rubric',
        criterion: 'Identifies missing tenant check on req.params.id and provides atomic SQL query.',
        with_skill_pass_rate: 1.0,
        no_skill_pass_rate: 0.67
      },
      {
        id: 'task-2',
        prompt: 'Review a Next.js Server Action handling file uploads for path traversal bugs.',
        criterion_type: 'rubric',
        criterion: 'Detects unsafe filename joining and verifies sanitized destination directory.',
        with_skill_pass_rate: 0.67,
        no_skill_pass_rate: 0.33
      },
      {
        id: 'task-3',
        prompt: 'Evaluate a cryptographic token comparison against timing side-channel attacks.',
        criterion_type: 'rubric',
        criterion: 'Recommends crypto.timingSafeEqual over triple-equals operator.',
        with_skill_pass_rate: 0.67,
        no_skill_pass_rate: 0.67
      }
    ],
    reproducibility: {
      transcript_hashes: ['demo-hash-1', 'demo-hash-2', 'demo-hash-3']
    },
    history: [],
    run_date: new Date().toISOString().slice(0, 10)
  };

  await printResultCard(demoResult);

  console.log(`\n  ${paint.accent('[demo]')} ${paint.dim('This was a simulated demo run with zero API keys required.')}`);
  console.log(`  ${paint.bold('To test your own agent skill, .cursorrules, or CLAUDE.md:')}`);
  console.log(`    ${paint.accent('npx @sx4im/skillcheck check ./SKILL.md')}\n`);
}
