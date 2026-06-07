import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { createInterface } from 'node:readline/promises';
import type { ProgressUpdate } from './types.js';

// Conventional skill filenames, shown only as hints. The actual rule is simple:
// Skillcheck analyzes Markdown (.md) files.
const CONVENTIONAL_SKILL_FILES = ['SKILL.md', 'AGENTS.md', 'CLAUDE.md'];
const isMarkdownFile = (filePath: string): boolean => path.extname(filePath).toLowerCase() === '.md';
const useColor = () => process.stdout.isTTY && process.env.NO_COLOR !== '1';
const color = (code: string, value: string): string => (useColor() ? `\x1b[${code}m${value}\x1b[0m` : value);
const blue = (value: string): string => color('38;5;33', value);
const deepBlue = (value: string): string => color('1;38;5;18', value);
const white = (value: string): string => color('1;37', value);
const dim = (value: string): string => color('2', value);
const red = (value: string): string => color('1;31', value);
const green = (value: string): string => color('1;32', value);
const yellow = (value: string): string => color('1;33', value);

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

export function printBanner(): void {
  console.log(
    deepBlue(`  ____  _    _ _ _      _               _
 / ___|| | _(_) | | ___| |__   ___  ___| | __
 \\___ \\| |/ / | | |/ __| '_ \\ / _ \\/ __| |/ /
  ___) |   <| | | | (__| | | |  __/ (__|   <
 |____/|_|\\_\\_|_|_|\\___|_| |_|\\___|\\___|_|\\_\\`)
  );
  console.log(white('  Drop a skill file. Get a verdict.\n'));
}

export function printHelpUi(): void {
  printBanner();
  console.log(`${blue('Quick start')}`);
  console.log(`  ${white('skillcheck')} ${blue('check')} path/to/SKILL.md`);
  console.log(`  ${white('skillcheck')} path/to/skill-folder\n`);
  console.log(`${blue('Supported inputs')}`);
  console.log(`  Any Markdown (.md) file — e.g. ${CONVENTIONAL_SKILL_FILES.join(', ')} — or a folder containing one\n`);
  console.log(`${blue('Commands')}`);
  console.log(`  skillcheck setup`);
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
  console.log(`${blue('Connect Skillcheck Cloud')}`);
  console.log('Skillcheck runs on our hosted model. Grab your free API key here:\n');
  console.log(`  ${white(webUrl)}\n`);
  console.log(dim('Sign in with Google or GitHub, copy the key that starts with "chk_live_",'));
  console.log(dim('then paste it below. After it is verified, Skillcheck opens the file picker.\n'));
}

export function printKeyChecking(): void {
  process.stdout.write(`${dim('Verifying your key…')} `);
}

export function printKeyVerified(info: { plan?: string; runsUsed?: number; runsLimit?: number | null }, savedPath: string): void {
  const plan = info.plan === 'pro' ? 'Pro' : 'Free';
  let usage = '';
  if (info.runsLimit === null || info.runsLimit === undefined) {
    if (info.plan === 'pro') {
      usage = ' · unlimited runs';
    }
  } else {
    const left = Math.max(0, info.runsLimit - (info.runsUsed ?? 0));
    usage = ` · ${left} of ${info.runsLimit} runs left`;
  }
  console.log(green('verified.'));
  console.log(`${dim(`${plan} plan${usage}`)}`);
  console.log(`${dim('Saved to')} ${savedPath}\n`);
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
  process.stdout.write('\x1b[2J\x1b[H');
  printBanner();
  console.log(`${blue('Pick a Markdown (.md) skill file')}`);
  console.log(`${dim('Current folder:')} ${currentDir}`);
  console.log(dim('↑/↓ move · Enter opens a folder or selects a .md file · q quits\n'));

  if (message) {
    console.log(`${red(message)}\n`);
  }

  const window = visibleWindow(entries, selected, 12);
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
    console.log(`${pointer} ${label.padEnd(34)} ${note}`);
  }
  console.log('');
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

  console.log(`${blue('How thorough should the check be?')}`);
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

function formatNumber(value: unknown): string {
  return typeof value === 'number' ? value.toFixed(1) : 'n/a';
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

export function formatResultCard(result: unknown, outputPath?: string): string {
  const root = asRecord(result);
  const skill = asRecord(root.skill);
  const config = asRecord(root.config);
  const score = asRecord(root.result);
  const ci = Array.isArray(score.ci_pp) ? score.ci_pp : [];
  const ciText =
    typeof ci[0] === 'number' && typeof ci[1] === 'number'
      ? `[${ci[0].toFixed(1)}, ${ci[1].toFixed(1)}] pp`
      : 'n/a';
  const verdict = String(score.verdict ?? 'unknown');
  const lines = [
    blue('+-----------------------------------------------+'),
    `${blue('|')} ${white('SKILLCHECK RESULT')}`,
    blue('+-----------------------------------------------+'),
    boxLine('Skill', String(skill.name ?? 'unknown')),
    boxLine('Verdict', verdictColor(verdict)),
    boxLine('Effect', `${formatNumber(score.effect_pp)} pp`),
    boxLine('Confidence', ciText),
    boxLine('With skill', formatPercent(score.with_skill_pass)),
    boxLine('Without skill', formatPercent(score.no_skill_pass)),
    boxLine('Token cost', `${String(score.token_overhead ?? 'n/a')} tokens`),
    boxLine('Run size', `${String(config.tasks ?? 'n/a')} tasks x ${String(config.trials ?? 'n/a')} trials`)
  ];
  if (outputPath) {
    lines.push(boxLine('Saved JSON', outputPath));
  }
  lines.push(blue('+-----------------------------------------------+'));
  return lines.join('\n');
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
  return `${red('Skillcheck stopped')}\n${sanitizeCliError(error)}`;
}
