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
  promptText,
  selectSkillPath,
  selectEffort,
  selectMenuOption,
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
import { verifyProviderKey, PROVIDER_NAMES } from './adapters/providers.js';
import type { ProviderType } from './adapters/types.js';

// Commands that emit machine-readable output or run unattended — never interrupt
// these with the interactive "update available?" prompt.
const MACHINE_COMMANDS = new Set(['eval', 'm0', 'corpus', 'rot', 'verify', 'matrix']);

// First-run onboarding. Supports hosted mode (Skillcheck Cloud) as default,
// or Bring-Your-Own-Key (BYOK) for OpenAI, Anthropic, Gemini, Groq, Mistral, OpenRouter, NVIDIA NIM.
async function ensureCloudConfigured(force = false): Promise<void> {
  const hasDirectEnv = Boolean(
    process.env.NVIDIA_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.ANTHROPIC_API_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    process.env.GROQ_API_KEY?.trim() ||
    process.env.MISTRAL_API_KEY?.trim() ||
    process.env.OPENROUTER_API_KEY?.trim()
  );
  if (!force && hasDirectEnv) {
    return;
  }

  const current = loadUserConfig();
  if (!force && (getConfiguredToken() || (current.provider && current.providerKey))) {
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      `Skillcheck needs an API key. Run \`skillcheck setup\` in an interactive terminal, or set SKILLCHECK_TOKEN. Get a key at ${cloudWebUrl()}`
    );
  }

  printBanner();

  const mode = await selectMenuOption(
    'How do you want to connect to models?',
    'Hosted mode is free & ready in 30 seconds. Bring Your Own Key uses your provider key directly.',
    [
      { key: '1', name: 'Skillcheck Cloud (Hosted)', value: 'hosted', blurb: 'recommended — free 10 checks' },
      { key: '2', name: 'Bring Your Own Key (BYOK)', value: 'byok', blurb: 'OpenAI, Anthropic, Gemini, Groq, Mistral, OpenRouter, NIM' }
    ]
  );

  if (mode === 'hosted') {
    const apiUrl = cloudApiUrl();
    const webUrl = cloudWebUrl();
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
        const savedPath = saveUserConfig({ ...current, apiUrl, token: keyInput, provider: 'cloud' });
        printKeyVerified(check, savedPath);
        return;
      }

      if (check.reachable) {
        printKeyRejected(check.message ?? 'The key was not accepted.', webUrl);
      } else {
        printKeyUnreachable(check.message ?? 'Network error.');
      }
    }
  } else {
    const provider = await selectMenuOption<ProviderType>(
      'Select Provider',
      'Choose the LLM provider you hold an API key for',
      [
        { key: '1', name: 'OpenAI', value: 'openai' },
        { key: '2', name: 'Anthropic', value: 'anthropic' },
        { key: '3', name: 'Google Gemini', value: 'gemini' },
        { key: '4', name: 'Groq', value: 'groq' },
        { key: '5', name: 'Mistral AI', value: 'mistral' },
        { key: '6', name: 'OpenRouter', value: 'openrouter' },
        { key: '7', name: 'NVIDIA NIM', value: 'nvidia' }
      ]
    );

    const providerName = PROVIDER_NAMES[provider];

    for (;;) {
      const apiKey = await promptSecret(`Paste your ${providerName} API key: `);
      if (!apiKey) {
        continue;
      }

      printKeyChecking();
      const check = await verifyProviderKey(provider, apiKey);

      if (check.valid && check.models.length > 0) {
        console.log('verified.');
        const modelOptions = check.models.slice(0, 30).map((m, idx) => ({
          key: String(idx + 1),
          name: m.id,
          value: m.id
        }));

        const selectedModel = await selectMenuOption(
          `Select Model (${providerName})`,
          'This model will be used for generator, runner, and grader roles (can be overridden via env)',
          modelOptions
        );

        const savedPath = saveUserConfig({
          ...current,
          provider,
          providerKey: apiKey,
          generatorModel: selectedModel,
          runnerModel: selectedModel,
          graderModel: selectedModel
        });

        console.log(`✓ You're all set with ${providerName}! Model: ${selectedModel}`);
        console.log(`Key saved to ${savedPath}\n`);
        return;
      }

      console.log('not accepted.');
      console.log(`✗ ${check.message ?? 'The key could not be verified or list models.'}\n`);
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
    throw new Error('Usage: skillcheck eval <path> [--tasks N] [--trials K] [--concurrency C] [--output file.json]');
  }
  assertKnownOptions(
    argv,
    inputIndex + 1,
    ['--tasks', '--trials', '--concurrency', '--output', '--mode', '--runner', '--grader', '--generator', '--task-suite'],
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
    concurrency: readNumberOption(argv, '--concurrency', 4, MAX_CONCURRENCY),
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
  effortPinned: boolean;
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
    ['--tasks', '--trials', '--concurrency', '--output', '--runner', '--grader', '--generator', '--task-suite'],
    ['--json', '--explain']
  );

  const output = readOption(argv, '--output');
  return {
    evalOptions: {
      inputPath,
      output,
      tasks: readNumberOption(argv, '--tasks', 3, MAX_TASKS),
      trials: readNumberOption(argv, '--trials', 3, MAX_TRIALS),
      concurrency: readNumberOption(argv, '--concurrency', 4, MAX_CONCURRENCY),
      mode: 'forced',
      runner: readOption(argv, '--runner'),
      grader: readOption(argv, '--grader'),
      generator: readOption(argv, '--generator'),
      taskSuite: readOption(argv, '--task-suite'),
      saveArtifacts: Boolean(output),
      explain: hasFlag(argv, '--explain')
    },
    json: hasFlag(argv, '--json'),
    output,
    effortPinned: hasFlag(argv, '--tasks') || hasFlag(argv, '--trials')
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

interface MatrixOptions {
  inputPath: string;
  models: string[];
  tasks: number;
  trials: number;
  concurrency: number;
  json: boolean;
}

function parseMatrixOptions(argv: string[]): MatrixOptions {
  const inputPath = argv[3];
  if (!inputPath || inputPath.startsWith('--')) {
    throw new Error('Usage: skillcheck matrix <path> [--models model1,model2] [--tasks N] [--trials K] [--concurrency C]');
  }
  assertKnownOptions(
    argv,
    4,
    ['--models', '--tasks', '--trials', '--concurrency'],
    ['--json']
  );

  const rawModels = readOption(argv, '--models');
  const models = rawModels
    ? rawModels.split(',').map((m) => m.trim()).filter(Boolean)
    : ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet-20241022', 'google/gemini-1.5-pro', 'openai/gpt-oss-120b'];

  return {
    inputPath,
    models,
    tasks: readNumberOption(argv, '--tasks', 3, MAX_TASKS),
    trials: readNumberOption(argv, '--trials', 3, MAX_TRIALS),
    concurrency: readNumberOption(argv, '--concurrency', 4, MAX_CONCURRENCY),
    json: hasFlag(argv, '--json')
  };
}

async function runMatrix(options: MatrixOptions): Promise<unknown> {
  await validateSkillInput(options.inputPath);
  await ensureCloudConfigured(false);

  const results: Array<{ model: string; verdict: string; score: number; effectPp: number }> = [];

  for (const model of options.models) {
    const res = (await evalSkill({
      inputPath: options.inputPath,
      tasks: options.tasks,
      trials: options.trials,
      concurrency: options.concurrency,
      mode: 'forced',
      runner: model
    })) as { summary: { verdict: string; satisfactionScore: number; effectPp: number } };

    results.push({
      model,
      verdict: res.summary.verdict,
      score: res.summary.satisfactionScore,
      effectPp: res.summary.effectPp
    });
  }

  if (!options.json) {
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│                    SKILLCHECK MATRIX                        │');
    console.log('├──────────────────────────────────────┬──────────┬───────────┤');
    console.log('│ Model                                │ Verdict  │ Score     │');
    console.log('├──────────────────────────────────────┼──────────┼───────────┤');
    for (const r of results) {
      const m = r.model.padEnd(36).slice(0, 36);
      const v = r.verdict.padEnd(8);
      const s = `${r.score.toFixed(1)}%`.padStart(9);
      console.log(`│ ${m} │ ${v} │ ${s} │`);
    }
    console.log('└──────────────────────────────────────┴──────────┴───────────┘\n');
  }

  return { matrix: results };
}

// Direct invocations (`skillcheck check ./SKILL.md`) get a compact one-line
// header; the interactive flow already showed the hero banner, so it passes
// 'none'. Validation runs first so a bad path fails before any UI is drawn.
async function runCheck(options: CheckOptions, header: 'compact' | 'none' = 'compact'): Promise<void> {
  await validateSkillInput(options.evalOptions.inputPath);
  await ensureCloudConfigured(false);

  const interactive = !options.json && process.stdin.isTTY === true && process.stdout.isTTY === true;

  // A direct `check <path>` on a TTY that didn't pin --tasks/--trials gets the same
  // effort menu as the no-arg flow, instead of silently running at the defaults.
  let pickedEffort = false;
  if (interactive && !options.effortPinned) {
    const effort = await selectEffort('Effort');
    options.evalOptions.tasks = effort.tasks;
    options.evalOptions.trials = effort.trials;
    pickedEffort = true;
  }

  // Skip the compact header when we just showed the effort menu — its confirmation
  // line ("✓ Effort  Standard · 3 tasks × 2 trials") already states the run size.
  if (header === 'compact' && !options.json && !pickedEffort) {
    printCheckHeader(options.evalOptions.inputPath, options.evalOptions.tasks, options.evalOptions.trials);
  }

  // The per-task breakdown reuses the outputs the run already produced (no extra
  // model calls), so for an interactive human run we always compute it and then
  // OFFER it after the card. `--explain` shows it straight away, unprompted.
  const explicitExplain = options.evalOptions.explain === true;
  options.evalOptions.explain = explicitExplain || interactive;

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

  const breakdown = formatExplain(result);
  if (!breakdown) {
    return;
  }
  if (explicitExplain) {
    console.log(breakdown);
    return;
  }
  if (interactive) {
    const answer = (await promptText('See the per-task breakdown? [y/N] ')).trim().toLowerCase();
    if (answer === 'y' || answer === 'yes') {
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
  options.effortPinned = true; // already chosen above — don't let runCheck re-ask
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

  if (command === 'setup' || command === '--setup' || command === 'config' || command === '--config' || command === 'login') {
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

  if (command === 'matrix') {
    const options = parseMatrixOptions(argv);
    const result = await runMatrix(options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    }
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
