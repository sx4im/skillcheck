import process from 'node:process';
import { SYM, paint } from './theme.js';
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
    console.log(`    ${paint.bold(name.padEnd(22))}${paint.dim(blurb)}`);
  const opt = (name: string, blurb: string) =>
    console.log(`    ${paint.accent(name.padEnd(22))}${paint.dim(blurb)}`);

  console.log(`  ${paint.accent('Usage')}`);
  console.log(`    ${paint.bold('skillcheck')}                      ${paint.dim('interactive — pick a file, choose effort, run')}`);
  console.log(`    ${paint.bold('skillcheck')} ${paint.accent('<path>')}               ${paint.dim('check a skill file or folder directly')}`);
  console.log(`    ${paint.bold('skillcheck')} ${paint.accent('<path> --explain')}     ${paint.dim('check and show detailed task breakdown')}`);
  console.log(`    ${paint.bold('skillcheck')} ${paint.accent('<command> [options]')}\n`);

  console.log(`  ${paint.accent('Commands')}`);
  cmd('check <path>', 'A/B check a skill with a readable result card');
  cmd('watch <path>', 'hot-reloads & re-evaluates skill automatically on save');
  cmd('demo', 'instant 5-second simulated benchmark (zero keys required)');
  cmd('matrix <path>', 'benchmark a skill across multiple models side-by-side');
  cmd('hook [install|run]', 'install or execute git pre-commit regression guard');
  cmd('setup', 'connect via Skillcheck Cloud or Bring Your Own Key (BYOK)');
  cmd('logout', 'remove the saved API key or provider config');
  cmd('eval <path>', 'full evaluation, JSON output');
  cmd('verify <file>', 're-grade a saved result to confirm it reproduces');
  cmd('corpus run', 'batch-check every skill in a corpus file');
  cmd('rot', 're-score saved results against the current model');
  cmd('completion [sh]', 'generate tab completion script (bash, zsh, fish)');
  cmd('help [command]', 'show general help or detailed help for a command');
  console.log('');

  console.log(`  ${paint.accent('Options')}`);
  opt('--tasks N', 'generated tasks per check (default 3, max 50)');
  opt('--trials K', 'trials per task and arm (default 3, max 10)');
  opt('--domain TEXT', 'domain override for task generation');
  opt('--difficulty LEVEL', 'task difficulty: standard, hard, adversarial (default standard)');
  opt('--concurrency C', 'parallel trial execution limit (default 4)');
  opt('--runner MODEL', 'runner model override (e.g. gpt-6-sol, claude-opus-5-5)');
  opt('--models M1,M2', 'models list for matrix command');
  opt('--output FILE', 'save the full JSON result');
  opt('--explain', 'show a per-task breakdown with example outputs');
  opt('--clipboard', 'copy GitHub PR review markdown to clipboard');
  opt('--resume', 'resume interrupted run from last saved checkpoint');
  opt('--inspect', 'open interactive alternate-screen trial inspector');
  opt('--json', 'machine-readable output, no UI');
  opt('--version', 'print the installed version');
  opt('--help', 'show this help (works after any command)');
  console.log('');

  console.log(`  ${paint.accent('Examples')}`);
  console.log(`    ${paint.dim('$')} skillcheck ./SKILL.md`);
  console.log(`    ${paint.dim('$')} skillcheck ./SKILL.md --explain`);
  console.log(`    ${paint.dim('$')} skillcheck check ./SKILL.md --tasks 5 --trials 3`);
  console.log(`    ${paint.dim('$')} skillcheck matrix ./SKILL.md --models gpt-6-sol,claude-opus-5-5`);
  console.log(`    ${paint.dim('$')} skillcheck setup\n`);

  console.log(`  ${paint.dim('Supported providers (BYOK): OpenAI, Anthropic, Gemini, Groq, Mistral, OpenRouter, NVIDIA NIM')}`);
  console.log(`  ${paint.dim('Supported inputs: any Markdown (.md) file — e.g.')} ${paint.dim(CONVENTIONAL_SKILL_FILES.join(', '))} ${paint.dim('— or a folder.')}`);
  console.log(`  ${paint.dim('Docs:')} https://${REPO_URL}\n`);
}

export function printCommandHelpUi(command: string): boolean {
  const norm = command.toLowerCase().trim();
  const opt = (name: string, blurb: string) =>
    console.log(`    ${paint.accent(name.padEnd(22))}${paint.dim(blurb)}`);
  const sec = (title: string) => console.log(`\n  ${paint.accent(title)}`);

  if (norm === 'check' || norm === 'c' || norm === 'run') {
    console.log(`\n  ${paint.bold('Skillcheck check')} ${paint.dim('— A/B test an agent skill')}`);
    sec('Usage');
    console.log(`    ${paint.bold('skillcheck check')} ${paint.accent('<path> [options]')}`);
    console.log(`    ${paint.bold('skillcheck')} ${paint.accent('<path> [options]')}`);
    sec('Description');
    console.log(`    Runs a controlled A/B experiment comparing model performance with and without your skill.`);
    console.log(`    Synthesizes domain tasks, runs paired trials, uses blind grading, and outputs effect size.`);
    sec('Arguments');
    console.log(`    ${paint.accent('<path>')}                 ${paint.dim('Path to a Markdown file (.md) or a folder containing one.')}`);
    console.log(`                           ${paint.dim('Supported: SKILL.md, .cursorrules, CLAUDE.md, AGENTS.md, etc.')}`);
    sec('Options');
    opt('--tasks N', 'evaluation tasks to generate (default 3, max 50)');
    opt('--trials K', 'trials per task and arm (default 3, max 10)');
    opt('--domain TEXT', 'domain override for task generation');
    opt('--difficulty LEVEL', 'task difficulty: standard, hard, adversarial (default standard)');
    opt('--concurrency C', 'parallel trial execution limit (default 4)');
    opt('--runner MODEL', 'runner model override (e.g. gpt-4o, claude-3-5-sonnet)');
    opt('--grader MODEL', 'grader model override');
    opt('--generator MODEL', 'task generator model override');
    opt('--output FILE', 'save the full JSON evaluation result');
    opt('--explain', 'show a per-task breakdown with example outputs');
    opt('--markdown', 'print a GitHub-Flavored Markdown report (CI-friendly)');
    opt('--json', 'emit machine-readable JSON without terminal UI');
    opt('--help, -h', 'show this command help');
    sec('Examples');
    console.log(`    ${paint.dim('$')} skillcheck check ./SKILL.md`);
    console.log(`    ${paint.dim('$')} skillcheck check ./SKILL.md --tasks 5 --trials 3`);
    console.log(`    ${paint.dim('$')} skillcheck check ./SKILL.md --explain`);
    console.log(`    ${paint.dim('$')} skillcheck check ./SKILL.md --runner claude-3-5-sonnet --output result.json\n`);
    return true;
  }

  if (norm === 'demo') {
    console.log(`\n  ${paint.bold('Skillcheck demo')} ${paint.dim('— Instant zero-setup demonstration')}`);
    sec('Usage');
    console.log(`    ${paint.bold('skillcheck demo')}`);
    sec('Description');
    console.log(`    Runs an instant 5-second simulated benchmark on an exemplary code review skill.`);
    console.log(`    Demonstrates the live step tracker, spinner, and satisfaction card with zero API keys required.`);
    sec('Examples');
    console.log(`    ${paint.dim('$')} skillcheck demo\n`);
    return true;
  }

  if (norm === 'matrix' || norm === 'compare') {
    console.log(`\n  ${paint.bold('Skillcheck matrix')} ${paint.dim('— Cross-model benchmark')}`);
    sec('Usage');
    console.log(`    ${paint.bold('skillcheck matrix')} ${paint.accent('<path> [options]')}`);
    sec('Description');
    console.log(`    Benchmarks an agent skill across multiple LLM models side-by-side to detect`);
    console.log(`    model-specific gains, placebos, or regressions.`);
    sec('Options');
    opt('--models M1,M2', 'comma-separated list of models to evaluate');
    opt('--tasks N', 'evaluation tasks per model (default 3, max 50)');
    opt('--trials K', 'trials per task and arm (default 3, max 10)');
    opt('--concurrency C', 'parallel execution limit (default 4)');
    opt('--json', 'output matrix results as JSON');
    opt('--help, -h', 'show this command help');
    sec('Examples');
    console.log(`    ${paint.dim('$')} skillcheck matrix ./SKILL.md`);
    console.log(`    ${paint.dim('$')} skillcheck matrix ./SKILL.md --models gpt-6-sol,claude-opus-5-5\n`);
    return true;
  }

  if (norm === 'setup' || norm === 'config' || norm === 'login' || norm === 'auth' || norm === 'init') {
    console.log(`\n  ${paint.bold('Skillcheck setup')} ${paint.dim('— Connect model provider or cloud')}`);
    sec('Usage');
    console.log(`    ${paint.bold('skillcheck setup')}`);
    sec('Description');
    console.log(`    Interactive setup wizard. Connect via Skillcheck Cloud (10 free evaluations)`);
    console.log(`    or Bring Your Own Key (BYOK) supporting:`);
    console.log(`    OpenAI, Anthropic, Google Gemini, Groq, Mistral AI, OpenRouter, NVIDIA NIM.\n`);
    return true;
  }

  if (norm === 'logout' || norm === 'signout' || norm === 'deauth') {
    console.log(`\n  ${paint.bold('Skillcheck logout')} ${paint.dim('— Disconnect credentials')}`);
    sec('Usage');
    console.log(`    ${paint.bold('skillcheck logout')}`);
    sec('Description');
    console.log(`    Removes saved API keys and provider configurations from ~/.config/skillcheck/config.json.\n`);
    return true;
  }

  if (norm === 'watch' || norm === 'w') {
    console.log(`\n  ${paint.bold('Skillcheck watch')} ${paint.dim('— Hot-reloading development loop')}`);
    sec('Usage');
    console.log(`    ${paint.bold('skillcheck watch')} ${paint.accent('<path> [--tasks N] [--trials K]')}`);
    sec('Description');
    console.log(`    Watches your skill file for changes, computes real-time token count deltas,`);
    console.log(`    and automatically re-evaluates in the background upon save.\n`);
    return true;
  }

  if (norm === 'hook') {
    console.log(`\n  ${paint.bold('Skillcheck hook')} ${paint.dim('— Git pre-commit regression guard')}`);
    sec('Usage');
    console.log(`    ${paint.bold('skillcheck hook install')}`);
    console.log(`    ${paint.bold('skillcheck hook run')} ${paint.accent('[--strict]')}`);
    sec('Description');
    console.log(`    Installs or executes git pre-commit checks on staged prompt files, rejecting regressions (HARMS).\n`);
    return true;
  }

  if (norm === 'eval') {
    console.log(`\n  ${paint.bold('Skillcheck eval')} ${paint.dim('— Headless evaluation (JSON)')}`);
    sec('Usage');
    console.log(`    ${paint.bold('skillcheck eval')} ${paint.accent('<path> [options]')}`);
    sec('Description');
    console.log(`    Runs a full A/B evaluation and emits raw JSON to stdout. Designed for CI and scripts.`);
    sec('Options');
    opt('--tasks N', 'tasks to generate (default 10)');
    opt('--trials K', 'trials per task and arm (default 3)');
    opt('--difficulty LEVEL', 'task difficulty: standard, hard, adversarial (default standard)');
    opt('--output FILE', 'save result JSON to file');
    opt('--explain', 'include per-task explain data in output\n');
    opt('--markdown', 'print a GitHub-Flavored Markdown report instead of JSON');
    return true;
  }

  if (norm === 'verify') {
    console.log(`\n  ${paint.bold('Skillcheck verify')} ${paint.dim('— Reproducibility verifier')}`);
    sec('Usage');
    console.log(`    ${paint.bold('skillcheck verify')} ${paint.accent('<result.json> [--sample N]')}`);
    sec('Description');
    console.log(`    Re-evaluates a previously saved result to verify that measured effect size reproduces.\n`);
    return true;
  }

  if (norm === 'corpus') {
    console.log(`\n  ${paint.bold('Skillcheck corpus')} ${paint.dim('— Batch corpus runner')}`);
    sec('Usage');
    console.log(`    ${paint.bold('skillcheck corpus run')} ${paint.accent('--corpus corpus.json [--results dir]')}`);
    sec('Description');
    console.log(`    Batch-evaluates an entire collection of skills declared in a corpus manifest.\n`);
    return true;
  }

  if (norm === 'rot') {
    console.log(`\n  ${paint.bold('Skillcheck rot')} ${paint.dim('— Prompt rot detection')}`);
    sec('Usage');
    console.log(`    ${paint.bold('skillcheck rot')} ${paint.accent('[--corpus file.json] [--results dir]')}`);
    sec('Description');
    console.log(`    Re-scores saved benchmark results against the current model to detect prompt rot.\n`);
    return true;
  }

  return false;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i]![0] = i;
  for (let j = 0; j <= n; j += 1) dp[0]![j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[m]![n]!;
}

export function findClosestCommand(input: string, knownCommands: string[]): string | undefined {
  let closest: string | undefined;
  let minDistance = 3;
  const clean = input.toLowerCase().trim();
  for (const cmd of knownCommands) {
    const dist = levenshtein(clean, cmd.toLowerCase());
    if (dist < minDistance) {
      minDistance = dist;
      closest = cmd;
    }
  }
  return closest;
}
