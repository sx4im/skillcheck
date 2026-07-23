import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  colorLevel,
  padDisplay,
  stripAnsi,
  truncateDisplay,
  visibleWidth,
  wrapText
} from '../src/theme.js';

const ENV_KEYS = ['NO_COLOR', 'FORCE_COLOR', 'TERM', 'COLORTERM'] as const;

describe('colorLevel', () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it('disables colour without a TTY', () => {
    expect(colorLevel({ isTTY: false })).toBe(0);
    expect(colorLevel({})).toBe(0);
  });

  it('honours NO_COLOR for ANY non-empty value, per the spec', () => {
    process.env.FORCE_COLOR = '3';
    process.env.NO_COLOR = 'please';
    expect(colorLevel({ isTTY: true })).toBe(0);
    process.env.NO_COLOR = '0'; // even "0" counts as set-and-non-empty
    expect(colorLevel({ isTTY: true })).toBe(0);
  });

  it('ignores an empty NO_COLOR', () => {
    process.env.NO_COLOR = '';
    process.env.FORCE_COLOR = '3';
    expect(colorLevel({ isTTY: false })).toBe(3);
  });

  it('lets FORCE_COLOR enable colour without a TTY', () => {
    process.env.FORCE_COLOR = '2';
    expect(colorLevel({ isTTY: false })).toBe(2);
    process.env.FORCE_COLOR = '3';
    expect(colorLevel({ isTTY: false })).toBe(3);
  });

  it('treats FORCE_COLOR=0 as explicitly off', () => {
    process.env.FORCE_COLOR = '0';
    process.env.COLORTERM = 'truecolor';
    expect(colorLevel({ isTTY: true })).toBe(0);
  });

  it('detects truecolor and 256-colour terminals', () => {
    process.env.COLORTERM = 'truecolor';
    expect(colorLevel({ isTTY: true })).toBe(3);
    delete process.env.COLORTERM;
    process.env.TERM = 'xterm-256color';
    expect(colorLevel({ isTTY: true })).toBe(2);
    process.env.TERM = 'dumb';
    expect(colorLevel({ isTTY: true })).toBe(0);
  });
});

describe('display-width helpers', () => {
  it('measures width ignoring ANSI escape codes', () => {
    expect(visibleWidth('\x1b[1;32mok\x1b[0m')).toBe(2);
    expect(stripAnsi('\x1b[38;2;1;2;3mhi\x1b[0m')).toBe('hi');
  });

  it('pads to a display width counting only visible characters', () => {
    const painted = '\x1b[2mab\x1b[0m';
    expect(visibleWidth(padDisplay(painted, 6))).toBe(6);
    expect(padDisplay('abc', 2)).toBe('abc'); // never truncates
  });

  it('truncates with an ellipsis and a closing reset', () => {
    const out = truncateDisplay('abcdefgh', 5);
    expect(visibleWidth(out)).toBe(5);
    expect(stripAnsi(out)).toBe('abcd…');
    expect(truncateDisplay('abc', 5)).toBe('abc');
  });

  it('wraps text greedily at the given width', () => {
    expect(wrapText('the quick brown fox jumps', 11)).toEqual(['the quick', 'brown fox', 'jumps']);
    expect(wrapText('', 10)).toEqual(['']);
  });
});
