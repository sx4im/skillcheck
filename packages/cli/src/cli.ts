import { existsSync } from 'node:fs';
import { NvidiaNimClient } from './adapters/nvidia-nim.js';
import {
  cloudApiUrl,
  cloudWebUrl,
  getConfiguredToken,
  loadUserConfig,
  logoutUser,
  saveUserConfig,
  verifyCloudKey
} from './config.js';
import { runCorpus, type CorpusRunOptions } from './corpus.js';
import { evalSkill, type EvalOptions } from './eval.js';
import { runM0Gate } from './m0/run.js';
import { runRot, type RotOptions } from './rot.js';
import {
  printResultCard,
  formatExplain,
  printHelpUi,
  printBanner,
  printCheckHeader,
  printSetupIntro,
  printKeyChecking,
  printKeyVerified,
  printKeyRejected,
  printKeyUnreachable,
  printKeyPromptHint,
  printLogout,
  promptSecret,
  selectSkillPath,
  selectEffort,
  startProgress,
  validateSkillInput
} from './ui.js';
import { currentVersion, maybeNotifyUpdate } from './update.js';
import { verifyResult } from './verify.js';

function printHelp(): void {
  printHelpUi();
}

// Commands that emit machine-readable output or run unattended — never interrupt
// these with the interactive "update available?" prompt.
const MACHINE_COMMANDS = new Set(['eval', 'm0', 'corpus', 'rot', 'verify']);

// First-run onboarding. The CLI demands a Skillcheck Cloud API key, points the
// user at the website to grab one, authenticates the pasted key against the
// hosted /key/verify endpoint, and only saves it once it is confirmed valid.
// The hosted URL is baked in (config.cloudApiUrl), so the user never types a URL.
async function ensureCloudConfigured(force = false): Promise<void> {
  // Maintainer/dev mode: a direct NVIDIA key bypasses the hosted proxy entirely.
  if (process.env.NVIDIA_API_KEY?.trim()) {
    return;
  }
  if (!force && getConfiguredToken()) {
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      `Skillcheck needs an API key. Run \`skillcheck setup\` in an interactive terminal, or set SKILLCHECK_TOKEN. Get a key at ${cloudWebUrl()}`
    );
  }

  const apiUrl = cloudApiUrl();
  const webUrl = cloudWebUrl();

  printBanner();
  printSetupIntro(webUrl);

  for (;;) {
    const keyInput = await promptSecret('Paste your Skillcheck API key: ');
    if (!keyInput) {
      printKeyPromptHint(webUrl);
      continue;
    }

    printKeyChecking();
    const check = await verifyCloudKey(apiUrl, keyInput);

    if (check.valid) {
      const current = loadUserConfig();
      const savedPath = saveUserConfig({ ...current, apiUrl, token: keyInput });
      printKeyVerified(check, savedPath);
      return;
    }

    if (check.reachable) {
      printKeyRejected(check.message ?? 'The key was not accepted.', webUrl);
    } else {
      printKeyUnreachable(check.message ?? 'Network error.');
    }
  }
}

// Upper bounds keep a typo like `--tasks 300` from turning one metered run into
// hundreds of model calls. Generous enough for every documented workflow.
const MAX_TASKS = 50;
const MAX_TRIALS = 10;
const MAX_CONCURRENCY = 8;

function readOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function readNumberOption(argv: string[], name: string, fallback: number, max?: number): number {
  const value = readOption(argv, name);
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  if (max !== undefined && parsed > max) {
    throw new Error(`${name} must be at most ${max}`);
  }
  return parsed;
}

function readOptionalNumberOption(argv: string[], name: string): number | undefined {
  const value = readOption(argv, name);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

// Reject mistyped options (e.g. --task instead of --tasks) instead of silently
// ignoring them and running with defaults the user did not ask for.
function assertKnownOptions(argv: string[], firstIndex: number, valueOptions: string[], flags: string[] = []): void {
  for (let i = Math.max(firstIndex, 0); i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith('--')) {
      continue;
    }
    if (flags.includes(token)) {
      continue;
    }
    if (!valueOptions.includes(token)) {
      throw new Error(`Unknown option ${token}. Valid options: ${[...valueOptions, ...flags].join(', ')}`);
    }
    i += 1; // skip this option's value
  }
}

function parseEvalOptions(argv: string[], inputIndex = 3): EvalOptions {
  const inputPath = argv[inputIndex];
  if (!inputPath || inputPath.startsWith('--')) {
    throw new Error('Usage: skillcheck eval <path> [--tasks N] [--trials K] [--output file.json]');
  }
  assertKnownOptions(
    argv,
    inputIndex + 1,
    ['--tasks', '--trials', '--output', '--mode', '--runner', '--grader', '--generator', '--task-suite'],
    ['--explain']
  );

  const mode = readOption(argv, '--mode') ?? 'forced';
  if (mode !== 'forced') {
    throw new Error('Only --mode forced is supported in v1');
  }

  return {
    inputPath,
    output: readOption(argv, '--output'),
    tasks: readNumberOption(argv, '--tasks', 10, MAX_TASKS),
    trials: readNumberOption(argv, '--trials', 3, MAX_TRIALS),
    mode,
    runner: readOption(argv, '--runner'),
    grader: readOption(argv, '--grader'),
    generator: readOption(argv, '--generator'),
    taskSuite: readOption(argv, '--task-suite'),
    explain: hasFlag(argv, '--explain')
  };
}

interface CheckOptions {
  evalOptions: EvalOptions;
  json: boolean;
  output?: string;
}

export function parseCheckOptions(argv: string[], inputIndex = 3): CheckOptions {
  const inputPath = argv[inputIndex];
  if (!inputPath || inputPath.startsWith('--')) {
    throw new Error(
      'Usage: skillcheck check <path-to-skill-file-or-folder>\nExample: skillcheck check ./SKILL.md'
    );
  }

  assertKnownOptions(
    argv,
    inputIndex + 1,
    ['--tasks', '--trials', '--output', '--runner', '--grader', '--generator', '--task-suite'],
    ['--json', '--explain']
  );

  const output = readOption(argv, '--output');
  return {
    evalOptions: {
      inputPath,
      output,
      tasks: readNumberOption(argv, '--tasks', 3, MAX_TASKS),
      trials: readNumberOption(argv, '--trials', 2, MAX_TRIALS),
      mode: 'forced',
      runner: readOption(argv, '--runner'),
      grader: readOption(argv, '--grader'),
      generator: readOption(argv, '--generator'),
      taskSuite: readOption(argv, '--task-suite'),
      saveArtifacts: Boolean(output),
      explain: hasFlag(argv, '--explain')
    },
    json: hasFlag(argv, '--json'),
    output
  };
}

function parseRotOptions(argv: string[]): RotOptions {
  assertKnownOptions(argv, 3, ['--results', '--output', '--model', '--corpus', '--tasks', '--trials']);
  return {
    resultsDir: readOption(argv, '--results') ?? 'results',
    output: readOption(argv, '--output') ?? 'results/rot/report.json',
    model: readOption(argv, '--model'),
    corpus: readOption(argv, '--corpus'),
    tasks: readNumberOption(argv, '--tasks', 10, MAX_TASKS),
    trials: readNumberOption(argv, '--trials', 3, MAX_TRIALS)
  };
}

function parseCorpusRunOptions(argv: string[]): CorpusRunOptions {
  assertKnownOptions(argv, 4, ['--corpus', '--results', '--tasks', '--trials', '--concurrency', '--runner', '--limit']);
  const corpus = readOption(argv, '--corpus');
  if (!corpus) {
    throw new Error('Usage: skillcheck corpus run --corpus corpus.json [--results dir]');
  }

  return {
    corpus,
    outputDir: readOption(argv, '--results') ?? 'results/corpus',
    tasks: readNumberOption(argv, '--tasks', 10, MAX_TASKS),
    trials: readNumberOption(argv, '--trials', 3, MAX_TRIALS),
    concurrency: readNumberOption(argv, '--concurrency', 2, MAX_CONCURRENCY),
    runner: readOption(argv, '--runner'),
    limit: readOptionalNumberOption(argv, '--limit')
  };
}

// Direct invocations (`skillcheck check ./SKILL.md`) get a compact one-line
// header; the interactive flow already showed the hero banner, so it passes
// 'none'. Validation runs first so a bad path fails before any UI is drawn.
async function runCheck(options: CheckOptions, header: 'compact' | 'none' = 'compact'): Promise<void> {
  await validateSkillInput(options.evalOptions.inputPath);
  await ensureCloudConfigured(false);
  if (header === 'compact' && !options.json) {
    printCheckHeader(options.evalOptions.inputPath, options.evalOptions.tasks, options.evalOptions.trials);
  }
  const progress = options.json ? undefined : startProgress();
  let result: unknown;
  try {
    result = await evalSkill({
      ...options.evalOptions,
      onProgress: progress ? (event) => progress.update(event) : undefined
    });
    progress?.finish();
  } catch (error) {
    progress?.fail();
    throw error;
  }
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  await printResultCard(result, options.output);
  if (options.evalOptions.explain) {
    const breakdown = formatExplain(result);
    if (breakdown) {
      console.log(breakdown);
    }
  }
}

async function runInteractiveCheck(): Promise<void> {
  await ensureCloudConfigured(false);
  const selectedPath = await selectSkillPath();
  const effort = await selectEffort();
  const options = parseCheckOptions(['node', 'skillcheck', 'check', selectedPath]);
  options.evalOptions.tasks = effort.tasks;
  options.evalOptions.trials = effort.trials;
  await runCheck(options, 'none');
}

export async function main(argv: string[]): Promise<void> {
  const command = argv[2];

  // `--help`/`-h` anywhere on the line prints usage. Without this, `skillcheck
  // check --help` parses `--help` as the skill path and dies with a confusing
  // "missing path" error instead of showing help.
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  if (command === '--version' || command === '-v' || command === 'version') {
    console.log(currentVersion());
    return;
  }

  // Offer an update when a newer version is on npm — but only for interactive,
  // human-facing invocations (skipped for --json and machine commands).
  if (!argv.includes('--json') && !MACHINE_COMMANDS.has(command ?? '')) {
    await maybeNotifyUpdate();
  }

  if (!command) {
    await runInteractiveCheck();
    return;
  }

  if (command === 'setup' || command === 'config' || command === 'login') {
    await ensureCloudConfigured(true);
    return;
  }

  if (command === 'logout' || command === 'signout') {
    printLogout(logoutUser());
    return;
  }

  if (command === 'm0') {
    const report = await runM0Gate((config) => new NvidiaNimClient(config));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.passed ? 0 : 1;
    return;
  }

  if (command === 'check') {
    await runCheck(parseCheckOptions(argv));
    return;
  }

  if (command === 'eval') {
    const result = await evalSkill(parseEvalOptions(argv));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'verify') {
    const resultPath = argv[3];
    if (!resultPath || resultPath.startsWith('--')) {
      throw new Error('Usage: skillcheck verify <result.json> [--sample n]');
    }
    assertKnownOptions(argv, 4, ['--sample']);
    const result = await verifyResult({
      resultPath,
      sample: readNumberOption(argv, '--sample', 3, MAX_TASKS)
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'corpus') {
    const subcommand = argv[3];
    if (subcommand !== 'run') {
      throw new Error('Usage: skillcheck corpus run --corpus corpus.json [--results dir]');
    }
    const result = await runCorpus(parseCorpusRunOptions(argv));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'rot') {
    const result = await runRot(parseRotOptions(argv));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!command.startsWith('-') && existsSync(command)) {
    await runCheck(parseCheckOptions(['node', 'skillcheck', 'check', ...argv.slice(2)]));
    return;
  }

  // A path-shaped argument that doesn't exist deserves a file error, not a
  // baffling "unknown command".
  const looksLikePath =
    !command.startsWith('-') && (command.includes('/') || command.includes('\\') || command.startsWith('.') || /\.md$/i.test(command));
  if (looksLikePath) {
    throw new Error(`Path not found: ${command}\nGive me a Markdown (.md) skill file, or a folder containing one.`);
  }
  throw new Error(`Unknown command: ${command}\nRun \`skillcheck --help\` to see available commands.`);
}
