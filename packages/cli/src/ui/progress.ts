import process from 'node:process';
import { SPINNER_FRAMES, SYM, epaint } from '../theme.js';
import type { ProgressPhase, ProgressUpdate } from '../types.js';

const ACTIVE_PHASE_LABELS: Record<ProgressPhase, string> = {
  generating: 'Generating evaluation tasks',
  running: 'Running trials',
  grading: 'Grading outputs',
  scoring: 'Scoring results'
};

const DONE_PHASE_LABELS: Record<ProgressPhase, string> = {
  generating: 'Evaluation tasks ready',
  running: 'Trials complete',
  grading: 'Grading complete',
  scoring: 'Results scored'
};

export function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
}

function progressBar(completed: number, total: number, width = 16): string {
  const ratio = total > 0 ? completed / total : 0;
  const filled = Math.max(0, Math.min(width, Math.floor(ratio * width)));
  return `${epaint.accent(SYM.barOn.repeat(filled))}${epaint.dim(SYM.barOff.repeat(width - filled))}`;
}

export interface ProgressController {
  update: (event: ProgressUpdate) => void;
  finish: () => void;
  fail: () => void;
}

export function startProgress(): ProgressController {
  const stream = process.stderr;
  const startedAt = Date.now();
  let phaseStartedAt = startedAt;
  let current: ProgressUpdate = { phase: 'generating' };
  let settled = false;

  const doneLine = (update: ProgressUpdate, duration: number): string => {
    const count =
      typeof update.total === 'number' && update.total > 0 && (update.phase === 'running' || update.phase === 'grading')
        ? ` (${update.total}/${update.total})`
        : '';
    return `${epaint.ok(SYM.tick)} ${DONE_PHASE_LABELS[update.phase]}${epaint.dim(`${count} ${SYM.dot} ${formatElapsed(duration)}`)}`;
  };

  if (!stream.isTTY) {
    let lastPhase: ProgressPhase | undefined;
    return {
      update: (event) => {
        if (event.phase !== lastPhase) {
          lastPhase = event.phase;
          stream.write(`${SYM.dot} ${ACTIVE_PHASE_LABELS[event.phase]}\n`);
        }
      },
      finish: () => {
        stream.write(`${SYM.tick} Analysis complete ${SYM.dot} ${formatElapsed(Date.now() - startedAt)}\n`);
      },
      fail: () => undefined
    };
  }

  let frame = 0;
  const render = () => {
    const spinner = epaint.accent(SPINNER_FRAMES[frame % SPINNER_FRAMES.length]!);
    const label = epaint.bold(ACTIVE_PHASE_LABELS[current.phase]);
    const counted = typeof current.completed === 'number' && typeof current.total === 'number' && current.total > 0;
    const pct = counted ? Math.floor((current.completed! / current.total!) * 100) : 0;
    const bar = counted
      ? ` ${progressBar(current.completed!, current.total!)} ${epaint.dim(`${current.completed}/${current.total} (${pct}%)`)}`
      : '';
    const elapsed = epaint.dim(` ${SYM.dot} ${formatElapsed(Date.now() - startedAt)}`);
    stream.write(`\r\x1b[2K${spinner} ${label}${bar}${elapsed}`);
  };

  const timer = setInterval(() => {
    frame += 1;
    render();
  }, 80);

  const onInterrupt = () => {
    clearInterval(timer);
    stream.write('\r\x1b[2K\x1b[?25h');
    process.exit(130);
  };
  process.once('SIGINT', onInterrupt);
  const cleanup = () => {
    if (settled) {
      return;
    }
    settled = true;
    clearInterval(timer);
    process.removeListener('SIGINT', onInterrupt);
  };

  stream.write('\x1b[?25l');
  render();

  return {
    update: (event: ProgressUpdate) => {
      if (event.phase !== current.phase) {
        const now = Date.now();
        if (current.phase !== 'scoring') {
          stream.write(`\r\x1b[2K${doneLine(current, now - phaseStartedAt)}\n`);
        }
        phaseStartedAt = now;
      }
      current = event;
      render();
    },
    finish: () => {
      cleanup();
      stream.write(`\r\x1b[2K${epaint.ok(SYM.tick)} ${epaint.bold('Analysis complete')} ${epaint.dim(`${SYM.dot} ${formatElapsed(Date.now() - startedAt)}`)}\n\x1b[?25h`);
    },
    fail: () => {
      cleanup();
      stream.write(
        `\r\x1b[2K${epaint.err(SYM.cross)} ${epaint.dim(`Stopped while ${ACTIVE_PHASE_LABELS[current.phase].toLowerCase()} ${SYM.dot} ${formatElapsed(Date.now() - startedAt)}`)}\n\x1b[?25h`
      );
    }
  };
}
