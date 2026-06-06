import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { createInterface } from 'node:readline/promises';

const SUPPORTED_SKILL_FILES = ['SKILL.md', 'AGENTS.md', 'CLAUDE.md', '.cursorrules'];
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
  console.log(`  ${SUPPORTED_SKILL_FILES.join(', ')} or a folder containing one\n`);
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

export function printSetupIntro(): void {
  console.log(`${blue('First-time setup')}`);
  console.log('Paste your Skillcheck API URL and API key from the dashboard, then Skillcheck opens the file picker.');
  console.log(`${dim('Example URL:')} https://your-app.vercel.app/api\n`);
}

export function supportedSkillFilesText(): string {
  return SUPPORTED_SKILL_FILES.join(', ');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    return stats.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function directoryHasSkillFile(dirPath: string): Promise<boolean> {
  for (const fileName of SUPPORTED_SKILL_FILES) {
    if (await fileExists(path.join(dirPath, fileName))) {
      return true;
    }
  }
  return false;
}

function isSupportedSkillFile(filePath: string): boolean {
  return SUPPORTED_SKILL_FILES.includes(path.basename(filePath));
}

export async function validateSkillInput(inputPath: string): Promise<string> {
  try {
    const resolved = path.resolve(inputPath);
    const stats = await stat(resolved);
    if (stats.isDirectory() && (await directoryHasSkillFile(resolved))) {
      return inputPath;
    }
    if (stats.isFile() && isSupportedSkillFile(resolved)) {
      return inputPath;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    throw new Error(`This path does not exist. Please give me a path to ${supportedSkillFilesText()}, or a folder containing one.`);
  }

  throw new Error(`That is not a skill file. Please give me a path to ${supportedSkillFilesText()}, or a folder containing one.`);
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
          const runnable = await directoryHasSkillFile(fullPath);
          return {
            label: `${entry.name}/`,
            fullPath,
            kind: 'directory',
            runnable,
            note: runnable ? 'skill folder' : 'folder'
          };
        }
        const runnable = entry.isFile() && isSupportedSkillFile(fullPath);
        return {
          label: entry.name,
          fullPath,
          kind: 'file',
          runnable,
          note: runnable ? 'skill file' : 'not a skill'
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
      if (a.kind !== b.kind) {
        return a.kind === 'directory' ? -1 : 1;
      }
      if (a.runnable !== b.runnable) {
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
  console.log(`${blue('Select a skill file or folder')}`);
  console.log(`${dim('Current folder:')} ${currentDir}`);
  console.log(dim('Use arrows, Enter to open/select, q to quit.\n'));

  if (message) {
    console.log(`${red(message)}\n`);
  }

  const window = visibleWindow(entries, selected, 12);
  for (const [index, entry] of window.items.entries()) {
    const realIndex = window.offset + index;
    const pointer = realIndex === selected ? blue('>') : ' ';
    const label = realIndex === selected ? white(entry.label) : entry.runnable ? blue(entry.label) : entry.label;
    const note = entry.runnable ? blue(entry.note) : dim(entry.note);
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
      if (entry.kind === 'parent') {
        currentDir = entry.fullPath;
        selected = 0;
        continue;
      }
      if (entry.kind === 'directory' && !entry.runnable) {
        currentDir = entry.fullPath;
        selected = 0;
        continue;
      }
      if (entry.runnable) {
        process.stdout.write('\x1b[2J\x1b[H');
        return entry.fullPath;
      }
      message = `That is not a skill file. Select ${supportedSkillFilesText()}, or a folder containing one.`;
    }
  } finally {
    process.stdin.setRawMode(wasRaw);
    process.stdin.pause();
    process.stdout.write('\x1b[?25h');
  }
}

function progressLine(percent: number): string {
  const width = 32;
  const filled = Math.round((width * percent) / 100);
  const bar = `${'#'.repeat(filled)}${'-'.repeat(width - filled)}`;
  return `${blue('Analyzing skill')} ${white(`[${bar}]`)} ${String(percent).padStart(3, ' ')}%`;
}

export function startProgress(): { finish: () => void; fail: () => void } {
  if (!process.stdout.isTTY) {
    return { finish: () => undefined, fail: () => undefined };
  }

  let percent = 0;
  const render = () => {
    process.stdout.write(`\r\x1b[2K${progressLine(percent)}`);
  };
  const timer = setInterval(() => {
    percent = Math.min(94, percent + 2);
    render();
  }, 400);

  process.stdout.write('\x1b[?25l');
  render();

  return {
    finish: () => {
      clearInterval(timer);
      percent = 100;
      render();
      process.stdout.write('\n\x1b[?25h');
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
