import { NvidiaNimClient } from './adapters/nvidia-nim.js';
import { evalSkill, type EvalOptions } from './eval.js';
import { runM0Gate } from './m0/run.js';
import { verifyResult } from './verify.js';

function printHelp(): void {
  console.log(`skillcheck

Usage:
  skillcheck m0
  skillcheck eval <path> [--tasks N] [--trials K] [--output file.json] [--task-suite file.json]
    [--runner model] [--grader model] [--generator model]
  skillcheck verify <result.json> [--sample n]

M0 is the hardcoded spike. eval is the M1 forced-injection evaluator.`);
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

function parseEvalOptions(argv: string[]): EvalOptions {
  const inputPath = argv[3];
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

export async function main(argv: string[]): Promise<void> {
  const command = argv[2];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'm0') {
    const report = await runM0Gate((config) => new NvidiaNimClient(config));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.passed ? 0 : 1;
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

  throw new Error(`Unknown command: ${command}`);
}
