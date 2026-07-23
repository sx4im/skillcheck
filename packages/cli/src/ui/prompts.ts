import process from 'node:process';
import readline from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { cloudPricingUrl } from '../config.js';
import { SYM, padDisplay, paint } from '../theme.js';
import { CancelledError, readKey } from './picker.js';

export async function promptText(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export async function promptSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return promptText(question);
  }

  return new Promise<string>((resolve, reject) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw === true;
    stdin.resume();
    stdin.setRawMode(true);
    let value = '';

    const render = () => {
      const masked = '•'.repeat(Math.min(value.length, 48));
      process.stdout.write(`\r\x1b[2K${question}${paint.dim(masked)}`);
    };

    const settle = (error?: Error) => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      process.stdout.write('\n');
      if (error) {
        reject(error);
      } else {
        resolve(value.trim());
      }
    };

    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') {
          settle(new CancelledError('Setup cancelled.'));
          return;
        }
        if (char === '\r' || char === '\n') {
          settle();
          return;
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        if (char >= ' ') {
          value += char;
        }
      }
      render();
    };

    render();
    stdin.on('data', onData);
  });
}

export function printSetupIntro(webUrl: string): void {
  console.log(`${paint.accent(SYM.diamond)} ${paint.bold('Connect your free account')} ${paint.dim('(about 30 seconds)')}\n`);
  console.log(`  ${paint.bold('1.')} Open this page in your web browser:`);
  console.log(`     ${paint.accent(webUrl)}`);
  console.log(`  ${paint.bold('2.')} Sign in with Google or GitHub ${paint.dim('— free, includes 10 checks')}`);
  console.log(`  ${paint.bold('3.')} Copy your key ${paint.dim('(it starts with')} ${paint.ok('chk_live_')}${paint.dim(')')}`);
  console.log(`  ${paint.bold('4.')} Paste it below — input stays hidden.\n`);
}

export function printKeyChecking(): void {
  process.stdout.write(`${paint.dim('Verifying your key…')} `);
}

export function printKeyVerified(info: { plan?: string; runsUsed?: number; runsLimit?: number | null }, savedPath: string): void {
  const plan = info.plan === 'pro' ? 'Pro' : 'Free';
  const limited = !(info.runsLimit === null || info.runsLimit === undefined);
  const left = limited ? Math.max(0, (info.runsLimit as number) - (info.runsUsed ?? 0)) : null;
  let usage = '';
  if (!limited && info.plan === 'pro') {
    usage = ` ${SYM.dot} unlimited runs`;
  } else if (left !== null) {
    usage = ` ${SYM.dot} ${left} of ${info.runsLimit} runs left`;
  }
  console.log(paint.ok('verified.'));
  console.log(`${paint.ok(SYM.tick)} ${paint.bold("You're all set!")} ${paint.dim(`${plan} plan${usage}`)}`);
  console.log(`${paint.dim('Key saved to')} ${savedPath}`);
  if (left !== null && left <= 0) {
    console.log('');
  } else if (left !== null && left <= 2) {
    console.log(`${paint.warn(`Only ${left} free run${left === 1 ? '' : 's'} left.`)} ${paint.dim('Get more at')} ${paint.bold(cloudPricingUrl())}`);
  }
  console.log('');
}

export function printKeyRejected(message: string, webUrl: string): void {
  console.log(paint.err('not accepted.'));
  console.log(`${paint.err(SYM.cross)} ${message}`);
  console.log(`${paint.dim('Get a fresh key at')} ${paint.bold(webUrl)}\n`);
}

export function printKeyUnreachable(message: string): void {
  console.log(paint.warn('could not reach Skillcheck Cloud.'));
  console.log(`${paint.dim(message)}`);
  console.log(`${paint.dim('Check your connection and try again, or press Ctrl+C to cancel.')}\n`);
}

export function printKeyPromptHint(webUrl: string): void {
  console.log(`${paint.dim('Paste the key from')} ${paint.bold(webUrl)}\n`);
}

interface EffortLevel {
  key: string;
  name: string;
  tasks: number;
  trials: number;
  blurb: string;
}

const BASE_SECONDS = 120;
const SECONDS_PER_CALL = 4.8;

function callsFor(tasks: number, trials: number): number {
  return 1 + tasks * trials * 4;
}

export function estimateLabel(tasks: number, trials: number): string {
  const seconds = BASE_SECONDS + callsFor(tasks, trials) * SECONDS_PER_CALL;
  if (seconds < 60) {
    return `~${Math.max(15, Math.round(seconds / 10) * 10)} sec`;
  }
  const minutes = seconds / 60;
  const low = Math.max(1, Math.floor(minutes));
  const high = Math.max(low, Math.ceil(minutes));
  return low === high ? `~${low} min` : `~${low}–${high} min`;
}

const EFFORT_LEVELS: EffortLevel[] = [
  { key: '1', name: 'Quick', tasks: 2, trials: 1, blurb: 'exploratory — single trial, not launch-quality' },
  { key: '2', name: 'Standard', tasks: 3, trials: 3, blurb: 'recommended' },
  { key: '3', name: 'Thorough', tasks: 5, trials: 3, blurb: 'most confident verdict' }
];

export interface EffortChoice {
  tasks: number;
  trials: number;
  label: string;
  estimate: string;
}

function effortChoice(level: EffortLevel): EffortChoice {
  return { tasks: level.tasks, trials: level.trials, label: level.name, estimate: estimateLabel(level.tasks, level.trials) };
}

function effortMenuLines(selected: number, eyebrow: string): string[] {
  const lines: string[] = [];
  lines.push(`  ${paint.accent(eyebrow)}  ${paint.bold('How thorough should this check be?')}`);
  lines.push(`  ${paint.dim('More tasks mean a more confident verdict — and a little more time.')}`);
  lines.push('');
  for (const [index, level] of EFFORT_LEVELS.entries()) {
    const active = index === selected;
    const pointer = active ? paint.accent(SYM.pointer) : ' ';
    const name = active ? paint.bold(level.name.padEnd(9)) : paint.dim(level.name.padEnd(9));
    const scope = `${level.tasks} tasks × ${level.trials} trial${level.trials > 1 ? 's' : ''}`;
    const estimate = paint.accent(`[${estimateLabel(level.tasks, level.trials)}]`);
    const blurb = active ? paint.dim(`  ${level.blurb}`) : '';
    lines.push(`  ${pointer} ${name} ${paint.dim(scope.padEnd(19))}${estimate}${blurb}`);
  }
  lines.push('');
  lines.push(`  ${paint.dim(`↑/↓ choose ${SYM.dot} Enter run ${SYM.dot} 1–3 jump`)}`);
  return lines;
}

export async function selectEffort(eyebrow = 'Step 2 of 2'): Promise<EffortChoice> {
  const defaultIndex = 1;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return effortChoice(EFFORT_LEVELS[defaultIndex]!);
  }

  readline.emitKeypressEvents(process.stdin);
  const wasRaw = process.stdin.isRaw === true;
  process.stdin.resume();
  process.stdin.setRawMode(true);
  process.stdout.write('\x1b[?25l');

  let selected = defaultIndex;
  let painted = false;
  const draw = () => {
    const lines = effortMenuLines(selected, eyebrow);
    if (painted) {
      process.stdout.write(`\x1b[${lines.length}A`);
    }
    process.stdout.write(lines.map((line) => `\x1b[2K${line}`).join('\n') + '\n');
    painted = true;
  };

  try {
    draw();
    for (;;) {
      const { input, key } = await readKey();
      if (key.ctrl && key.name === 'c') {
        throw new CancelledError('Selection cancelled.');
      }
      if (key.name === 'up' || input === 'k') {
        selected = selected <= 0 ? EFFORT_LEVELS.length - 1 : selected - 1;
        draw();
        continue;
      }
      if (key.name === 'down' || input === 'j') {
        selected = selected >= EFFORT_LEVELS.length - 1 ? 0 : selected + 1;
        draw();
        continue;
      }
      const jump = EFFORT_LEVELS.findIndex((level) => level.key === input);
      if (jump !== -1) {
        selected = jump;
        break;
      }
      if (key.name === 'return') {
        break;
      }
    }
  } finally {
    process.stdin.setRawMode(wasRaw);
    process.stdin.pause();
    process.stdout.write('\x1b[?25h');
  }

  const chosen = EFFORT_LEVELS[selected]!;
  const choice = effortChoice(chosen);
  process.stdout.write(`\x1b[${effortMenuLines(selected, eyebrow).length}A\x1b[0J`);
  const scope = `${chosen.tasks} tasks × ${chosen.trials} trial${chosen.trials > 1 ? 's' : ''}`;
  console.log(`  ${paint.ok(SYM.tick)} ${paint.bold('Effort')}      ${chosen.name} ${paint.dim(`${SYM.dot} ${scope}`)} ${paint.accent(`[${choice.estimate}]`)}\n`);
  return choice;
}

export interface MenuOption<T = string> {
  key: string;
  name: string;
  value: T;
  blurb?: string;
}

export async function selectMenuOption<T = string>(
  title: string,
  subtitle: string,
  options: MenuOption<T>[]
): Promise<T> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return options[0]!.value;
  }

  readline.emitKeypressEvents(process.stdin);
  const wasRaw = process.stdin.isRaw === true;
  process.stdin.resume();
  process.stdin.setRawMode(true);
  process.stdout.write('\x1b[?25l');

  let selected = 0;
  let painted = false;

  const renderLines = (): string[] => {
    const lines: string[] = [];
    lines.push(`  ${paint.accent(SYM.diamond)} ${paint.bold(title)}`);
    if (subtitle) {
      lines.push(`  ${paint.dim(subtitle)}`);
    }
    lines.push('');

    const maxLines = 12;
    const offset = Math.max(0, Math.min(selected - Math.floor(maxLines / 2), Math.max(0, options.length - maxLines)));
    const visible = options.slice(offset, offset + maxLines);

    if (offset > 0) {
      lines.push(`    ${paint.dim(`↑ ${offset} more`)}`);
    }

    for (const [index, option] of visible.entries()) {
      const realIndex = offset + index;
      const active = realIndex === selected;
      const pointer = active ? paint.accent(SYM.pointer) : ' ';
      const name = active ? paint.bold(option.name) : paint.dim(option.name);
      const blurb = option.blurb ? ` ${paint.dim(`(${option.blurb})`)}` : '';
      lines.push(`  ${pointer} ${padDisplay(name, 28)}${blurb}`);
    }

    const below = options.length - (offset + visible.length);
    if (below > 0) {
      lines.push(`    ${paint.dim(`↓ ${below} more`)}`);
    }

    lines.push('');
    lines.push(`  ${paint.dim(`↑/↓ choose ${SYM.dot} Enter confirm ${SYM.dot} q cancel`)}`);
    return lines;
  };

  const draw = () => {
    const lines = renderLines();
    if (painted) {
      process.stdout.write(`\x1b[${lines.length}A`);
    }
    process.stdout.write(lines.map((line) => `\x1b[2K${line}`).join('\n') + '\n');
    painted = true;
  };

  try {
    draw();
    for (;;) {
      const { input, key } = await readKey();
      if ((key.ctrl && key.name === 'c') || input === 'q') {
        throw new CancelledError('Selection cancelled.');
      }
      if (key.name === 'up' || input === 'k') {
        selected = selected <= 0 ? options.length - 1 : selected - 1;
        draw();
        continue;
      }
      if (key.name === 'down' || input === 'j') {
        selected = selected >= options.length - 1 ? 0 : selected + 1;
        draw();
        continue;
      }
      if (key.name === 'return') {
        break;
      }
    }
  } finally {
    process.stdin.setRawMode(wasRaw);
    process.stdin.pause();
    process.stdout.write('\x1b[?25h');
  }

  const lines = renderLines();
  process.stdout.write(`\x1b[${lines.length}A\x1b[0J`);
  const chosen = options[selected]!;
  console.log(`  ${paint.ok(SYM.tick)} ${paint.bold(title)}  ${chosen.name}\n`);
  return chosen.value;
}
