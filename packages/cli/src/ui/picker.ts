import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { SYM, padDisplay, paint, truncateDisplay } from '../theme.js';
import { bannerLines, printBanner } from './banner.js';

const CONVENTIONAL_SKILL_FILES = ['SKILL.md', 'AGENTS.md', 'CLAUDE.md'];
const isMarkdownFile = (filePath: string): boolean => path.extname(filePath).toLowerCase() === '.md';

export class CancelledError extends Error {
  readonly exitCode = 130;
  constructor(message = 'Cancelled.') {
    super(message);
    this.name = 'CancelledError';
  }
}

export interface PickerEntry {
  label: string;
  fullPath: string;
  kind: 'parent' | 'directory' | 'file';
  runnable: boolean;
  note: string;
}

export interface Keypress {
  sequence?: string;
  name?: string;
  ctrl?: boolean;
}

export function supportedSkillFilesText(): string {
  return `a Markdown (.md) file (e.g. ${CONVENTIONAL_SKILL_FILES.join(', ')}), or a folder containing one`;
}

export async function directoryHasMarkdown(dirPath: string): Promise<boolean> {
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
      label = paint.accent(rawLabel);
    } else if (entry.runnable) {
      label = paint.ok(rawLabel);
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

export function readKey(): Promise<{ input: string; key: Keypress }> {
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

  process.stdout.write('\x1b[?1049h\x1b[?25l');
  try {
    for (;;) {
      let entries: PickerEntry[];
      try {
        entries = await listPickerEntries(currentDir);
        lastGoodDir = currentDir;
      } catch (error) {
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

  printBanner();
  const shown = path.relative(process.cwd(), chosen) || chosen;
  console.log(`  ${paint.ok(SYM.tick)} ${paint.bold('Skill file')}  ${shown}\n`);
  return chosen;
}
