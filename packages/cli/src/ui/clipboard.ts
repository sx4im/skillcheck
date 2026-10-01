import type { EvalResult } from '../eval.js';

/**
 * Builds an OSC 52 terminal escape sequence to copy text directly
 * to the user's host clipboard without requiring OS-specific binaries.
 * If running inside tmux, wraps in DCS passthrough.
 */
export function buildOsc52Sequence(text: string, isTmux = Boolean(process.env.TMUX)): string {
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  const osc = `\x1b]52;c;${b64}\x07`;
  if (isTmux) {
    return `\x1bPtmux;\x1b${osc}\x1b\\`;
  }
  return osc;
}

/**
 * Copies plain text to the host system clipboard via OSC 52.
 * Returns true if the sequence was written, false if stdout is unavailable.
 */
export function copyToClipboardOsc52(text: string, stream: NodeJS.WriteStream = process.stdout): boolean {
  try {
    const seq = buildOsc52Sequence(text);
    stream.write(seq);
    return true;
  } catch {
    return false;
  }
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function pp(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)} pp`;
}

/**
 * Formats an evaluation result into a standardized, ready-to-paste
 * GitHub pull request review markdown comment with collapsible task details.
 */
export function formatPrMarkdown(result: EvalResult): string {
  const verdictUpper = result.result.verdict.toUpperCase();
  const [ciLow, ciHigh] = result.result.ci_pp;
  const ciRange = `${ciLow >= 0 ? '+' : ''}${ciLow.toFixed(1)} pp to ${ciHigh >= 0 ? '+' : ''}${ciHigh.toFixed(1)} pp`;

  const lines: string[] = [
    `### 🧪 Skillcheck Evaluation: \`${result.skill.name}\``,
    '',
    `**Verdict**: \`${verdictUpper}\` (${pp(result.result.effect_pp)} effect size) | **Confidence**: ${ciRange} (95% CI)`,
    `**Satisfaction**: \`${result.result.satisfaction.toFixed(1)}/100\` | **Token Overhead**: +${result.result.token_overhead} tokens`,
    '',
    '| Metric | With Skill | Without Skill | Effect Size |',
    '|---|---|---|---|',
    `| **Pass Rate** | **${pct(result.result.with_skill_pass)}** | ${pct(result.result.no_skill_pass)} | **${pp(result.result.effect_pp)}** |`,
    `| **Evaluation Size** | ${result.config.tasks} tasks × ${result.config.trials} trials | ${result.config.tasks} tasks × ${result.config.trials} trials | Paired, double-blind |`,
    `| **Models** | Runner: \`${result.config.runner_model}\` | Grader: \`${result.config.grader_model}\` | Temp: ${result.config.temperature} |`,
    ''
  ];

  if (result.tasks && result.tasks.length > 0) {
    lines.push(`<details>`);
    lines.push(`<summary>Per-task breakdown (${result.tasks.length} tasks)</summary>`);
    lines.push('');
    for (let i = 0; i < result.tasks.length; i += 1) {
      const task = result.tasks[i]!;
      const diff = (task.with_skill_pass_rate - task.no_skill_pass_rate) * 100;
      const tag = diff > 0 ? '`HELPED`' : diff < 0 ? '`HURT`' : '`NEUTRAL`';
      lines.push(`- **Task ${i + 1}** (${tag}): With skill: ${pct(task.with_skill_pass_rate)} vs Baseline: ${pct(task.no_skill_pass_rate)} (${pp(diff)})`);
      lines.push(`  > *Prompt:* ${task.prompt}`);
      lines.push(`  > *Criterion:* ${task.criterion}`);
    }
    lines.push('</details>');
    lines.push('');
  }

  lines.push('<sub>Tested with [Skillcheck](https://github.com/sx4im/skillcheck) — Controlled A/B testing for AI agent skills.</sub>');
  return lines.join('\n');
}
