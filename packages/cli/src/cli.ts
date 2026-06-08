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
  printHelpUi,
  printBanner,
  printSetupIntro,
  printKeyChecking,
  printKeyVerified,
  printKeyRejected,
  printKeyUnreachable,
  printKeyPromptHint,
  printLogout,
  promptText,
  selectSkillPath,
  selectEffort,
  startProgress,
  validateSkillInput
} from './ui.js';
import { verifyResult } from './verify.js';

function printHelp(): void {
  printHelpUi();
}

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
    const keyInput = await promptText('Paste your Skillcheck API key: ');
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

function readNumberOption(argv: string[], name: string, fallback: number): number {
  const value = readOption(argv, name);
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
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

function parseEvalOptions(argv: string[], inputIndex = 3): EvalOptions {
  const inputPath = argv[inputIndex];
  if (!inputPath || inputPath.startsWith('--')) {
    throw new Error('Usage: skillcheck eval <path> [--tasks N] [--trials K] [--output file.json]');
  }

  const mode = readOption(argv, '--mode') ?? 'forced';
  if (mode !== 'forced') {
    throw new Error('Only --mode forced is supported in v1');
  }

  return {
    inputPath,
    output: readOption(argv, '--output'),
    tasks: readNumberOption(argv, '--tasks', 10),
    trials: readNumberOption(argv, '--trials', 3),
    mode,
    runner: readOption(argv, '--runner'),
    grader: readOption(argv, '--grader'),
    generator: readOption(argv, '--generator'),
    taskSuite: readOption(argv, '--task-suite')
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

  const output = readOption(argv, '--output');
  return {
    evalOptions: {
      inputPath,
      output,
      tasks: readNumberOption(argv, '--tasks', 3),
      trials: readNumberOption(argv, '--trials', 2),
      mode: 'forced',
      runner: readOption(argv, '--runner'),
      grader: readOption(argv, '--grader'),
      generator: readOption(argv, '--generator'),
      taskSuite: readOption(argv, '--task-suite'),
      saveArtifacts: Boolean(output)
    },
    json: hasFlag(argv, '--json'),
    output
  };
}

function parseRotOptions(argv: string[]): RotOptions {
  return {
    resultsDir: readOption(argv, '--results') ?? 'results',
    output: readOption(argv, '--output') ?? 'results/rot/report.json',
    model: readOption(argv, '--model'),
    corpus: readOption(argv, '--corpus'),
    tasks: readNumberOption(argv, '--tasks', 10),
    trials: readNumberOption(argv, '--trials', 3)
  };
}

function parseCorpusRunOptions(argv: string[]): CorpusRunOptions {
  const corpus = readOption(argv, '--corpus');
  if (!corpus) {
    throw new Error('Usage: skillcheck corpus run --corpus corpus.json [--results dir]');
  }

  return {
    corpus,
    outputDir: readOption(argv, '--results') ?? 'results/corpus',
    tasks: readNumberOption(argv, '--tasks', 10),
    trials: readNumberOption(argv, '--trials', 3),
    concurrency: readNumberOption(argv, '--concurrency', 2),
    runner: readOption(argv, '--runner'),
    limit: readOptionalNumberOption(argv, '--limit')
  };
}

async function runCheck(options: CheckOptions, showBanner = true): Promise<void> {
  if (showBanner && !options.json) {
    printBanner();
  }
  await validateSkillInput(options.evalOptions.inputPath);
  await ensureCloudConfigured(false);
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
}

async function runInteractiveCheck(): Promise<void> {
  await ensureCloudConfigured(false);
  const selectedPath = await selectSkillPath();
  const effort = await selectEffort();
  const options = parseCheckOptions(['node', 'skillcheck', 'check', selectedPath]);
  options.evalOptions.tasks = effort.tasks;
  options.evalOptions.trials = effort.trials;
  await runCheck(options, false);
}

export async function main(argv: string[]): Promise<void> {
  const command = argv[2];

  if (command === '--help' || command === '-h') {
    printHelp();
    return;
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
    const result = await verifyResult({
      resultPath,
      sample: readNumberOption(argv, '--sample', 3)
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

  throw new Error(`Unknown command: ${command}`);
}
