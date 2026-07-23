import process from 'node:process';
import { SYM, paint } from '../theme.js';
import { currentVersion } from '../version.js';

const CONVENTIONAL_SKILL_FILES = ['SKILL.md', 'AGENTS.md', 'CLAUDE.md'];
const REPO_URL = 'github.com/sx4im/skillcheck';

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

export function printCheckHeader(inputPath: string, tasks: number, trials: number): void {
  const scope = `${tasks} task${tasks === 1 ? '' : 's'} × ${trials} trial${trials === 1 ? '' : 's'}`;
  console.log(`${paint.accent(SYM.diamond)} ${paint.bold('SkillCheck')} ${paint.dim(`v${currentVersion()}`)}`);
  console.log(`  ${paint.dim('Checking')} ${inputPath} ${paint.dim(`${SYM.dot} ${scope}`)}`);
  console.log('');
}

export function printHelpUi(): void {
  printBanner();
  const cmd = (name: string, blurb: string) =>
    console.log(`    ${paint.bold(name.padEnd(18))}${paint.dim(blurb)}`);
  const opt = (name: string, blurb: string) =>
    console.log(`    ${paint.accent(name.padEnd(18))}${paint.dim(blurb)}`);

  console.log(`  ${paint.accent('Usage')}`);
  console.log(`    ${paint.bold('skillcheck')}                  ${paint.dim('interactive — pick a file, choose effort, run')}`);
  console.log(`    ${paint.bold('skillcheck')} ${paint.accent('<path>')}           ${paint.dim('check a skill file or folder directly')}`);
  console.log(`    ${paint.bold('skillcheck')} ${paint.accent('<command>')} ${paint.dim('[options]')}\n`);

  console.log(`  ${paint.accent('Commands')}`);
  cmd('check <path>', 'A/B check a skill with a readable result card');
  cmd('matrix <path>', 'benchmark a skill across multiple models side-by-side');
  cmd('setup', 'connect via Skillcheck Cloud or Bring Your Own Key (BYOK)');
  cmd('logout', 'remove the saved API key or provider config');
  cmd('eval <path>', 'full evaluation, JSON output');
  cmd('verify <file>', 're-grade a saved result to confirm it reproduces');
  cmd('corpus run', 'batch-check every skill in a corpus file');
  cmd('rot', 're-score saved results against the current model');
  console.log('');

  console.log(`  ${paint.accent('Options')}`);
  opt('--tasks N', 'generated tasks per check (default 3, max 50)');
  opt('--trials K', 'trials per task and arm (default 3, max 10)');
  opt('--concurrency C', 'parallel trial execution limit (default 4)');
  opt('--runner MODEL', 'runner model override (e.g. gpt-4o, claude-3-5-sonnet)');
  opt('--models M1,M2', 'models list for matrix command');
  opt('--output FILE', 'save the full JSON result');
  opt('--explain', 'show a per-task breakdown with example outputs');
  opt('--json', 'machine-readable output, no UI');
  opt('--version', 'print the installed version');
  opt('--help', 'show this help (works after any command)');
  console.log('');

  console.log(`  ${paint.accent('Examples')}`);
  console.log(`    ${paint.dim('$')} skillcheck ./SKILL.md`);
  console.log(`    ${paint.dim('$')} skillcheck check ./SKILL.md --tasks 5 --trials 3 --concurrency 4`);
  console.log(`    ${paint.dim('$')} skillcheck matrix ./SKILL.md --models gpt-4o,claude-3-5-sonnet,gemini-1.5-pro`);
  console.log(`    ${paint.dim('$')} skillcheck setup\n`);

  console.log(`  ${paint.dim('Supported providers (BYOK): OpenAI, Anthropic, Gemini, Groq, Mistral, OpenRouter, NVIDIA NIM')}`);
  console.log(`  ${paint.dim('Supported inputs: any Markdown (.md) file — e.g.')} ${paint.dim(CONVENTIONAL_SKILL_FILES.join(', '))} ${paint.dim('— or a folder.')}`);
  console.log(`  ${paint.dim('Docs:')} https://${REPO_URL}\n`);
}
