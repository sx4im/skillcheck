import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { cloudPricingUrl } from './config.js';
import {
  BOX,
  SPINNER_FRAMES,
  SYM,
  epaint,
  layoutWidth,
  padDisplay,
  paint,
  truncateDisplay,
  wrapText
} from './theme.js';
import type { ProgressPhase, ProgressUpdate } from './types.js';
import { currentVersion } from './version.js';

// Conventional skill filenames, shown only as hints. The actual rule is simple:
// Skillcheck analyzes Markdown (.md) files.
const CONVENTIONAL_SKILL_FILES = ['SKILL.md', 'AGENTS.md', 'CLAUDE.md'];
const isMarkdownFile = (filePath: string): boolean => path.extname(filePath).toLowerCase() === '.md';

const REPO_URL = 'github.com/sx4im/skillcheck';

// Thrown when the user deliberately backs out (q / Ctrl+C in a menu). The bin
// entry recognises it and exits quietly with code 130 instead of painting the
// red "Skillcheck stopped" failure block — cancelling is not an error.
export class CancelledError extends Error {
  readonly exitCode = 130;
  constructor(message = 'Cancelled.') {
    super(message);
    this.name = 'CancelledError';
  }
}

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
// outline. Fill and outline are painted separately: SKILL is solid white, CHECK gets
// the brand gradient sweeping top-to-bottom with a white outline.
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

type Paint = (value: string) => string;

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
// `fillFor` picks the fill paint per row so the brand gradient can sweep downwards.
function renderWord(word: string, fillFor: (row: number) => Paint, outline: Paint): string[] {
  const rows: string[] = [];
  for (let r = 0; r < GLYPH_ROWS; r += 1) {
    const row = Array.from(word)
      .map((ch) => GLYPHS[ch]?.[r] ?? '')
      .join(' ');
    rows.push(paintBlocks(row, fillFor(r), outline));
  }
  return rows;
}

// Compact 5-row solid block glyphs for narrow terminals. No outline/shadow
// characters: pure fills, 6 columns per letter (2 for I), so the full
// one-line "SKILL  CHECK" fits a standard 80-column terminal.
const COMPACT_ROWS = 5;
const COMPACT_GLYPHS: Record<string, string[]> = {
  S: ['██████', '██    ', '██████', '    ██', '██████'],
  K: ['██  ██', '██ ██ ', '████  ', '██ ██ ', '██  ██'],
  I: ['██', '██', '██', '██', '██'],
  L: ['██    ', '██    ', '██    ', '██    ', '██████'],
  C: ['██████', '██    ', '██    ', '██    ', '██████'],
  H: ['██  ██', '██  ██', '██████', '██  ██', '██  ██'],
  E: ['██████', '██    ', '████  ', '██    ', '██████']
};

// Plain (unpainted) column width of a rendered glyph word, including the one
// space column between glyphs.
function wordWidth(glyphs: Record<string, string[]>, word: string): number {
  return Array.from(word).reduce(
    (sum, ch, index) => sum + Array.from(glyphs[ch]?.[0] ?? '').length + (index > 0 ? 1 : 0),
    0
  );
}

function renderCompactWord(word: string, fillFor: (row: number) => Paint): string[] {
  const rows: string[] = [];
  for (let r = 0; r < COMPACT_ROWS; r += 1) {
    const row = Array.from(word)
      .map((ch) => COMPACT_GLYPHS[ch]?.[r] ?? '')
      .join(' ');
    rows.push(paintBlocks(row, fillFor(r), fillFor(r)));
  }
  return rows;
}

// The hero wordmark: "SKILL" in solid white and "CHECK" in the brand gradient,
// ALWAYS side by side on one line. Three tiers by terminal width: the full
// ANSI-Shadow letters, the compact solid letters (fits 80 columns), and a
// plain styled text line for very narrow terminals. SKILL and CHECK are never
// stacked on separate lines. Returned as lines so the file picker can embed
// the very same banner in its full-screen frame.
export function bannerLines(): string[] {
  const indent = '  ';
  const gap = '  ';
  const lines: string[] = [''];
  const columns = process.stdout.columns;

  const bigWidth = indent.length + wordWidth(GLYPHS, 'SKILL') + gap.length + wordWidth(GLYPHS, 'CHECK');
  const compactWidth = indent.length + wordWidth(COMPACT_GLYPHS, 'SKILL') + gap.length + wordWidth(COMPACT_GLYPHS, 'CHECK');

  if (columns === undefined || columns >= bigWidth) {
    const skillRows = renderWord('SKILL', () => paint.bold, paint.bold);
    const checkRows = renderWord('CHECK', (row) => paint.brand(row / (GLYPH_ROWS - 1)), paint.bold);
    for (let r = 0; r < GLYPH_ROWS; r += 1) {
      lines.push(indent + skillRows[r]! + gap + checkRows[r]!);
    }
  } else if (columns >= compactWidth) {
    const skillRows = renderCompactWord('SKILL', () => paint.bold);
    const checkRows = renderCompactWord('CHECK', (row) => paint.brand(row / (COMPACT_ROWS - 1)));
    for (let r = 0; r < COMPACT_ROWS; r += 1) {
      lines.push(indent + skillRows[r]! + gap + checkRows[r]!);
    }
  } else {
    lines.push(`${indent}${paint.bold('SKILL')}${paint.brand(0.5)('CHECK')}`);
  }
  lines.push(`${indent}${paint.bold('Is your skill actually helping the model?')}`);
  lines.push(`${indent}${paint.dim(`v${currentVersion()} ${SYM.dot} ${REPO_URL}`)}`);
  lines.push('');
  return lines;
}

export function printBanner(): void {
  console.log(bannerLines().join('\n'));
}

// Compact one-line brand header for direct (non-interactive) invocations like
// `skillcheck check ./SKILL.md`. Repeat users shouldn't scroll past a 14-line
// wordmark on every run; the hero banner stays for interactive mode, help and setup.
export function printCheckHeader(inputPath: string, tasks: number, trials: number): void {
  const scope = `${tasks} task${tasks === 1 ? '' : 's'} × ${trials} trial${trials === 1 ? '' : 's'}`;
  console.log(`${paint.accent(SYM.diamond)} ${paint.bold('SkillCheck')} ${paint.dim(`v${currentVersion()}`)}`);
  console.log(`  ${paint.dim('Checking')} ${inputPath} ${paint.dim(`${SYM.dot} ${scope} ${SYM.dot} ${estimateLabel(tasks, trials)}`)}`);
  console.log('');
}

export function printHelpUi(): void {
  printBanner();
  const cmd = (name: string, blurb: string) =>
    console.log(`    ${paint.bold(name.padEnd(16))}${paint.dim(blurb)}`);
  const opt = (name: string, blurb: string) =>
    console.log(`    ${paint.accent(name.padEnd(16))}${paint.dim(blurb)}`);

  console.log(`  ${paint.accent('Usage')}`);
  console.log(`    ${paint.bold('skillcheck')}                ${paint.dim('interactive — pick a file, choose effort, run')}`);
  console.log(`    ${paint.bold('skillcheck')} ${paint.accent('<path>')}         ${paint.dim('check a skill file or folder directly')}`);
  console.log(`    ${paint.bold('skillcheck')} ${paint.accent('<command>')} ${paint.dim('[options]')}\n`);

  console.log(`  ${paint.accent('Commands')}`);
  cmd('check <path>', 'A/B check a skill with a readable result card');
  cmd('setup', 'connect your free Skillcheck Cloud key');
  cmd('logout', 'remove the saved key');
  cmd('eval <path>', 'full evaluation, JSON output');
  cmd('verify <file>', 're-grade a saved result to confirm it reproduces');
  cmd('corpus run', 'batch-check every skill in a corpus file');
  cmd('rot', 're-score saved results against the current model');
  console.log('');

  console.log(`  ${paint.accent('Options')}`);
  opt('--tasks N', 'generated tasks per check (default 3, max 50)');
  opt('--trials K', 'trials per task and arm (default 2, max 10)');
  opt('--output FILE', 'save the full JSON result');
  opt('--json', 'machine-readable output, no UI');
  opt('--version', 'print the installed version');
  console.log('');

  console.log(`  ${paint.accent('Examples')}`);
  console.log(`    ${paint.dim('$')} skillcheck ./SKILL.md`);
  console.log(`    ${paint.dim('$')} skillcheck check ./skill --tasks 5 --trials 3 --output result.json`);
  console.log(`    ${paint.dim('$')} skillcheck verify result.json\n`);

  console.log(`  ${paint.dim('Supported inputs: any Markdown (.md) file — e.g.')} ${paint.dim(CONVENTIONAL_SKILL_FILES.join(', '))} ${paint.dim('— or a folder containing one.')}`);
  console.log(`  ${paint.dim('Docs:')} https://${REPO_URL}\n`);
}

export async function promptText(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

// Prompt for a secret without echoing it. Characters render as dots, backspace
// works, paste arrives as one chunk and is masked the same way. Falls back to a
// plain prompt when there is no TTY to control.
export async function promptSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return promptText(question);
  }

  return new Promise<string>((resolve, reject) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw === true;
    stdin.resume();
    stdin.setRawMode(true);
    let value = '';

    const render = () => {
      const masked = '•'.repeat(Math.min(value.length, 48));
      process.stdout.write(`\r\x1b[2K${question}${paint.dim(masked)}`);
    };

    const settle = (error?: Error) => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      process.stdout.write('\n');
      if (error) {
        reject(error);
      } else {
        resolve(value.trim());
      }
    };

    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') {
          settle(new CancelledError('Setup cancelled.'));
          return;
        }
        if (char === '\r' || char === '\n') {
          settle();
          return;
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        if (char >= ' ') {
          value += char;
        }
      }
      render();
    };

    render();
    stdin.on('data', onData);
  });
}

export function printSetupIntro(webUrl: string): void {
  console.log(`${paint.accent(SYM.diamond)} ${paint.bold('Connect your free account')} ${paint.dim('(about 30 seconds)')}\n`);
  console.log(`  ${paint.bold('1.')} Open this page in your web browser:`);
  console.log(`     ${paint.accent(webUrl)}`);
  console.log(`  ${paint.bold('2.')} Sign in with Google or GitHub ${paint.dim('— free, includes 10 checks')}`);
  console.log(`  ${paint.bold('3.')} Copy your key ${paint.dim('(it starts with')} ${paint.ok('chk_live_')}${paint.dim(')')}`);
  console.log(`  ${paint.bold('4.')} Paste it below — input stays hidden.\n`);
}

export function printKeyChecking(): void {
  process.stdout.write(`${paint.dim('Verifying your key…')} `);
}

export function printKeyVerified(info: { plan?: string; runsUsed?: number; runsLimit?: number | null }, savedPath: string): void {
  const plan = info.plan === 'pro' ? 'Pro' : 'Free';
  const limited = !(info.runsLimit === null || info.runsLimit === undefined);
  const left = limited ? Math.max(0, (info.runsLimit as number) - (info.runsUsed ?? 0)) : null;
  let usage = '';
  if (!limited && info.plan === 'pro') {
    usage = ` ${SYM.dot} unlimited runs`;
  } else if (left !== null) {
    usage = ` ${SYM.dot} ${left} of ${info.runsLimit} runs left`;
  }
  console.log(paint.ok('verified.'));
  console.log(`${paint.ok(SYM.tick)} ${paint.bold("You're all set!")} ${paint.dim(`${plan} plan${usage}`)}`);
  console.log(`${paint.dim('Key saved to')} ${savedPath}`);
  if (left !== null && left <= 0) {
    console.log('');
    console.log(formatQuotaUpsell());
  } else if (left !== null && left <= 2) {
    console.log(`${paint.warn(`Only ${left} free run${left === 1 ? '' : 's'} left.`)} ${paint.dim('Get more at')} ${paint.bold(cloudPricingUrl())}`);
  }
  console.log('');
}

export function printKeyRejected(message: string, webUrl: string): void {
  console.log(paint.err('not accepted.'));
  console.log(`${paint.err(SYM.cross)} ${message}`);
  console.log(`${paint.dim('Get a fresh key at')} ${paint.bold(webUrl)}\n`);
}

export function printKeyUnreachable(message: string): void {
  console.log(paint.warn('could not reach Skillcheck Cloud.'));
  console.log(`${paint.dim(message)}`);
  console.log(`${paint.dim('Check your connection and try again, or press Ctrl+C to cancel.')}\n`);
}

export function printKeyPromptHint(webUrl: string): void {
  console.log(`${paint.dim('Paste the key from')} ${paint.bold(webUrl)}\n`);
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

const PICKER_WINDOW = 10;
const PICKER_LABEL_WIDTH = 34;

function renderPicker(currentDir: string, entries: PickerEntry[], selected: number, message?: string): void {
  // Build the whole screen as one string and write it once, so the big hero banner
  // redraws cleanly on every keypress instead of flickering line by line.
  const out: string[] = [...bannerLines()];
  const runnableCount = entries.filter((entry) => entry.runnable).length;
  out.push(`  ${paint.accent('Step 1 of 2')}  ${paint.bold('Choose the skill file you want to check')}`);
  out.push(`  ${paint.dim('Pick any')} ${paint.ok('green .md file')}${paint.dim('. Open a')} ${paint.accent('blue folder')} ${paint.dim('to look inside it.')}`);
  out.push(`  ${paint.dim('Folder:')} ${truncateDisplay(currentDir, 60)}  ${paint.dim(`${SYM.dot} ${runnableCount} markdown file${runnableCount === 1 ? '' : 's'} here`)}`);
  out.push('');

  if (message) {
    out.push(`  ${paint.warn(message)}`);
    out.push('');
  }

  const window = visibleWindow(entries, selected, PICKER_WINDOW);
  if (window.offset > 0) {
    out.push(`    ${paint.dim(`↑ ${window.offset} more`)}`);
  }
  for (const [index, entry] of window.items.entries()) {
    const realIndex = window.offset + index;
    const isSelected = realIndex === selected;
    const pointer = isSelected ? paint.accent(SYM.pointer) : ' ';
    const rawLabel = truncateDisplay(entry.label, PICKER_LABEL_WIDTH);
    let label: string;
    if (isSelected) {
      label = paint.bold(rawLabel);
    } else if (entry.kind === 'directory' || entry.kind === 'parent') {
      label = paint.accent(rawLabel); // navigable
    } else if (entry.runnable) {
      label = paint.ok(rawLabel); // selectable .md
    } else {
      label = paint.dim(rawLabel);
    }
    const note = entry.runnable ? paint.ok(entry.note) : paint.dim(entry.note);
    out.push(`  ${pointer} ${padDisplay(label, PICKER_LABEL_WIDTH)} ${note}`);
  }
  const below = entries.length - (window.offset + window.items.length);
  if (below > 0) {
    out.push(`    ${paint.dim(`↓ ${below} more`)}`);
  }
  out.push('');
  out.push(`  ${paint.dim(`↑/↓ move ${SYM.dot} Enter open folder / choose file ${SYM.dot} q quit`)}`);
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
    throw new Error(`Please give me a path to ${supportedSkillFilesText()}.`);
  }

  readline.emitKeypressEvents(process.stdin);
  const wasRaw = process.stdin.isRaw === true;
  process.stdin.resume();
  process.stdin.setRawMode(true);

  let currentDir = path.resolve(startDir);
  let lastGoodDir = currentDir;
  let selected = 0;
  let message: string | undefined;
  let chosen: string | undefined;

  // The picker runs on the alternate screen buffer, so quitting (or choosing)
  // hands the user their previous terminal contents back untouched.
  process.stdout.write('\x1b[?1049h\x1b[?25l');
  try {
    for (;;) {
      let entries: PickerEntry[];
      try {
        entries = await listPickerEntries(currentDir);
        lastGoodDir = currentDir;
      } catch (error) {
        // An unreadable folder (permissions, race with deletion) must not kill
        // the picker — bounce back to the last folder that listed cleanly.
        if (currentDir === lastGoodDir) {
          throw error;
        }
        const code = (error as NodeJS.ErrnoException).code;
        message = `Cannot open that folder${code === 'EACCES' ? ' (permission denied)' : ''}.`;
        currentDir = lastGoodDir;
        continue;
      }
      selected = Math.max(0, Math.min(selected, entries.length - 1));
      renderPicker(currentDir, entries, selected, message);
      message = undefined;

      const { input, key } = await readKey();
      if ((key.ctrl && key.name === 'c') || input === 'q') {
        throw new CancelledError('Selection cancelled.');
      }
      if (key.name === 'up' || input === 'k') {
        selected = selected <= 0 ? entries.length - 1 : selected - 1;
        continue;
      }
      if (key.name === 'down' || input === 'j') {
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
        chosen = entry.fullPath;
        break;
      }
      message = 'We only check Markdown (.md) files. Open a folder to find one, or pick a .md file.';
    }
  } finally {
    process.stdin.setRawMode(wasRaw);
    process.stdin.pause();
    process.stdout.write('\x1b[?25h\x1b[?1049l');
  }

  // Back on the main screen: leave the user oriented with the banner on top
  // plus the file they just chose.
  printBanner();
  const shown = path.relative(process.cwd(), chosen) || chosen;
  console.log(`  ${paint.ok(SYM.tick)} ${paint.bold('Skill file')}  ${shown}\n`);
  return chosen;
}

interface EffortLevel {
  key: string;
  name: string;
  tasks: number;
  trials: number;
  blurb: string;
}

// Calls per run = 1 generator + (tasks × trials × 2 arms) runner + the same many
// grader calls, all issued sequentially with a ~750ms inter-request delay (see
// env.ts). Wall-clock time is therefore a roughly fixed overhead (startup, skill
// normalize, task generation, scoring + render) plus a per-call cost that
// dominates as the run grows. These two constants are calibrated to observed
// end-to-end runs on the hosted gpt-oss-120b (the default model) — a good deal
// slower than a raw single call — and reproduce the measured times:
// Quick ~2 min, Standard ~4 min, Thorough ~6–7 min.
const BASE_SECONDS = 120;
const SECONDS_PER_CALL = 4.8;

function callsFor(tasks: number, trials: number): number {
  return 1 + tasks * trials * 4;
}

function estimateLabel(tasks: number, trials: number): string {
  const seconds = BASE_SECONDS + callsFor(tasks, trials) * SECONDS_PER_CALL;
  if (seconds < 60) {
    return `~${Math.max(15, Math.round(seconds / 10) * 10)} sec`;
  }
  const minutes = seconds / 60;
  const low = Math.max(1, Math.floor(minutes));
  const high = Math.max(low, Math.ceil(minutes));
  return low === high ? `~${low} min` : `~${low}–${high} min`;
}

const EFFORT_LEVELS: EffortLevel[] = [
  { key: '1', name: 'Quick', tasks: 2, trials: 1, blurb: 'fast first signal' },
  { key: '2', name: 'Standard', tasks: 3, trials: 2, blurb: 'recommended' },
  { key: '3', name: 'Thorough', tasks: 5, trials: 3, blurb: 'most confident verdict' }
];

export interface EffortChoice {
  tasks: number;
  trials: number;
  label: string;
  estimate: string;
}

function effortChoice(level: EffortLevel): EffortChoice {
  return { tasks: level.tasks, trials: level.trials, label: level.name, estimate: estimateLabel(level.tasks, level.trials) };
}

function effortMenuLines(selected: number): string[] {
  const lines: string[] = [];
  lines.push(`  ${paint.accent('Step 2 of 2')}  ${paint.bold('How thorough should this check be?')}`);
  lines.push(`  ${paint.dim('More tasks mean a more confident verdict — and a little more time.')}`);
  lines.push('');
  for (const [index, level] of EFFORT_LEVELS.entries()) {
    const active = index === selected;
    const pointer = active ? paint.accent(SYM.pointer) : ' ';
    const name = active ? paint.bold(level.name.padEnd(9)) : paint.dim(level.name.padEnd(9));
    const scope = `${level.tasks} tasks × ${level.trials} trial${level.trials > 1 ? 's' : ''}`;
    const estimate = paint.accent(`[${estimateLabel(level.tasks, level.trials)}]`);
    const blurb = active ? paint.dim(`  ${level.blurb}`) : '';
    lines.push(`  ${pointer} ${name} ${paint.dim(scope.padEnd(19))}${estimate}${blurb}`);
  }
  lines.push('');
  lines.push(`  ${paint.dim(`↑/↓ choose ${SYM.dot} Enter run ${SYM.dot} 1–3 jump`)}`);
  return lines;
}

// Ask how thorough the check should be with an in-place arrow-key menu, showing
// an estimated time for each level. Non-interactive callers never reach this
// (they pass --tasks/--trials); a non-TTY session quietly gets Standard.
export async function selectEffort(): Promise<EffortChoice> {
  const defaultIndex = 1; // Standard
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return effortChoice(EFFORT_LEVELS[defaultIndex]!);
  }

  readline.emitKeypressEvents(process.stdin);
  const wasRaw = process.stdin.isRaw === true;
  process.stdin.resume();
  process.stdin.setRawMode(true);
  process.stdout.write('\x1b[?25l');

  let selected = defaultIndex;
  let painted = false;
  const draw = () => {
    const lines = effortMenuLines(selected);
    if (painted) {
      process.stdout.write(`\x1b[${lines.length}A`);
    }
    process.stdout.write(lines.map((line) => `\x1b[2K${line}`).join('\n') + '\n');
    painted = true;
  };

  try {
    draw();
    for (;;) {
      const { input, key } = await readKey();
      if (key.ctrl && key.name === 'c') {
        throw new CancelledError('Selection cancelled.');
      }
      if (key.name === 'up' || input === 'k') {
        selected = selected <= 0 ? EFFORT_LEVELS.length - 1 : selected - 1;
        draw();
        continue;
      }
      if (key.name === 'down' || input === 'j') {
        selected = selected >= EFFORT_LEVELS.length - 1 ? 0 : selected + 1;
        draw();
        continue;
      }
      const jump = EFFORT_LEVELS.findIndex((level) => level.key === input);
      if (jump !== -1) {
        selected = jump;
        break;
      }
      if (key.name === 'return') {
        break;
      }
    }
  } finally {
    process.stdin.setRawMode(wasRaw);
    process.stdin.pause();
    process.stdout.write('\x1b[?25h');
  }

  // Collapse the menu into a single confirmation line.
  const chosen = EFFORT_LEVELS[selected]!;
  const choice = effortChoice(chosen);
  process.stdout.write(`\x1b[${effortMenuLines(selected).length}A\x1b[0J`);
  const scope = `${chosen.tasks} tasks × ${chosen.trials} trial${chosen.trials > 1 ? 's' : ''}`;
  console.log(`  ${paint.ok(SYM.tick)} ${paint.bold('Effort')}      ${chosen.name} ${paint.dim(`${SYM.dot} ${scope}`)} ${paint.accent(`[${choice.estimate}]`)}\n`);
  return choice;
}

const ACTIVE_PHASE_LABELS: Record<ProgressPhase, string> = {
  generating: 'Generating evaluation tasks',
  running: 'Running trials',
  grading: 'Grading outputs',
  scoring: 'Scoring results'
};

const DONE_PHASE_LABELS: Record<ProgressPhase, string> = {
  generating: 'Evaluation tasks ready',
  running: 'Trials complete',
  grading: 'Grading complete',
  scoring: 'Results scored'
};

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
}

function progressBar(completed: number, total: number, width = 12): string {
  const filled = Math.max(0, Math.min(width, Math.round((completed / total) * width)));
  return `${epaint.accent(SYM.barOn.repeat(filled))}${epaint.dim(SYM.barOff.repeat(width - filled))}`;
}

export interface ProgressController {
  update: (event: ProgressUpdate) => void;
  finish: () => void;
  fail: () => void;
}

// A live, phase-aware step tracker on stderr (stdout stays clean for results).
// Finished phases persist as receipt lines — "✓ Trials complete (12/12) · 1m 03s" —
// while the active phase shows a spinner, a progress bar when counts are known,
// and the elapsed time, so a long model run clearly reads as "working", not
// "stuck". Piped stderr gets plain one-line phase updates instead of a spinner.
export function startProgress(): ProgressController {
  const stream = process.stderr;
  const startedAt = Date.now();
  let phaseStartedAt = startedAt;
  let current: ProgressUpdate = { phase: 'generating' };
  let settled = false;

  const doneLine = (update: ProgressUpdate, duration: number): string => {
    const count =
      typeof update.total === 'number' && update.total > 0 && (update.phase === 'running' || update.phase === 'grading')
        ? ` (${update.total}/${update.total})`
        : '';
    return `${epaint.ok(SYM.tick)} ${DONE_PHASE_LABELS[update.phase]}${epaint.dim(`${count} ${SYM.dot} ${formatElapsed(duration)}`)}`;
  };

  if (!stream.isTTY) {
    // Plain, log-friendly phase lines for CI and piped stderr. No control codes.
    let lastPhase: ProgressPhase | undefined;
    return {
      update: (event) => {
        if (event.phase !== lastPhase) {
          lastPhase = event.phase;
          stream.write(`${SYM.dot} ${ACTIVE_PHASE_LABELS[event.phase]}\n`);
        }
      },
      finish: () => {
        stream.write(`${SYM.tick} Analysis complete ${SYM.dot} ${formatElapsed(Date.now() - startedAt)}\n`);
      },
      fail: () => undefined
    };
  }

  let frame = 0;
  const render = () => {
    const spinner = epaint.accent(SPINNER_FRAMES[frame % SPINNER_FRAMES.length]!);
    const label = epaint.bold(ACTIVE_PHASE_LABELS[current.phase]);
    const counted = typeof current.completed === 'number' && typeof current.total === 'number' && current.total > 0;
    const bar = counted ? ` ${progressBar(current.completed!, current.total!)} ${epaint.dim(`${current.completed}/${current.total}`)}` : '';
    const elapsed = epaint.dim(` ${SYM.dot} ${formatElapsed(Date.now() - startedAt)}`);
    stream.write(`\r\x1b[2K${spinner} ${label}${bar}${elapsed}`);
  };

  const timer = setInterval(() => {
    frame += 1;
    render();
  }, 80);

  // Ctrl+C during a long run must not leave the terminal with a hidden cursor.
  const onInterrupt = () => {
    clearInterval(timer);
    stream.write('\r\x1b[2K\x1b[?25h');
    process.exit(130);
  };
  process.once('SIGINT', onInterrupt);
  const cleanup = () => {
    if (settled) {
      return;
    }
    settled = true;
    clearInterval(timer);
    process.removeListener('SIGINT', onInterrupt);
  };

  stream.write('\x1b[?25l');
  render();

  return {
    update: (event: ProgressUpdate) => {
      if (event.phase !== current.phase) {
        // Persist the finished phase as a receipt line, then move on.
        const now = Date.now();
        if (current.phase !== 'scoring') {
          stream.write(`\r\x1b[2K${doneLine(current, now - phaseStartedAt)}\n`);
        }
        phaseStartedAt = now;
      }
      current = event;
      render();
    },
    finish: () => {
      cleanup();
      stream.write(`\r\x1b[2K${epaint.ok(SYM.tick)} ${epaint.bold('Analysis complete')} ${epaint.dim(`${SYM.dot} ${formatElapsed(Date.now() - startedAt)}`)}\n\x1b[?25h`);
    },
    fail: () => {
      cleanup();
      stream.write(
        `\r\x1b[2K${epaint.err(SYM.cross)} ${epaint.dim(`Stopped while ${ACTIVE_PHASE_LABELS[current.phase].toLowerCase()} ${SYM.dot} ${formatElapsed(Date.now() - startedAt)}`)}\n\x1b[?25h`
      );
    }
  };
}

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

// One satisfaction line. The bar + number are coloured by the CURRENT value's band
// (so during the animation it sweeps red→yellow→green as it fills); the trailing
// label shows the FINAL band.
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

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Render the result card, smoothly animating the satisfaction bar to its level on
// an interactive terminal. Non-interactive output is the static card.
export async function printResultCard(result: unknown, outputPath?: string): Promise<void> {
  const geometry = cardGeometry();
  const score = asRecord(asRecord(result).result);
  const finalScore = satisfactionFromResult(score);

  if (!process.stdout.isTTY) {
    console.log(formatResultCard(result, outputPath));
    return;
  }

  console.log(resultHeaderLines(geometry, result, outputPath).join('\n'));
  const onInterrupt = () => {
    process.stdout.write('\x1b[?25h\n');
    process.exit(130);
  };
  process.once('SIGINT', onInterrupt);
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
    process.removeListener('SIGINT', onInterrupt);
    process.stdout.write('\x1b[?25h');
  }
  console.log(cardEdge(geometry, 'bottom'));
}

// A friendly "you're out of free runs" block that points the user at the pricing
// page to add more. Shown both on first connect (if their balance is already 0)
// and when a run is refused mid-check for quota reasons.
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

// The fatal error block written to stderr by the bin entry. Styled with the
// stderr palette so colours follow stderr's own TTY-ness, with the message
// indented under a clear ✗ headline.
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

// Shown when a newer version is published to npm, just before we ask whether to
// update. Mirrors the friendly "update available" notice of other modern CLIs.
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

// Confirmation printed by `skillcheck logout` after the saved key is cleared.
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
