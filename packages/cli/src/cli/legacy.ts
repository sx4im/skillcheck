import { ValidationError } from '../errors.js';
import { singleLine, stringifySafe } from '../core/security/output.js';
import { CHECK_VALUE_OPTIONS, MAX_CONCURRENCY, MAX_TASKS, MAX_TRIALS, assertKnownOptions, findInputArgument, hasFlag, readNumberOption, readOption, readOptionalNumberOption } from './args.js';
import { commandUsage } from './command-help.js';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { verifyProviderKey, createLlmClient, PROVIDER_NAMES } from '../providers/providers.js';
import type { ProviderType } from '../providers/types.js';
import type { TaskDifficulty } from '../types.js';
import {
  cloudApiUrl,
  cloudWebUrl,
  getConfiguredToken,
  loadUserConfig,
  logoutUser,
  saveUserConfig,
  verifyCloudKey
} from '../config.js';
import type { CorpusRunOptions } from '../corpus.js';
import { evalSkill, type EvalOptions, type EvalResult } from '../eval.js';
import { loadProviderConfig } from '../env.js';
import type { RotOptions } from '../rot.js';
import {
  printResultCard,
  formatExplain,
  findClosestCommand,
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
  validateSkillInput,
  copyToClipboardOsc52,
  formatMarkdownReport,
  formatPrMarkdown,
  openInspector,
  paint,
  SYM
} from '../ui.js';
import { maybeNotifyUpdate } from '../update.js';
import { verifyResult } from '../verify.js';
import { findWorkspaceSkills } from '../discovery.js';
import { probeLocalLlm } from '../local-llm.js';
import { generateCompletionScript, detectShell, type ShellType } from '../completion.js';
import { installGitHook, runPreCommitCheck } from '../hook.js';

// Commands that emit machine-readable output or run unattended — never interrupt
// these with the interactive "update available?" prompt.
const MACHINE_COMMANDS = new Set(['eval', 'm0', 'corpus', 'rot', 'verify', 'matrix', 'demo', 'completion', 'hook']);

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

  // Non-blocking micro-probe for running local LLMs (Ollama, LM Studio, vLLM)
  const localLlm = await probeLocalLlm(120);

  const modeOptions = [
    { key: '1', name: 'Skillcheck Cloud (Hosted)', value: 'hosted', blurb: 'recommended — free 10 checks' },
    { key: '2', name: 'Bring Your Own Key (BYOK)', value: 'byok', blurb: 'OpenAI, Anthropic, Gemini, Groq, Mistral, OpenRouter, NIM' }
  ];

  if (localLlm && localLlm.models.length > 0) {
    modeOptions.unshift({
      key: '0',
      name: `Local ${localLlm.name.toUpperCase()} (Detected on ${localLlm.baseUrl})`,
      value: 'local',
      blurb: `offline & free — ${localLlm.models.length} models installed`
    });
  }

  const mode = await selectMenuOption(
    'How do you want to connect to models?',
    'Hosted mode is free & ready in 30 seconds. Bring Your Own Key uses your provider key directly.',
    modeOptions
  );

  if (mode === 'local' && localLlm) {
    const modelOptions = localLlm.models.slice(0, 30).map((m, idx) => ({
      key: String(idx + 1),
      name: m,
      value: m
    }));

    const selectedModel =
      localLlm.suggestedModel ??
      (await selectMenuOption(
        `Select Local Model (${localLlm.name.toUpperCase()})`,
        'Choose which locally installed model to evaluate with',
        modelOptions
      ));

    const savedPath = saveUserConfig({
      ...current,
      provider: 'openai',
      providerKey: 'local',
      providerBaseUrl: localLlm.baseUrl,
      generatorModel: selectedModel,
      runnerModel: selectedModel,
      graderModel: selectedModel
    });

    console.log(`✓ You're all set with Local ${localLlm.name.toUpperCase()}! Model: ${singleLine(selectedModel)}`);
    console.log(`Config saved to ${singleLine(savedPath)}\n`);
    return;
  }

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

        console.log(`✓ You're all set with ${providerName}! Model: ${singleLine(selectedModel)}`);
        console.log(`Key saved to ${singleLine(savedPath)}\n`);
        return;
      }

      console.log('not accepted.');
      console.log(`✗ ${check.message ?? 'The key could not be verified or list models.'}\n`);
    }
  }
}

// Upper bounds keep a typo like `--tasks 300` from turning one metered run into
// hundreds of model calls. Generous enough for every documented workflow.
function readDifficultyOption(argv: string[]): TaskDifficulty | undefined {
  const value = readOption(argv, '--difficulty');
  if (value === undefined) {
    return undefined;
  }
  if (value !== 'standard' && value !== 'hard' && value !== 'adversarial') {
    throw new ValidationError(`--difficulty must be one of standard, hard, adversarial (got "${value}")`);
  }
  return value;
}

function parseCommonEvalOptions(
  argv: string[],
  defaultTasks: number,
  startIndex: number
): { evalOptions: Omit<EvalOptions, 'inputPath'>; inputPath?: string; inputIndex: number } {
  const { path: inputPath, index: inputIndex } = findInputArgument(argv, startIndex);
  return {
    inputPath,
    inputIndex,
    evalOptions: {
      output: readOption(argv, '--output'),
      tasks: readNumberOption(argv, '--tasks', defaultTasks, MAX_TASKS),
      tasksExplicit: argv.some((token) => token === '--tasks' || token.startsWith('--tasks=')),
      trials: readNumberOption(argv, '--trials', 3, MAX_TRIALS),
      concurrency: readNumberOption(argv, '--concurrency', 4, MAX_CONCURRENCY),
      mode: 'forced',
      runner: readOption(argv, '--runner'),
      grader: readOption(argv, '--grader'),
      generator: readOption(argv, '--generator'),
      taskSuite: readOption(argv, '--task-suite'),
      difficulty: readDifficultyOption(argv),
      domain: readOption(argv, '--domain'),
      explain: hasFlag(argv, '--explain'),
      maxBytes: readOptionalNumberOption(argv, '--max-file-bytes'),
      allowExternalSymlinks: hasFlag(argv, '--allow-external-symlinks')
    }
  };
}

export function parseEvalOptions(argv: string[], startIndex = 3): EvalOptions {
  const { inputPath, inputIndex, evalOptions } = parseCommonEvalOptions(argv, 10, startIndex);
  if (!inputPath) {
    throw new ValidationError('Usage: skillcheck eval <path> [--tasks N] [--trials K] [--concurrency C] [--output file.json] [--resume]');
  }
  assertKnownOptions(
    argv,
    startIndex,
    [...CHECK_VALUE_OPTIONS, '--mode'],
    ['--explain', '--resume', '--markdown', '--allow-external-symlinks'],
    inputIndex
  );

  const mode = readOption(argv, '--mode') ?? 'forced';
  if (mode !== 'forced') {
    throw new ValidationError('Only --mode forced is supported in v1');
  }

  readFailOn(argv);
  return {
    inputPath,
    ...evalOptions,
    resume: hasFlag(argv, '--resume')
  };
}

function readFailOn(argv: string[]): 'placebo' | 'harms' | undefined {
  const value = readOption(argv, '--fail-on');
  if (value === undefined || value === 'placebo' || value === 'harms') return value;
  throw new ValidationError('--fail-on must be placebo or harms.');
}

function enforceQuality(verdict: EvalResult['result']['verdict'], failOn?: 'placebo' | 'harms'): void {
  if (verdict === 'harms' || (verdict === 'placebo' && failOn === 'placebo')) process.exitCode = 3;
}

interface CheckOptions {
  evalOptions: EvalOptions;
  json: boolean;
  markdown: boolean;
  output?: string;
  clipboard?: boolean;
  inspect?: boolean;
  effortPinned: boolean;
  failOn?: 'placebo' | 'harms';
}

export function parseCheckOptions(argv: string[], startIndex = 3): CheckOptions {
  const { inputPath, inputIndex, evalOptions } = parseCommonEvalOptions(argv, 3, startIndex);
  if (!inputPath) {
    throw new ValidationError(
      'Usage: skillcheck check <path-to-skill-file-or-folder>\nExample: skillcheck check ./SKILL.md'
    );
  }

  assertKnownOptions(
    argv,
    startIndex,
    CHECK_VALUE_OPTIONS,
    ['--json', '--explain', '--clipboard', '--resume', '--inspect', '--markdown', '--allow-external-symlinks'],
    inputIndex
  );

  const json = hasFlag(argv, '--json');
  const markdown = hasFlag(argv, '--markdown');
  if (json && markdown) {
    throw new ValidationError('Cannot combine --markdown and --json. Choose one output format.');
  }

  return {
    evalOptions: {
      inputPath,
      ...evalOptions,
      resume: hasFlag(argv, '--resume'),
      saveArtifacts: Boolean(evalOptions.output)
    },
    json,
    markdown,
    failOn: readFailOn(argv),
    output: evalOptions.output,
    clipboard: hasFlag(argv, '--clipboard'),
    inspect: hasFlag(argv, '--inspect'),
    effortPinned: readOption(argv, '--tasks') !== undefined || readOption(argv, '--trials') !== undefined
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
    throw new ValidationError('Usage: skillcheck corpus run --corpus corpus.json [--results dir]');
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
  /** True when the user passed --models; false means the default list applies. */
  modelsPinned: boolean;
  tasks: number;
  trials: number;
  concurrency: number;
  json: boolean;
}

// Default matrix models use NIM/OpenRouter namespace ids; they only resolve on
// providers that serve many vendors' models under one key.
const DEFAULT_MATRIX_MODELS = ['openai/gpt-6-sol', 'anthropic/claude-opus-5.5', 'google/gemini-3.8-flash', 'openai/gpt-oss-120b'];
const MULTI_MODEL_PROVIDERS = new Set(['nvidia', 'cloud', 'openrouter']);

function parseMatrixOptions(argv: string[], startIndex = 3): MatrixOptions {
  const { path: inputPath, index: inputIndex } = findInputArgument(argv, startIndex);
  if (!inputPath) {
    throw new ValidationError('Usage: skillcheck matrix <path> [--models model1,model2] [--tasks N] [--trials K] [--concurrency C]');
  }
  assertKnownOptions(
    argv,
    startIndex,
    ['--models', '--tasks', '--trials', '--concurrency'],
    ['--json'],
    inputIndex
  );

  const rawModels = readOption(argv, '--models');
  const models = rawModels
    ? rawModels.split(',').map((m) => m.trim()).filter(Boolean)
    : DEFAULT_MATRIX_MODELS;

  return {
    inputPath,
    models,
    modelsPinned: rawModels !== undefined,
    tasks: readNumberOption(argv, '--tasks', 3, MAX_TASKS),
    trials: readNumberOption(argv, '--trials', 3, MAX_TRIALS),
    concurrency: readNumberOption(argv, '--concurrency', 4, MAX_CONCURRENCY),
    json: hasFlag(argv, '--json')
  };
}

interface MatrixEntry {
  model: string;
  verdict: string;
  score: number;
  effectPp: number;
}

async function runMatrix(options: MatrixOptions): Promise<{ matrix: MatrixEntry[] }> {
  await validateSkillInput(options.inputPath);
  await ensureCloudConfigured(false);

  if (!options.modelsPinned && !MULTI_MODEL_PROVIDERS.has(loadProviderConfig().provider)) {
    throw new Error(
      `The default matrix models use NIM-style ids that only resolve on multi-vendor providers (NIM, Cloud, OpenRouter). Pass --models with ids your active provider serves.`
    );
  }

  const results: MatrixEntry[] = [];

  for (const model of options.models) {
    const res = await evalSkill({
      inputPath: options.inputPath,
      tasks: options.tasks,
      trials: options.trials,
      concurrency: options.concurrency,
      mode: 'forced',
      runner: model
    });

    results.push({
      model,
      verdict: res.result.verdict,
      score: res.result.satisfaction,
      effectPp: res.result.effect_pp
    });
  }

  if (!options.json) {
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│                    SKILLCHECK MATRIX                        │');
    console.log('├──────────────────────────────────────┬──────────┬───────────┤');
    console.log('│ Model                                │ Verdict  │ Score     │');
    console.log('├──────────────────────────────────────┼──────────┼───────────┤');
    for (const r of results) {
      const m = singleLine(r.model).padEnd(36).slice(0, 36);
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

  const interactive = !options.json && !options.markdown && process.stdin.isTTY === true && process.stdout.isTTY === true;

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
  // line ("✓ Effort  Standard · 3 tasks × 3 trials") already states the run size.
  if (header === 'compact' && !options.json && !options.markdown && !pickedEffort) {
    printCheckHeader(options.evalOptions.inputPath, options.evalOptions.tasks, options.evalOptions.trials);
  }

  // The per-task breakdown reuses the outputs the run already produced (no extra
  // model calls), so for an interactive human run we always compute it and then
  // OFFER it after the card. `--explain` shows it straight away, unprompted.
  const explicitExplain = options.evalOptions.explain === true;
  options.evalOptions.explain = explicitExplain || interactive;

  const progress = options.json ? undefined : startProgress();
  let result: EvalResult;
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
  enforceQuality(result.result.verdict, options.failOn);
  if (options.json) {
    console.log(stringifySafe(result));
    return;
  }
  if (options.markdown) {
    console.log(formatMarkdownReport(result));
    return;
  }
  const safeResult = JSON.parse(stringifySafe(result)) as EvalResult;
  await printResultCard(safeResult, options.output);

  if (options.clipboard) {
    const prMd = formatPrMarkdown(safeResult);
    if (copyToClipboardOsc52(prMd)) {
      console.log(`\n  ${paint.ok(SYM.tick)} ${paint.bold('Copied GitHub PR review comment to clipboard')} ${paint.dim('(via OSC 52)')}\n`);
    }
  }

  if (options.inspect && interactive) {
    await openInspector(safeResult);
  }

  const breakdown = formatExplain(safeResult);
  if (!breakdown) {
    return;
  }
  if (explicitExplain) {
    console.log(breakdown);
    return;
  }
  if (interactive && !options.inspect) {
    const answer = (await promptText('Press [i] to inspect in Skillcheck Lens, [y] for breakdown, or [Enter] to finish: ')).trim().toLowerCase();
    if (answer === 'i' || answer === 'inspect') {
      await openInspector(safeResult);
    } else if (answer === 'y' || answer === 'yes') {
      console.log(breakdown);
    }
  }
}

async function runInteractiveCheck(): Promise<void> {
  await ensureCloudConfigured(false);

  let selectedPath: string;
  const workspaceSkills = await findWorkspaceSkills();
  if (workspaceSkills.length === 1 && process.stdin.isTTY) {
    const single = workspaceSkills[0]!;
    printBanner();
    console.log(`  ${paint.accent('◆')} ${paint.bold('Detected workspace skill:')} ${paint.ok(singleLine(single.relativePath))}\n`);
    const ans = (await promptText(`Check ${singleLine(single.relativePath)}? [Y/n/browse] `)).trim().toLowerCase();
    if (ans === '' || ans === 'y' || ans === 'yes') {
      selectedPath = single.path;
    } else {
      selectedPath = await selectSkillPath();
    }
  } else {
    selectedPath = await selectSkillPath();
  }

  const effort = await selectEffort();
  // Same defaults parseCheckOptions would produce for a direct `check <path>`;
  // built directly because there is no argv to parse in the interactive flow.
  const options: CheckOptions = {
    evalOptions: {
      inputPath: selectedPath,
      tasks: effort.tasks,
      trials: effort.trials,
      concurrency: 4,
      mode: 'forced',
      explain: false,
      saveArtifacts: false
    },
    json: false,
    markdown: false,
    effortPinned: true // already chosen above — don't let runCheck re-ask
  };
  await runCheck(options, 'none');
}

export async function runLegacy(argv: string[]): Promise<void> {
  const command = argv[2];

  // Offer an update when a newer version is on npm — but only for interactive,
  // human-facing invocations (skipped for --json and machine commands).
  if (!argv.includes('--json') && !MACHINE_COMMANDS.has(command ?? '')) {
    await maybeNotifyUpdate();
  }

  if (!command) {
    await runInteractiveCheck();
    return;
  }

  if (command === 'demo' || argv.includes('--demo')) {
    const { runDemo } = await import('../demo.js');
    await runDemo();
    return;
  }

  if (
    command === 'setup' ||
    command === '--setup' ||
    command === 'config' ||
    command === '--config' ||
    command === 'login' ||
    command === 'auth' ||
    command === 'init'
  ) {
    await ensureCloudConfigured(true);
    return;
  }

  if (command === 'logout' || command === 'signout' || command === 'deauth') {
    printLogout(logoutUser());
    return;
  }

  if (command === 'm0') {
    // The whole gate shares one run id: without it, the cloud proxy meters
    // every one of the ~192 model calls as a separate run and a free-tier
    // user burns their monthly quota on a single calibration gate.
    const { runM0Gate } = await import('../m0/run.js');
    const report = await runM0Gate((config) =>
      createLlmClient(config, { defaultHeaders: { 'x-skillcheck-run': randomUUID() } })
    );
    console.log(stringifySafe(report));
    process.exitCode = report.passed ? 0 : 1;
    return;
  }

  if (command === 'check' || command === 'c' || command === 'run' || command === 'test') {
    await runCheck(parseCheckOptions(argv, 3));
    return;
  }

  if (command === 'eval') {
    const evalOptions = parseEvalOptions(argv, 3);
    const result = await evalSkill(evalOptions);
    enforceQuality(result.result.verdict, readFailOn(argv));
    if (argv.includes('--markdown')) {
      console.log(formatMarkdownReport(result));
    } else {
      console.log(stringifySafe(result));
    }
    return;
  }

  if (command === 'verify') {
    const { path: resultPath, index: inputIndex } = findInputArgument(argv, 3);
    if (!resultPath) {
      throw new ValidationError('Usage: skillcheck verify <result.json> [--sample n]');
    }
    assertKnownOptions(argv, 3, ['--sample'], [], inputIndex);
    const result = await verifyResult({
      resultPath,
      sample: readNumberOption(argv, '--sample', 3, MAX_TASKS)
    });
    console.log(stringifySafe(result));
    return;
  }

  if (command === 'corpus') {
    const subcommand = argv[3];
    if (subcommand !== 'run') {
      throw new ValidationError('Usage: skillcheck corpus run --corpus corpus.json [--results dir]');
    }
    const { runCorpus } = await import('../corpus.js');
    const result = await runCorpus(parseCorpusRunOptions(argv));
    console.log(stringifySafe(result));
    return;
  }

  if (command === 'rot') {
    const { runRot } = await import('../rot.js');
    const result = await runRot(parseRotOptions(argv));
    console.log(stringifySafe(result));
    return;
  }

  if (command === 'matrix' || command === 'compare') {
    const options = parseMatrixOptions(argv, 3);
    const result = await runMatrix(options);
    if (options.json) {
      console.log(stringifySafe(result));
    }
    return;
  }

  if (command === 'watch') {
    const { path: inputPath, index: inputIndex } = findInputArgument(argv, 3);
    if (!inputPath) {
      throw new ValidationError('Usage: skillcheck watch <path-to-skill-file>\nExample: skillcheck watch ./SKILL.md');
    }
    assertKnownOptions(argv, 3, ['--tasks', '--trials'], [], inputIndex);
    const { runWatch } = await import('../watch.js');
    await runWatch({
      inputPath,
      tasks: readNumberOption(argv, '--tasks', 3, MAX_TASKS),
      trials: readNumberOption(argv, '--trials', 2, MAX_TRIALS)
    });
    return;
  }

  if (command === 'hook') {
    const subcommand = argv[3];
    if (subcommand === 'install') {
      const res = installGitHook();
      console.log(`\n  ${paint.ok(SYM.tick)} ${paint.bold('Git hook installed')} ${paint.dim(`at ${singleLine(res.path)}`)}`);
      console.log(`  ${paint.dim('Pre-commit will now automatically evaluate staged agent prompts and reject regressions.')}\n`);
      return;
    }
    if (subcommand === 'run') {
      const check = await runPreCommitCheck({ strict: hasFlag(argv, '--strict') });
      if (!check.passed) {
        console.error(`\n  ${paint.err(SYM.cross)} ${paint.bold('Pre-commit check failed')}\n  ${singleLine(check.message)}\n`);
        process.exitCode = 1;
        return;
      }
      console.log(`\n  ${paint.ok(SYM.tick)} ${singleLine(check.message)}\n`);
      return;
    }
    throw new ValidationError('Usage: skillcheck hook [install|run] [--strict]');
  }

  if (command === 'completion') {
    const rawShell = argv[3];
    const shell: ShellType =
      rawShell === 'bash' || rawShell === 'zsh' || rawShell === 'fish'
        ? rawShell
        : detectShell();
    process.stdout.write(generateCompletionScript(shell));
    return;
  }

  // Not an explicit subcommand: handle `skillcheck ./SKILL.md` or `skillcheck --explain ./SKILL.md`
  const { path: inputPath } = findInputArgument(argv, 2);
  if (inputPath) {
    if (existsSync(inputPath)) {
      await runCheck(parseCheckOptions(argv, 2));
      return;
    }
    const looksLikePath =
      inputPath.includes('/') || inputPath.includes('\\') || inputPath.startsWith('.') || /\.md$/i.test(inputPath);
    if (looksLikePath) {
      throw new ValidationError(`Path not found: ${inputPath}\nGive me a Markdown (.md) skill file, or a folder containing one.`);
    }
  }

  if (command.startsWith('-')) {
    await runCheck(parseCheckOptions(argv, 2));
    return;
  }

  const KNOWN_COMMANDS = ['check', 'demo', 'matrix', 'setup', 'logout', 'eval', 'verify', 'corpus', 'rot', 'help', 'version', ...Object.keys(commandUsage)];
  const suggestion = findClosestCommand(command, KNOWN_COMMANDS);
  const didYouMean = suggestion ? `\nDid you mean: \`skillcheck ${suggestion}\`?` : '';

  throw new ValidationError(`Unknown command: ${command}${didYouMean}\nRun \`skillcheck --help\` to see available commands.`);
}
