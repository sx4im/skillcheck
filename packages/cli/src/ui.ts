import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { cloudPricingUrl } from './config.js';
import type { ProgressUpdate } from './types.js';

// Conventional skill filenames, shown only as hints. The actual rule is simple:
// Skillcheck analyzes Markdown (.md) files.
const CONVENTIONAL_SKILL_FILES = ['SKILL.md', 'AGENTS.md', 'CLAUDE.md'];
const isMarkdownFile = (filePath: string): boolean => path.extname(filePath).toLowerCase() === '.md';
const useColor = () => process.stdout.isTTY && process.env.NO_COLOR !== '1';
const color = (code: string, value: string): string => (useColor() ? `\x1b[${code}m${value}\x1b[0m` : value);
const blue = (value: string): string => color('38;5;33', value);
const white = (value: string): string => color('1;97', value);
const dim = (value: string): string => color('2', value);
const red = (value: string): string => color('1;31', value);
const green = (value: string): string => color('1;32', value);
const yellow = (value: string): string => color('1;33', value);

type Paint = (value: string) => string;

interface PickerEntry {
  label: string;
  fullPath: string;
  kind: 'parent' | 'directory' | 'file';
  runnable: boolean;
  note: string;
}

interface Keypress {
  sequence?: string;
  name?: string;
  ctrl?: boolean;
}

// Big "ANSI Shadow" block-letter glyphs (6 rows tall) for the hero wordmark. Only the
// letters in SKILL / CHECK are defined. `█` is the solid fill; `═ ║ ╔ ╗ ╚ ╝` form the
// outline. We paint fill and outline separately to get the reference look: a colour-
// filled letter with a bright outline — the old dark-blue ASCII art was invisible.
const GLYPH_ROWS = 6;
const OUTLINE_CHARS = new Set(['═', '║', '╔', '╗', '╚', '╝']);
const GLYPHS: Record<string, string[]> = {
  S: ['███████╗', '██╔════╝', '███████╗', '╚════██║', '███████║', '╚══════╝'],
  K: ['██╗  ██╗', '██║ ██╔╝', '█████╔╝ ', '██╔═██╗ ', '██║  ██╗', '╚═╝  ╚═╝'],
  I: ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
  L: ['██╗     ', '██║     ', '██║     ', '██║     ', '███████╗', '╚══════╝'],
  C: [' ██████╗', '██╔════╝', '██║     ', '██║     ', '╚██████╗', ' ╚═════╝'],
  H: ['██╗  ██╗', '██║  ██║', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝']
};

// Colour a single rendered row: runs of `█` get the fill colour, the outline glyphs
// get the outline colour, spaces are left untouched. Run-grouped so the output stays
// compact instead of one escape sequence per character.
function paintBlocks(line: string, fill: Paint, outline: Paint): string {
  const chars = Array.from(line);
  const classOf = (c: string): 'fill' | 'outline' | 'space' =>
    c === '█' ? 'fill' : OUTLINE_CHARS.has(c) ? 'outline' : 'space';
  let out = '';
  let i = 0;
  while (i < chars.length) {
    const kind = classOf(chars[i]!);
    let j = i;
    while (j < chars.length && classOf(chars[j]!) === kind) {
      j += 1;
    }
    const run = chars.slice(i, j).join('');
    out += kind === 'fill' ? fill(run) : kind === 'outline' ? outline(run) : run;
    i = j;
  }
  return out;
}

// Render a word as GLYPH_ROWS coloured lines, glyphs separated by one space column.
function renderWord(word: string, fill: Paint, outline: Paint): string[] {
  const rows: string[] = [];
  for (let r = 0; r < GLYPH_ROWS; r += 1) {
    const row = Array.from(word)
      .map((ch) => GLYPHS[ch]?.[r] ?? '')
      .join(' ');
    rows.push(paintBlocks(row, fill, outline));
  }
  return rows;
}

// The hero wordmark: "SKILL" in solid white over "CHECK" in blue with a white outline,
// then a one-line, plain-English tagline. Returned as lines so the file picker can
// embed the very same banner in its full-screen frame.
export function bannerLines(): string[] {
  const indent = '  ';
  const lines: string[] = [''];
  for (const line of renderWord('SKILL', white, white)) {
    lines.push(indent + line);
  }
  for (const line of renderWord('CHECK', blue, white)) {
    lines.push(indent + line);
  }
  lines.push(`${indent}${white('Is your skill actually helping the model?')}`);
  lines.push('');
  return lines;
}

export function printBanner(): void {
  console.log(bannerLines().join('\n'));
}

export function printHelpUi(): void {
  printBanner();
  console.log(`${blue('Quick start')}`);
  console.log(`  ${white('skillcheck')} ${blue('check')} path/to/SKILL.md`);
  console.log(`  ${white('skillcheck')} path/to/skill-folder\n`);
  console.log(`${blue('Supported inputs')}`);
  console.log(`  Any Markdown (.md) file — e.g. ${CONVENTIONAL_SKILL_FILES.join(', ')} — or a folder containing one\n`);
  console.log(`${blue('Commands')}`);
  console.log(`  skillcheck setup            ${dim('connect your free API key')}`);
  console.log(`  skillcheck logout           ${dim('remove your saved API key')}`);
  console.log(`  skillcheck check <path> [--tasks N] [--trials K] [--output file.json] [--json]`);
  console.log(`  skillcheck eval <path> [--tasks N] [--trials K] [--output file.json]`);
  console.log(`  skillcheck verify <result.json> [--sample n]`);
  console.log(`  skillcheck corpus run --corpus corpus.json [--results dir]`);
  console.log(`  skillcheck rot [--results dir] [--output file.json]\n`);
}

export async function promptText(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export function printSetupIntro(webUrl: string): void {
  console.log(`${blue('First, connect your free account.')} ${dim('(about 30 seconds)')}\n`);
  console.log(`  ${white('1.')} Open this page in your web browser:`);
  console.log(`     ${white(webUrl)}`);
  console.log(`  ${white('2.')} Sign in with Google or GitHub ${dim('— free, includes 10 checks')}`);
  console.log(`  ${white('3.')} Copy your key ${dim('(it starts with')} ${green('chk_live_')}${dim(')')}`);
  console.log(`  ${white('4.')} Paste it here below.\n`);
}

export function printKeyChecking(): void {
  process.stdout.write(`${dim('Verifying your key…')} `);
}

export function printKeyVerified(info: { plan?: string; runsUsed?: number; runsLimit?: number | null }, savedPath: string): void {
  const plan = info.plan === 'pro' ? 'Pro' : 'Free';
  const limited = !(info.runsLimit === null || info.runsLimit === undefined);
  const left = limited ? Math.max(0, (info.runsLimit as number) - (info.runsUsed ?? 0)) : null;
  let usage = '';
  if (!limited && info.plan === 'pro') {
    usage = ' · unlimited runs';
  } else if (left !== null) {
    usage = ` · ${left} of ${info.runsLimit} runs left`;
  }
  console.log(green('verified.'));
  console.log(`${green('✓')} ${white("You're all set!")} ${dim(`${plan} plan${usage}`)}`);
  console.log(`${dim('Key saved to')} ${savedPath}`);
  if (left !== null && left <= 0) {
    console.log('');
    console.log(formatQuotaUpsell());
  } else if (left !== null && left <= 2) {
    console.log(`${yellow(`Only ${left} free run${left === 1 ? '' : 's'} left.`)} ${dim('Get more at')} ${white(cloudPricingUrl())}`);
  }
  console.log('');
}

export function printKeyRejected(message: string, webUrl: string): void {
  console.log(red('not accepted.'));
  console.log(`${red(message)}`);
  console.log(`${dim('Get a fresh key at')} ${white(webUrl)}\n`);
}

export function printKeyUnreachable(message: string): void {
  console.log(yellow('could not reach Skillcheck Cloud.'));
  console.log(`${dim(message)}`);
  console.log(`${dim('Check your connection and try again, or press Ctrl+C to cancel.')}\n`);
}

export function printKeyPromptHint(webUrl: string): void {
  console.log(`${dim('Paste the key from')} ${white(webUrl)}\n`);
}

export function supportedSkillFilesText(): string {
  return `a Markdown (.md) file (e.g. ${CONVENTIONAL_SKILL_FILES.join(', ')}), or a folder containing one`;
}

async function directoryHasMarkdown(dirPath: string): Promise<boolean> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && isMarkdownFile(entry.name));
  } catch {
    return false;
  }
}

export async function validateSkillInput(inputPath: string): Promise<string> {
  try {
    const resolved = path.resolve(inputPath);
    const stats = await stat(resolved);
    if (stats.isDirectory()) {
      if (await directoryHasMarkdown(resolved)) {
        return inputPath;
      }
      throw new Error(`That folder has no .md file. Skillcheck only checks Markdown (.md) files — open a folder that contains one, or pick a .md file directly.`);
    }
    if (stats.isFile()) {
      if (isMarkdownFile(resolved)) {
        return inputPath;
      }
      throw new Error(`Skillcheck only checks Markdown (.md) files. "${path.basename(resolved)}" is not a .md file.`);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(`This path does not exist. Please give me ${supportedSkillFilesText()}.`);
    }
    throw error;
  }

  throw new Error(`Please give me ${supportedSkillFilesText()}.`);
}

async function listPickerEntries(currentDir: string): Promise<PickerEntry[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const parent = path.dirname(currentDir);
  const mapped = await Promise.all(
    entries
      .filter((entry) => entry.name !== 'node_modules' && entry.name !== '.git')
      .map(async (entry): Promise<PickerEntry> => {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          // Folders are for navigation only — never selectable. Hint when one
          // holds a .md so the user knows where to go.
          const hasMd = await directoryHasMarkdown(fullPath);
          return {
            label: `${entry.name}/`,
            fullPath,
            kind: 'directory',
            runnable: false,
            note: hasMd ? 'folder · has .md' : 'folder'
          };
        }
        const isMd = entry.isFile() && isMarkdownFile(entry.name);
        return {
          label: entry.name,
          fullPath,
          kind: 'file',
          runnable: isMd,
          note: isMd ? 'markdown' : 'not .md'
        };
      })
  );

  return [
    {
      label: '../',
      fullPath: parent,
      kind: 'parent',
      runnable: false,
      note: 'back'
    },
    ...mapped.sort((a, b) => {
      // Folders first (to drill into), then selectable .md files, then the rest.
      if (a.kind !== b.kind) {
        return a.kind === 'directory' ? -1 : 1;
      }
      if (a.kind === 'file' && a.runnable !== b.runnable) {
        return a.runnable ? -1 : 1;
      }
      return a.label.localeCompare(b.label);
    })
  ];
}

function visibleWindow<T>(items: T[], selected: number, size: number): { items: T[]; offset: number } {
  const offset = Math.max(0, Math.min(selected - Math.floor(size / 2), Math.max(0, items.length - size)));
  return { items: items.slice(offset, offset + size), offset };
}

function renderPicker(currentDir: string, entries: PickerEntry[], selected: number, message?: string): void {
  // Build the whole screen as one string and write it once, so the big hero banner
  // redraws cleanly on every keypress instead of flickering line by line.
  const out: string[] = [...bannerLines()];
  out.push(`${blue('Step 1 of 2')}  ${white('Choose the skill file you want to check')}`);
  out.push(`${dim('Pick any')} ${green('green .md file')}${dim('. Open a')} ${blue('blue folder')} ${dim('to look inside it.')}`);
  out.push(`${dim('Current folder:')} ${currentDir}`);
  out.push(dim('↑/↓ move  ·  Enter = open folder / choose file  ·  q = quit'));
  out.push('');

  if (message) {
    out.push(`${red(message)}`);
    out.push('');
  }

  const window = visibleWindow(entries, selected, 10);
  for (const [index, entry] of window.items.entries()) {
    const realIndex = window.offset + index;
    const isSelected = realIndex === selected;
    const pointer = isSelected ? blue('>') : ' ';
    let label: string;
    if (isSelected) {
      label = white(entry.label);
    } else if (entry.kind === 'directory' || entry.kind === 'parent') {
      label = blue(entry.label); // navigable
    } else if (entry.runnable) {
      label = green(entry.label); // selectable .md
    } else {
      label = dim(entry.label);
    }
    const note = entry.runnable ? green(entry.note) : dim(entry.note);
    out.push(`${pointer} ${label.padEnd(34)} ${note}`);
  }
  out.push('');
  process.stdout.write(`\x1b[2J\x1b[H${out.join('\n')}\n`);
}

function readKey(): Promise<{ input: string; key: Keypress }> {
  return new Promise((resolve) => {
    process.stdin.once('keypress', (input: string, key: Keypress) => resolve({ input, key }));
  });
}

export async function selectSkillPath(startDir = process.cwd()): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`Please give me a path to ${supportedSkillFilesText()}, or a folder containing one.`);
  }

  readline.emitKeypressEvents(process.stdin);
  const wasRaw = process.stdin.isRaw === true;
  process.stdin.resume();
  process.stdin.setRawMode(true);

  let currentDir = path.resolve(startDir);
  let selected = 0;
  let message: string | undefined;

  try {
    for (;;) {
      const entries = await listPickerEntries(currentDir);
      selected = Math.max(0, Math.min(selected, entries.length - 1));
      renderPicker(currentDir, entries, selected, message);
      message = undefined;

      const { input, key } = await readKey();
      if ((key.ctrl && key.name === 'c') || input === 'q') {
        throw new Error('Selection cancelled.');
      }
      if (key.name === 'up') {
        selected = selected <= 0 ? entries.length - 1 : selected - 1;
        continue;
      }
      if (key.name === 'down') {
        selected = selected >= entries.length - 1 ? 0 : selected + 1;
        continue;
      }
      if (key.name !== 'return') {
        continue;
      }

      const entry = entries[selected];
      if (!entry) {
        continue;
      }
      if (entry.kind === 'parent' || entry.kind === 'directory') {
        // Folders are always navigated into — never selected as the result.
        currentDir = entry.fullPath;
        selected = 0;
        continue;
      }
      if (entry.runnable) {
        process.stdout.write('\x1b[2J\x1b[H');
        return entry.fullPath;
      }
      message = 'We only check Markdown (.md) files. Open a folder to find one, or pick a .md file.';
    }
  } finally {
    process.stdin.setRawMode(wasRaw);
    process.stdin.pause();
    process.stdout.write('\x1b[?25h');
  }
}

interface EffortLevel {
  key: string;
  name: string;
  tasks: number;
  trials: number;
}

// Calls per run = 1 generator + (tasks × trials × 2 arms) runner + the same many
// grader calls. nemotron with reasoning off averages ~1.2s/call; add the inter-
// request delay and occasional retry → ~2.5s/call is a safe estimate.
const SECONDS_PER_CALL = 2.5;

function callsFor(tasks: number, trials: number): number {
  return 1 + tasks * trials * 4;
}

function estimateLabel(tasks: number, trials: number): string {
  const seconds = callsFor(tasks, trials) * SECONDS_PER_CALL;
  if (seconds < 60) {
    return `~${Math.max(15, Math.round(seconds / 10) * 10)} sec`;
  }
  const minutes = seconds / 60;
  const low = Math.max(1, Math.floor(minutes));
  const high = Math.ceil(minutes + 0.5);
  return low === high ? `~${low} min` : `~${low}–${high} min`;
}

const EFFORT_LEVELS: EffortLevel[] = [
  { key: '1', name: 'Low', tasks: 2, trials: 1 },
  { key: '2', name: 'Medium', tasks: 3, trials: 2 },
  { key: '3', name: 'Strong', tasks: 5, trials: 3 }
];

export interface EffortChoice {
  tasks: number;
  trials: number;
  label: string;
  estimate: string;
}

// Ask how thorough the check should be, showing an estimated time for each level.
// Non-interactive callers never reach this (they pass --tasks/--trials).
export async function selectEffort(): Promise<EffortChoice> {
  const defaultLevel = EFFORT_LEVELS[1]!; // Medium
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return { tasks: defaultLevel.tasks, trials: defaultLevel.trials, label: defaultLevel.name, estimate: estimateLabel(defaultLevel.tasks, defaultLevel.trials) };
  }

  console.log(`${blue('Step 2 of 2')}  ${white('How thorough should the check be?')}`);
  console.log(dim('More tasks = a more confident answer, but it takes a little longer.'));
  for (const level of EFFORT_LEVELS) {
    const scope = `${level.tasks} tasks × ${level.trials} trial${level.trials > 1 ? 's' : ''}`;
    const estimate = blue(`[${estimateLabel(level.tasks, level.trials)}]`);
    const recommended = level.name === 'Medium' ? dim('  (recommended)') : '';
    console.log(`  ${white(`${level.key})`)} ${white(level.name.padEnd(7))} ${dim(scope.padEnd(18))} ${estimate}${recommended}`);
  }

  const answer = await promptText('\nChoose 1–3 (Enter for Medium): ');
  const chosen = EFFORT_LEVELS.find((level) => level.key === answer.trim()) ?? defaultLevel;
  const estimate = estimateLabel(chosen.tasks, chosen.trials);
  console.log(`${dim('Starting')} ${white(chosen.name)} ${dim('check')} ${blue(`[${estimate}]`)}\n`);
  return { tasks: chosen.tasks, trials: chosen.trials, label: chosen.name, estimate };
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function phaseLabel(update: ProgressUpdate): string {
  switch (update.phase) {
    case 'generating':
      return 'Generating evaluation tasks';
    case 'running':
      return 'Running trials';
    case 'grading':
      return 'Grading outputs';
    case 'scoring':
      return 'Scoring results';
    default:
      return 'Working';
  }
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
}

export interface ProgressController {
  update: (event: ProgressUpdate) => void;
  finish: () => void;
  fail: () => void;
}

// A live, phase-aware indicator. Unlike the old fake bar that crept to 94% and
// then sat there looking frozen during slow model calls, this shows the real
// phase (generating / running N/M / grading N/M) plus elapsed time, so a long
// reasoning-model run clearly reads as "working", not "stuck".
export function startProgress(): ProgressController {
  if (!process.stdout.isTTY) {
    return { update: () => undefined, finish: () => undefined, fail: () => undefined };
  }

  const startedAt = Date.now();
  let frame = 0;
  let current: ProgressUpdate = { phase: 'generating' };

  const render = () => {
    const spinner = blue(SPINNER_FRAMES[frame % SPINNER_FRAMES.length]!);
    const label = white(phaseLabel(current));
    const count =
      typeof current.completed === 'number' && typeof current.total === 'number'
        ? dim(` ${current.completed}/${current.total}`)
        : '';
    const elapsed = dim(` · ${formatElapsed(Date.now() - startedAt)}`);
    process.stdout.write(`\r\x1b[2K${spinner} ${label}${count}${elapsed}`);
  };

  const timer = setInterval(() => {
    frame += 1;
    render();
  }, 120);

  process.stdout.write('\x1b[?25l');
  render();

  return {
    update: (event: ProgressUpdate) => {
      current = event;
      render();
    },
    finish: () => {
      clearInterval(timer);
      process.stdout.write(`\r\x1b[2K${green('✓')} ${white('Analysis complete')} ${dim(`· ${formatElapsed(Date.now() - startedAt)}`)}\n`);
      process.stdout.write('\x1b[?25h');
    },
    fail: () => {
      clearInterval(timer);
      process.stdout.write('\r\x1b[2K\x1b[?25h');
    }
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function formatPercent(value: unknown): string {
  return typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : 'n/a';
}

function verdictColor(verdict: string): string {
  if (verdict === 'helps') {
    return green(verdict.toUpperCase());
  }
  if (verdict === 'harms') {
    return red(verdict.toUpperCase());
  }
  return yellow(verdict.toUpperCase());
}

function boxLine(label: string, value: string): string {
  return `${blue('|')} ${white(label.padEnd(15))} ${value}`;
}

const RESULT_BORDER = '+------------------------------------------------------+';

// Satisfaction: a 0–100 quality score where 50 = no effect. Read from the result
// (computed from the smooth bootstrap mean effect, so it varies granularly instead
// of snapping to coarse sample steps); fall back to 50 + observed effect.
function satisfactionFromResult(score: Record<string, unknown>): number {
  if (typeof score.satisfaction === 'number') {
    return Math.max(0, Math.min(100, score.satisfaction));
  }
  const effect = typeof score.effect_pp === 'number' ? score.effect_pp : 0;
  return Math.max(0, Math.min(100, 50 + effect));
}

function satisfactionBand(score: number): { label: string; paint: (s: string) => string } {
  if (score <= 10) return { label: 'Very bad', paint: red };
  if (score <= 30) return { label: 'Bad', paint: red };
  if (score <= 50) return { label: 'Normal', paint: yellow };
  if (score <= 60) return { label: 'Decent', paint: yellow };
  if (score <= 80) return { label: 'Good', paint: green };
  return { label: 'Excellent', paint: green };
}

function satisfactionBar(score: number, paint: (s: string) => string): string {
  const width = 24;
  const filled = Math.max(0, Math.min(width, Math.round((width * score) / 100)));
  return `${paint('█'.repeat(filled))}${dim('░'.repeat(width - filled))}`;
}

// One satisfaction line. The bar + number are coloured by the CURRENT value's band
// (so during the animation it sweeps red→yellow→green as it fills); the trailing
// label shows the FINAL band.
function satisfactionLine(finalScore: number, atScore: number): string {
  const current = satisfactionBand(atScore);
  const settled = satisfactionBand(finalScore);
  const bar = satisfactionBar(atScore, current.paint);
  const number = current.paint(`${atScore.toFixed(1).padStart(5)}/100`);
  return `${blue('|')} ${white('Satisfaction'.padEnd(15))} ${bar} ${number}  ${settled.paint(settled.label.toUpperCase())}`;
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

function resultHeaderLines(result: unknown, outputPath?: string): string[] {
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
  const border = blue(RESULT_BORDER);

  const lines = [
    border,
    `${blue('|')} ${white('SKILLCHECK RESULT')}`,
    border,
    boxLine('Skill', String(skill.name ?? 'unknown')),
    boxLine('Run size', `${String(config.tasks ?? 'n/a')} tasks × ${String(config.trials ?? 'n/a')} trials`),
    `${blue('|')}`,
    boxLine('Verdict', verdictColor(verdict)),
    `${blue('|')} ${dim(plainVerdict(verdict, score.with_skill_pass, score.no_skill_pass))}`,
    `${blue('|')}`,
    boxLine('With skill', `${formatPercent(score.with_skill_pass)} of tasks passed`),
    boxLine('Without skill', `${formatPercent(score.no_skill_pass)} of tasks passed`),
    boxLine('Skill effect', `${signedPp(score.effect_pp)} ${dim('change in pass rate')}`),
    boxLine('Confidence', `${ciText} ${dim('(95% range)')}`)
  ];
  if (inconclusive) {
    lines.push(`${blue('|')} ${yellow('Wide range = inconclusive. Run "Strong" or more tasks.')}`);
  }
  lines.push(boxLine('Token cost', `+${String(score.token_overhead ?? 'n/a')} ${dim('tokens to include the skill')}`));
  if (outputPath) {
    lines.push(boxLine('Saved JSON', outputPath));
  }
  lines.push(border);
  return lines;
}

export function formatResultCard(result: unknown, outputPath?: string): string {
  const score = asRecord(asRecord(result).result);
  const sat = satisfactionFromResult(score);
  return [...resultHeaderLines(result, outputPath), satisfactionLine(sat, sat), blue(RESULT_BORDER)].join('\n');
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Render the result card, smoothly animating the satisfaction bar to its level on
// an interactive terminal. Non-interactive output is the static card.
export async function printResultCard(result: unknown, outputPath?: string): Promise<void> {
  const score = asRecord(asRecord(result).result);
  const finalScore = satisfactionFromResult(score);

  if (!process.stdout.isTTY) {
    console.log(formatResultCard(result, outputPath));
    return;
  }

  console.log(resultHeaderLines(result, outputPath).join('\n'));
  process.stdout.write('\x1b[?25l');
  const frames = 32;
  for (let i = 0; i <= frames; i += 1) {
    const at = finalScore * easeOutCubic(i / frames);
    process.stdout.write(`\r\x1b[2K${satisfactionLine(finalScore, at)}`);
    await sleep(26);
  }
  process.stdout.write(`\r\x1b[2K${satisfactionLine(finalScore, finalScore)}\n`);
  process.stdout.write('\x1b[?25h');
  console.log(blue(RESULT_BORDER));
}

// A friendly "you're out of free runs" block that points the user at the pricing
// page to add more. Shown both on first connect (if their balance is already 0)
// and when a run is refused mid-check for quota reasons.
export function formatQuotaUpsell(): string {
  const url = cloudPricingUrl();
  const rule = blue('─'.repeat(48));
  return [
    rule,
    `${white("You've used all your free Skillcheck runs.")}`,
    dim('Thanks for trying Skillcheck! To keep checking skills,'),
    dim('upgrade to the Pro plan for more runs:'),
    '',
    `  ${white(url)}`,
    rule
  ].join('\n');
}

// Did this failure happen because the account ran out of free runs? Matches the
// proxy's 402 quota_exceeded shape as well as any HTTP 402 surfaced by the SDK.
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
    return raw.replace(/^\d+\s+/, '').replace(/NVIDIA[_ -]?NIM|NVIDIA/gi, 'Skillcheck Cloud');
  }
  if (/api[_ -]?key|credential|unauthorized|authentication|401/i.test(raw)) {
    return 'Skillcheck Cloud is not connected for this workspace. Please try again later or contact the workspace owner.';
  }
  return raw
    .replace(/NVIDIA NIM/gi, 'Skillcheck Cloud')
    .replace(/NVIDIA_API_KEY/gi, 'Skillcheck Cloud')
    .replace(/NVIDIA/gi, 'Skillcheck Cloud')
    .replace(/API[_ -]?KEY/gi, 'credential');
}

export function formatFatalError(error: unknown): string {
  if (isQuotaError(error)) {
    return `${yellow('Out of free runs')}\n${formatQuotaUpsell()}`;
  }
  return `${red('Skillcheck stopped')}\n${sanitizeCliError(error)}`;
}

// Shown when a newer version is published to npm, just before we ask whether to
// update. Mirrors the friendly "update available" notice of other modern CLIs.
export function printUpdateAvailable(current: string, latest: string): void {
  const rule = blue('─'.repeat(48));
  console.log('');
  console.log(rule);
  console.log(`${white('Update available')}   ${dim(`v${current}`)} ${blue('→')} ${green(`v${latest}`)}`);
  console.log(dim('A newer version of Skillcheck is available.'));
  console.log(rule);
}

export function printUpdateApplied(latest: string): void {
  console.log(`${green('✓')} ${white(`Updated to v${latest}.`)} ${dim('Re-run skillcheck to use the new version.')}\n`);
}

export function printUpdateSkipped(latest: string): void {
  console.log(`${dim('Skipped. Update any time with')} ${white('npm install -g @sx4im/skillcheck')}${dim(`  (v${latest})`)}\n`);
}

export function printUpdateFailed(): void {
  console.log(`${yellow('Could not update automatically.')} ${dim('Run')} ${white('npm install -g @sx4im/skillcheck')} ${dim('yourself.')}\n`);
}

// Confirmation printed by `skillcheck logout` after the saved key is cleared.
export function printLogout(result: { removed: boolean; envOverride: boolean; path: string }): void {
  if (result.removed) {
    console.log(`${green('✓')} ${white('Signed out.')} ${dim('Your saved API key was removed.')}`);
  } else {
    console.log(`${dim('You were already signed out — no saved API key to remove.')}`);
  }
  if (result.envOverride) {
    console.log(
      `${yellow('Note:')} ${dim('a key is still set via SKILLCHECK_TOKEN in your environment; unset it to fully sign out.')}`
    );
  }
  console.log(`${dim('Sign in again any time with')} ${white('skillcheck setup')}${dim('.')}`);
}
