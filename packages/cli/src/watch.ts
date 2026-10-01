import { watch as fsWatch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { evalSkill } from './eval.js';
import { printBanner, printCheckHeader, printResultCard, startProgress } from './ui.js';
import { SYM, paint } from './ui/theme.js';

export interface WatchOptions {
  inputPath: string;
  tasks?: number;
  trials?: number;
  debounceMs?: number;
}

export interface TokenDelta {
  previousTokens: number;
  currentTokens: number;
  difference: number;
  sign: '+' | '-' | '';
}

/**
 * Fast local heuristic estimating token count changes (~4 chars per token).
 */
export function calculateTokenDelta(prevContent: string, currentContent: string): TokenDelta {
  const prevTokens = Math.max(1, Math.round(prevContent.length / 4));
  const currTokens = Math.max(1, Math.round(currentContent.length / 4));
  const diff = currTokens - prevTokens;
  return {
    previousTokens: prevTokens,
    currentTokens: currTokens,
    difference: diff,
    sign: diff > 0 ? '+' : diff < 0 ? '-' : ''
  };
}

/**
 * Creates a debounced function to absorb rapid file-system burst events.
 */
export function createDebouncedWatcher(action: () => void | Promise<void>, delayMs = 300): () => void {
  let timer: NodeJS.Timeout | undefined;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void action();
    }, delayMs);
  };
}

/**
 * Cascading watch mode: watches a skill file and re-evaluates automatically on save.
 */
export async function runWatch(options: WatchOptions): Promise<void> {
  const fullPath = path.resolve(options.inputPath);
  const tasks = options.tasks ?? 3;
  const trials = options.trials ?? 2;
  const debounceMs = options.debounceMs ?? 400;

  let lastContent = '';
  try {
    lastContent = await readFile(fullPath, 'utf8');
  } catch {
    lastContent = '';
  }

  printBanner();
  console.log(`  ${paint.accent('◆')} ${paint.bold('Skillcheck Watch Mode')} ${paint.dim(`(monitoring ${path.basename(fullPath)})`)}`);
  console.log(`  ${paint.dim(`Press ${paint.bold('r')} to re-run manually ${SYM.dot} Press ${paint.bold('q')} or ${paint.bold('Ctrl+C')} to exit`)}\n`);

  let running = false;
  const executeEval = async (reason = 'Initial run'): Promise<void> => {
    if (running) return;
    running = true;

    try {
      console.log(`\n  ${paint.accent(SYM.pointer)} ${paint.bold(reason)} · ${tasks} tasks × ${trials} trials`);
      const progress = startProgress();
      const result = await evalSkill({
        inputPath: fullPath,
        tasks,
        trials,
        mode: 'forced',
        concurrency: 4,
        saveArtifacts: false,
        onProgress: progress ? (event) => progress.update(event) : undefined
      });
      progress?.finish();
      await printResultCard(result);
    } catch (err) {
      console.error(`  ${paint.err(SYM.cross)} ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
      console.log(`\n  ${paint.dim(`Watching for changes in ${path.basename(fullPath)}...`)}`);
    }
  };

  // Run initial evaluation
  await executeEval('Initial evaluation');

  const onFileChange = createDebouncedWatcher(async () => {
    let newContent = '';
    try {
      newContent = await readFile(fullPath, 'utf8');
    } catch {
      return;
    }

    if (newContent === lastContent) return;

    const delta = calculateTokenDelta(lastContent, newContent);
    lastContent = newContent;

    const deltaStr = `${delta.sign}${Math.abs(delta.difference)} tokens (~${delta.currentTokens} total)`;
    const deltaColored = delta.difference > 0 ? paint.warn(deltaStr) : delta.difference < 0 ? paint.ok(deltaStr) : paint.dim(deltaStr);

    console.log(`\n  ${paint.accent('⚡')} File saved: ${paint.bold(path.basename(fullPath))} ${paint.dim('· Token delta:')} ${deltaColored}`);
    await executeEval('Re-evaluating changes');
  }, debounceMs);

  const watcher = fsWatch(fullPath, () => {
    onFileChange();
  });

  const cleanup = () => {
    watcher.close();
    process.exit(0);
  };

  process.once('SIGINT', cleanup);
}
