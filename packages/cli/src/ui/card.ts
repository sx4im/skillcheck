import process from 'node:process';
import { cloudPricingUrl } from '../config.js';
import { satisfactionFromEffect } from '../score.js';
import { BOX, SYM, epaint, layoutWidth, padDisplay, paint, truncateDisplay, wrapText } from './theme.js';
import { CancelledError, exitOnInterrupt } from './picker.js';

type Paint = (value: string) => string;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function formatPercent(value: unknown): string {
  return typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : 'n/a';
}

function verdictBadge(verdict: string): string {
  if (verdict === 'helps') {
    return paint.badge('HELPS', 'ok');
  }
  if (verdict === 'harms') {
    return paint.badge('HARMS', 'err');
  }
  return paint.badge(verdict.toUpperCase(), 'warn');
}

function satisfactionFromResult(score: Record<string, unknown>): number {
  if (typeof score.satisfaction === 'number') {
    return Math.max(0, Math.min(100, score.satisfaction));
  }
  // Result JSONs from before the satisfaction field existed: recompute it.
  const effect = typeof score.effect_pp === 'number' ? score.effect_pp : 0;
  return satisfactionFromEffect(effect);
}

function satisfactionBand(score: number): { label: string; paint: Paint } {
  if (score <= 10) return { label: 'Very bad', paint: paint.err };
  if (score <= 30) return { label: 'Bad', paint: paint.err };
  if (score <= 50) return { label: 'Normal', paint: paint.warn };
  if (score <= 60) return { label: 'Decent', paint: paint.warn };
  if (score <= 80) return { label: 'Good', paint: paint.ok };
  return { label: 'Excellent', paint: paint.ok };
}

const CARD_LABEL_WIDTH = 14;
const SATISFACTION_BAR_WIDTH = 18;

function satisfactionBar(score: number, fill: Paint): string {
  const filled = Math.max(0, Math.min(SATISFACTION_BAR_WIDTH, Math.round((SATISFACTION_BAR_WIDTH * score) / 100)));
  return `${fill(SYM.blockOn.repeat(filled))}${paint.dim(SYM.blockOff.repeat(SATISFACTION_BAR_WIDTH - filled))}`;
}

interface CardGeometry {
  width: number;
  content: number;
}

function cardGeometry(): CardGeometry {
  const width = layoutWidth(process.stdout);
  return { width, content: width - 4 };
}

function cardRow(geometry: CardGeometry, content: string): string {
  return `${paint.accent(BOX.v)} ${padDisplay(content, geometry.content)} ${paint.accent(BOX.v)}`;
}

function cardLabelRow(geometry: CardGeometry, label: string, value: string): string {
  const room = geometry.content - CARD_LABEL_WIDTH;
  return cardRow(geometry, `${paint.bold(label.padEnd(CARD_LABEL_WIDTH))}${truncateDisplay(value, room)}`);
}

function cardEdge(geometry: CardGeometry, kind: 'top' | 'mid' | 'bottom'): string {
  const left = kind === 'top' ? BOX.tl : kind === 'mid' ? BOX.ml : BOX.bl;
  const right = kind === 'top' ? BOX.tr : kind === 'mid' ? BOX.mr : BOX.br;
  return paint.accent(`${left}${BOX.h.repeat(geometry.width - 2)}${right}`);
}

function satisfactionLine(geometry: CardGeometry, finalScore: number, atScore: number): string {
  const current = satisfactionBand(atScore);
  const settled = satisfactionBand(finalScore);
  const bar = satisfactionBar(atScore, current.paint);
  const number = current.paint(`${atScore.toFixed(1).padStart(5)}/100`);
  return cardRow(
    geometry,
    `${paint.bold('Satisfaction'.padEnd(CARD_LABEL_WIDTH))}${bar} ${number}  ${settled.paint(settled.label.toUpperCase())}`
  );
}

function plainVerdict(verdict: string, withPass: unknown, noPass: unknown): string {
  const w = typeof withPass === 'number' ? `${Math.round(withPass * 100)}%` : 'n/a';
  const n = typeof noPass === 'number' ? `${Math.round(noPass * 100)}%` : 'n/a';
  if (verdict === 'helps') return `The skill HELPED — model passed ${w} of tasks with it vs ${n} without.`;
  if (verdict === 'harms') return `The skill HURT — model passed ${w} of tasks with it vs ${n} without.`;
  return `No measurable difference — ${w} passed with the skill, ${n} without.`;
}

function signedPp(value: unknown): string {
  if (typeof value !== 'number') return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)} pp`;
}

function countNoun(value: unknown, noun: string): string {
  if (typeof value !== 'number') return `n/a ${noun}s`;
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

function resultHeaderLines(geometry: CardGeometry, result: unknown, outputPath?: string): string[] {
  const root = asRecord(result);
  const skill = asRecord(root.skill);
  const config = asRecord(root.config);
  const score = asRecord(root.result);
  const ci = Array.isArray(score.ci_pp) ? score.ci_pp : [];
  const ciLow = typeof ci[0] === 'number' ? ci[0] : undefined;
  const ciHigh = typeof ci[1] === 'number' ? ci[1] : undefined;
  const ciText =
    ciLow !== undefined && ciHigh !== undefined ? `${signedPp(ciLow)} to ${signedPp(ciHigh)}` : 'n/a';
  const inconclusive =
    ciLow !== undefined && ciHigh !== undefined && ciLow < 0 && ciHigh > 0 && ciHigh - ciLow > 40;
  const verdict = String(score.verdict ?? 'unknown');
  const toolDependent = Boolean(skill.tool_dependent);

  const lines = [
    cardEdge(geometry, 'top'),
    cardRow(geometry, paint.bold('SKILLCHECK RESULT')),
    cardEdge(geometry, 'mid'),
    cardLabelRow(geometry, 'Skill', String(skill.name ?? 'unknown')),
    cardLabelRow(geometry, 'Run size', `${countNoun(config.tasks, 'task')} × ${countNoun(config.trials, 'trial')}`),
    cardRow(geometry, ''),
    cardLabelRow(geometry, 'Verdict', verdictBadge(verdict))
  ];
  for (const wrapped of wrapText(plainVerdict(verdict, score.with_skill_pass, score.no_skill_pass), geometry.content)) {
    lines.push(cardRow(geometry, paint.dim(wrapped)));
  }
  if (toolDependent) {
    for (const wrapped of wrapText(
      "Note: this skill's instructions reference script or file execution, results may not reflect real-world performance.",
      geometry.content
    )) {
      lines.push(cardRow(geometry, paint.warn(wrapped)));
    }
  }
  lines.push(cardRow(geometry, ''));
  lines.push(cardLabelRow(geometry, 'With skill', `${formatPercent(score.with_skill_pass)} of tasks passed`));
  lines.push(cardLabelRow(geometry, 'Without skill', `${formatPercent(score.no_skill_pass)} of tasks passed`));
  lines.push(cardLabelRow(geometry, 'Skill effect', `${signedPp(score.effect_pp)} ${paint.dim('change in pass rate')}`));
  lines.push(cardLabelRow(geometry, 'Confidence', `${ciText} ${paint.dim('(95% range)')}`));
  if (inconclusive) {
    for (const wrapped of wrapText('Wide range — inconclusive. Re-run with Thorough effort or more tasks.', geometry.content)) {
      lines.push(cardRow(geometry, paint.warn(wrapped)));
    }
  }
  lines.push(cardLabelRow(geometry, 'Token cost', `+${String(score.token_overhead ?? 'n/a')} ${paint.dim('tokens to include the skill')}`));
  if (outputPath) {
    lines.push(cardLabelRow(geometry, 'Saved JSON', outputPath));
  }
  lines.push(cardEdge(geometry, 'mid'));
  return lines;
}

export function formatResultCard(result: unknown, outputPath?: string): string {
  const geometry = cardGeometry();
  const score = asRecord(asRecord(result).result);
  const sat = satisfactionFromResult(score);
  return [...resultHeaderLines(geometry, result, outputPath), satisfactionLine(geometry, sat, sat), cardEdge(geometry, 'bottom')].join('\n');
}

function explainExampleLines(armLabel: string, mark: Paint, value: unknown, width: number): string[] {
  const example = asRecord(value);
  if (typeof example.output !== 'string' || example.output.length === 0) {
    return [];
  }
  const verdict = example.pass ? paint.ok('pass') : paint.err('fail');
  const lines = [`      ${mark(armLabel)} ${paint.dim(SYM.dot)} ${verdict}`];
  for (const wrapped of wrapText(example.output, width - 8)) {
    lines.push(`        ${paint.dim(wrapped)}`);
  }
  return lines;
}

export function formatExplain(result: unknown): string {
  const explain = asRecord(asRecord(result).explain);
  const tasks = Array.isArray(explain.tasks) ? explain.tasks : [];
  if (tasks.length === 0) {
    return '';
  }
  const width = layoutWidth(process.stdout, 78, 50);
  const lines: string[] = ['', `  ${paint.bold('Per-task breakdown')}`];

  for (const entry of tasks) {
    const task = asRecord(entry);
    const withPct = Math.round((typeof task.with_skill_pass_rate === 'number' ? task.with_skill_pass_rate : 0) * 100);
    const noPct = Math.round((typeof task.no_skill_pass_rate === 'number' ? task.no_skill_pass_rate : 0) * 100);
    const label = String(task.label ?? 'no change');
    const labelPaint = label === 'helped' ? paint.ok : label === 'hurt' ? paint.err : paint.dim;
    lines.push(
      `  ${paint.accent(String(task.id ?? '?'))}  ${paint.dim('with')} ${String(withPct).padStart(3)}%  ${paint.dim('without')} ${String(noPct).padStart(3)}%  ${signedPp(task.delta_pp)}  ${labelPaint(label)}`
    );
    for (const wrapped of wrapText(String(task.prompt ?? ''), width - 6)) {
      lines.push(`      ${paint.dim(wrapped)}`);
    }
    lines.push(...explainExampleLines('with skill', paint.ok, task.example_with, width));
    lines.push(...explainExampleLines('without', paint.accent, task.example_without, width));
  }
  return lines.join('\n');
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function printResultCard(result: unknown, outputPath?: string): Promise<void> {
  const geometry = cardGeometry();
  const score = asRecord(asRecord(result).result);
  const finalScore = satisfactionFromResult(score);

  if (!process.stdout.isTTY) {
    console.log(formatResultCard(result, outputPath));
    return;
  }

  console.log(resultHeaderLines(geometry, result, outputPath).join('\n'));
  const unregisterInterrupt = exitOnInterrupt(() => process.stdout.write('\x1b[?25h\n'));
  process.stdout.write('\x1b[?25l');
  try {
    const frames = 32;
    for (let i = 0; i <= frames; i += 1) {
      const at = finalScore * easeOutCubic(i / frames);
      process.stdout.write(`\r\x1b[2K${satisfactionLine(geometry, finalScore, at)}`);
      await sleep(24);
    }
    process.stdout.write(`\r\x1b[2K${satisfactionLine(geometry, finalScore, finalScore)}\n`);
  } finally {
    unregisterInterrupt();
    process.stdout.write('\x1b[?25h');
  }
  console.log(cardEdge(geometry, 'bottom'));
}

export function formatQuotaUpsell(): string {
  const geometry = cardGeometry();
  const lines = [
    cardEdge(geometry, 'top'),
    cardRow(geometry, paint.bold("You've used all your free Skillcheck runs.")),
    cardRow(geometry, paint.dim('Thanks for trying Skillcheck! To keep checking')),
    cardRow(geometry, paint.dim('skills, upgrade to the Pro plan:')),
    cardRow(geometry, ''),
    cardRow(geometry, `  ${paint.bold(truncateDisplay(cloudPricingUrl(), geometry.content - 2))}`),
    cardEdge(geometry, 'bottom')
  ];
  return lines.join('\n');
}

function isQuotaError(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error);
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? (error as { status?: unknown }).status
      : undefined;
  return status === 402 || /quota[_ ]?exceeded|payment required|free .*runs|used all|\b402\b/i.test(raw);
}

export function sanitizeCliError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/quota[_ ]?exceeded|payment required|free .*runs|\b402\b/i.test(raw)) {
    return raw.replace(/^\d+\s+/, '').replace(/NVIDIA(?:[_ -]?NIM)?/gi, 'Skillcheck Cloud');
  }
  if (/api[_ -]?key|credential|unauthorized|authentication|401/i.test(raw)) {
    return 'Skillcheck Cloud is not connected for this workspace. Please try again later or contact the workspace owner.';
  }
  return raw
    .replace(/NVIDIA(?:[_ -]?(?:NIM|API_KEY))?/gi, 'Skillcheck Cloud')
    .replace(/API[_ -]?KEY/gi, 'credential');
}

export function formatFatalError(error: unknown): string {
  if (error instanceof CancelledError) {
    return epaint.dim(error.message);
  }
  if (isQuotaError(error)) {
    return `${epaint.warn(`${SYM.diamond} Out of free runs`)}\n${formatQuotaUpsell()}`;
  }
  const message = sanitizeCliError(error);
  const body = message
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  return `${epaint.err(SYM.cross)} ${epaint.bold('Skillcheck stopped')}\n${body}`;
}

export function printUpdateAvailable(current: string, latest: string): void {
  const geometry = cardGeometry();
  console.log('');
  console.log(cardEdge(geometry, 'top'));
  console.log(cardRow(geometry, `${paint.bold('Update available')}   ${paint.dim(`v${current}`)} ${paint.accent(SYM.arrow)} ${paint.ok(`v${latest}`)}`));
  console.log(cardRow(geometry, paint.dim('A newer version of Skillcheck is ready to install.')));
  console.log(cardEdge(geometry, 'bottom'));
}

export function printUpdateApplied(latest: string): void {
  console.log(`${paint.ok(SYM.tick)} ${paint.bold(`Updated to v${latest}.`)} ${paint.dim('Re-run skillcheck to use the new version.')}\n`);
}

export function printUpdateSkipped(latest: string): void {
  console.log(`${paint.dim('Skipped. Update any time with')} ${paint.bold('npm install -g @sx4im/skillcheck')}${paint.dim(`  (v${latest})`)}\n`);
}

export function printUpdateFailed(): void {
  console.log(`${paint.warn('Could not update automatically.')} ${paint.dim('Run')} ${paint.bold('npm install -g @sx4im/skillcheck')} ${paint.dim('yourself.')}\n`);
}

export function printLogout(result: { removed: boolean; envOverride: boolean; path: string }): void {
  if (result.removed) {
    console.log(`${paint.ok(SYM.tick)} ${paint.bold('Signed out.')} ${paint.dim('Your saved API key was removed.')}`);
  } else {
    console.log(`${paint.dim('You were already signed out — no saved API key to remove.')}`);
  }
  if (result.envOverride) {
    console.log(
      `${paint.warn('Note:')} ${paint.dim('a key is still set via SKILLCHECK_TOKEN in your environment; unset it to fully sign out.')}`
    );
  }
  console.log(`${paint.dim('Sign in again any time with')} ${paint.bold('skillcheck setup')}${paint.dim('.')}`);
}
