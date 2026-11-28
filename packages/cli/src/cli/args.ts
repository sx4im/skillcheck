import { ValidationError } from '../errors.js';

export const MAX_TASKS = 50;
export const MAX_TRIALS = 10;
export const MAX_CONCURRENCY = 8;

// Options shared by `check` and `eval`; one list for the path-detector and the
// unknown-option guard.
export const CHECK_VALUE_OPTIONS = ['--tasks', '--trials', '--concurrency', '--output', '--runner', '--grader', '--generator', '--task-suite', '--difficulty', '--domain', '--max-file-bytes', '--fail-on'];

const VALUE_OPTIONS = new Set([...CHECK_VALUE_OPTIONS, '--mode', '--models', '--results', '--corpus', '--sample', '--limit', '--with', '--against', '--queries', '--format']);

export function findInputArgument(argv: string[], startIndex = 2): { path: string | undefined; index: number } {
  for (let i = startIndex; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (token.startsWith('-')) {
      if (VALUE_OPTIONS.has(token)) {
        i += 1; // skip this option's value
      }
      continue;
    }
    return { path: token, index: i };
  }
  return { path: undefined, index: -1 };
}

export function readOption(argv: string[], name: string): string | undefined {
  const index = argv.findIndex((token) => token === name || token.startsWith(`${name}=`));
  if (index === -1) {
    return undefined;
  }
  const token = argv[index]!;
  const value = token === name ? argv[index + 1] : token.slice(name.length + 1);
  if (!value || value.startsWith('--')) {
    throw new ValidationError(`Missing value for ${name}`);
  }
  return value;
}

export function readNumberOption(argv: string[], name: string, fallback: number, max?: number): number {
  const value = readOption(argv, name);
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${name} must be a positive integer`);
  }
  if (max !== undefined && parsed > max) {
    throw new ValidationError(`${name} must be at most ${max}`);
  }
  return parsed;
}

export function readOptionalNumberOption(argv: string[], name: string): number | undefined {
  const value = readOption(argv, name);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${name} must be a positive integer`);
  }
  return parsed;
}

export function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

// Reject mistyped options (e.g. --task instead of --tasks) instead of silently
// ignoring them and running with defaults the user did not ask for.
export function assertKnownOptions(
  argv: string[],
  firstIndex: number,
  valueOptions: string[],
  flags: string[] = [],
  skipIndex = -1
): void {
  for (let i = Math.max(firstIndex, 0); i < argv.length; i += 1) {
    if (i === skipIndex) {
      continue;
    }
    const token = argv[i]!;
    if (!token.startsWith('--')) throw new ValidationError('Unexpected argument: ' + token);
    if (flags.includes(token)) {
      continue;
    }
    const equalsIndex = token.indexOf('=');
    const name = equalsIndex === -1 ? token : token.slice(0, equalsIndex);
    if (!valueOptions.includes(name)) {
      throw new ValidationError(`Unknown option ${token}. Valid options: ${[...valueOptions, ...flags].join(', ')}`);
    }
    if (equalsIndex === -1) {
      if (!argv[i + 1] || argv[i + 1]!.startsWith('--')) throw new ValidationError('Missing value for ' + name);
      i += 1;
    } else if (!token.slice(equalsIndex + 1) || token.slice(equalsIndex + 1).startsWith('--')) {
      throw new ValidationError('Missing value for ' + name);
    }
  }
}
