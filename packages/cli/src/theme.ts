import process from 'node:process';

// Skillcheck's terminal design system. Zero dependencies: colour capability
// detection, semantic paints, the brand gradient, ANSI-aware width math and
// box-drawing primitives. Everything UI-facing should style itself through
// this module so the whole CLI shares one visual language.

export type Paint = (text: string) => string;

export interface ColorStream {
  isTTY?: boolean;
}

// 0 = no colour, 1 = 16-colour ANSI, 2 = 256-colour, 3 = truecolor.
export type ColorLevel = 0 | 1 | 2 | 3;

function envLevel(): ColorLevel {
  const term = process.env.TERM ?? '';
  const colorterm = process.env.COLORTERM ?? '';
  if (/truecolor|24bit/i.test(colorterm) || /direct/i.test(term)) {
    return 3;
  }
  if (/256color/i.test(term)) {
    return 2;
  }
  return 1;
}

// Resolved lazily on every paint so tests (and long-lived processes) see env
// changes immediately. NO_COLOR follows the spec at no-color.org: any
// non-empty value disables colour, regardless of what the value is.
export function colorLevel(stream: ColorStream = process.stdout): ColorLevel {
  const noColor = process.env.NO_COLOR;
  if (noColor !== undefined && noColor !== '') {
    return 0;
  }

  const force = process.env.FORCE_COLOR;
  if (force !== undefined && force !== '') {
    if (force === '0' || force === 'false') {
      return 0;
    }
    if (force === '2') return 2;
    if (force === '3') return 3;
    return envLevel();
  }

  if (!stream.isTTY || process.env.TERM === 'dumb') {
    return 0;
  }
  return envLevel();
}

const wrap = (open: string, text: string): string => `\x1b[${open}m${text}\x1b[0m`;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

// Brand blues. Truecolor terminals get the exact shades; 256-colour terminals
// get the nearest xterm cube entry; 16-colour terminals get plain ANSI blue/cyan.
const ACCENT: Rgb = { r: 59, g: 130, b: 246 };

function fg(rgb: Rgb, fallback256: number, fallbackBasic: string, level: ColorLevel, text: string): string {
  if (level >= 3) return wrap(`38;2;${rgb.r};${rgb.g};${rgb.b}`, text);
  if (level === 2) return wrap(`38;5;${fallback256}`, text);
  return wrap(fallbackBasic, text);
}

// The semantic palette, bound to one stream. UI code paints stdout content
// with `paint` and stderr content (progress, errors) with `epaint`, so each
// stream honours its own TTY-ness independently.
export interface Palette {
  accent: Paint;
  bold: Paint;
  dim: Paint;
  ok: Paint;
  warn: Paint;
  err: Paint;
  /** Brand-coloured fill for one banner row, t ∈ [0, 1] from top to bottom. */
  brand: (t: number) => Paint;
  /** Inverse-video badge, e.g. ` HELPS ` on a green block. */
  badge: (text: string, kind: 'ok' | 'warn' | 'err' | 'neutral') => string;
}

// Banner gradient stops, top to bottom: cyan-400 → blue-500 → indigo-500.
const GRADIENT: Rgb[] = [
  { r: 34, g: 211, b: 238 },
  { r: 59, g: 130, b: 246 },
  { r: 99, g: 102, b: 241 }
];
const GRADIENT_256 = [51, 45, 39, 33, 33, 63];

function lerpGradient(t: number): Rgb {
  const clamped = Math.max(0, Math.min(1, t));
  const span = (GRADIENT.length - 1) * clamped;
  const index = Math.min(GRADIENT.length - 2, Math.floor(span));
  const local = span - index;
  const a = GRADIENT[index]!;
  const b = GRADIENT[index + 1]!;
  return {
    r: Math.round(a.r + (b.r - a.r) * local),
    g: Math.round(a.g + (b.g - a.g) * local),
    b: Math.round(a.b + (b.b - a.b) * local)
  };
}

const BADGE_CODES: Record<'ok' | 'warn' | 'err' | 'neutral', string> = {
  ok: '1;97;42',
  warn: '1;30;43',
  err: '1;97;41',
  neutral: '1;30;47'
};

export function makePalette(stream: ColorStream): Palette {
  const level = () => colorLevel(stream);
  const painted = (code: string): Paint => (text) => (level() > 0 ? wrap(code, text) : text);

  return {
    accent: (text) => {
      const current = level();
      return current > 0 ? fg(ACCENT, 33, '34', current, text) : text;
    },
    bold: painted('1;97'),
    dim: painted('2'),
    ok: painted('1;32'),
    warn: painted('1;33'),
    err: painted('1;31'),
    brand: (t) => (text) => {
      const current = level();
      if (current === 0) return text;
      if (current >= 3) {
        const rgb = lerpGradient(t);
        return wrap(`38;2;${rgb.r};${rgb.g};${rgb.b}`, text);
      }
      if (current === 2) {
        const index = Math.min(GRADIENT_256.length - 1, Math.max(0, Math.round(t * (GRADIENT_256.length - 1))));
        return wrap(`38;5;${GRADIENT_256[index]!}`, text);
      }
      return wrap('1;36', text);
    },
    badge: (text, kind) => {
      if (level() === 0) {
        return text;
      }
      return wrap(BADGE_CODES[kind], ` ${text} `);
    }
  };
}

/** Palette for stdout — results, cards, menus. */
export const paint = makePalette(process.stdout);
/** Palette for stderr — progress and error reporting. */
export const epaint = makePalette(process.stderr);

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;?]*[A-Za-z]/g;
// eslint-disable-next-line no-control-regex
const ANSI_START = /^\x1b\[[0-9;?]*[A-Za-z]/;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

/** Printed width of a string once escape codes are removed. */
export function visibleWidth(text: string): number {
  return Array.from(stripAnsi(text)).length;
}

/** Right-pad to a display width, counting only visible characters. */
export function padDisplay(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - visibleWidth(text)));
}

// Truncate to a display width, preserving escape codes and closing with a
// reset so a cut never bleeds colour into the next line.
export function truncateDisplay(text: string, width: number): string {
  if (visibleWidth(text) <= width) {
    return text;
  }
  let out = '';
  let used = 0;
  let rest = text;
  while (rest.length > 0 && used < width - 1) {
    const match = ANSI_START.exec(rest);
    if (match) {
      out += match[0];
      rest = rest.slice(match[0].length);
      continue;
    }
    const char = Array.from(rest)[0]!;
    out += char;
    used += 1;
    rest = rest.slice(char.length);
  }
  return `${out}…\x1b[0m`;
}

/** Greedy word wrap for plain (unpainted) text. */
export function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [''];
  }
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line === '') {
      line = word;
    } else if (visibleWidth(line) + 1 + visibleWidth(word) <= width) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

export const BOX = {
  tl: '╭',
  tr: '╮',
  bl: '╰',
  br: '╯',
  h: '─',
  v: '│',
  ml: '├',
  mr: '┤'
} as const;

export const SYM = {
  tick: '✓',
  cross: '✗',
  pointer: '❯',
  diamond: '◆',
  dot: '·',
  arrow: '→',
  barOn: '▰',
  barOff: '▱',
  blockOn: '█',
  blockOff: '░'
} as const;

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

/** Width the UI should lay out against: terminal width, clamped to sane bounds. */
export function layoutWidth(stream: { columns?: number } = process.stdout, max = 58, min = 42): number {
  const columns = typeof stream.columns === 'number' && stream.columns > 0 ? stream.columns : max + 2;
  return Math.max(min, Math.min(max, columns - 2));
}
