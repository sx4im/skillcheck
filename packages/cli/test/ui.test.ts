import { describe, expect, it } from 'vitest';
import { stripAnsi, visibleWidth } from '../src/theme.js';
import { formatFatalError, formatQuotaUpsell, formatResultCard, sanitizeCliError } from '../src/ui.js';

describe('sanitizeCliError', () => {
  it('surfaces a clean upgrade message for quota / 402 errors', () => {
    const message = sanitizeCliError(
      new Error("402 You've used all 10 free Skillcheck runs. Upgrade to keep going at https://app.example/app.html")
    );
    expect(message).toContain('free Skillcheck runs');
    expect(message).toContain('Upgrade');
    expect(message.startsWith('402')).toBe(false);
    expect(message).not.toContain('not connected');
  });

  it('maps auth errors to a friendly connect message', () => {
    expect(sanitizeCliError(new Error('401 Unauthorized: invalid api key'))).toMatch(/not connected/i);
  });

  it('scrubs provider branding from generic errors', () => {
    expect(sanitizeCliError(new Error('NVIDIA NIM request timeout'))).toBe('Skillcheck Cloud request timeout');
    expect(sanitizeCliError(new Error('NVIDIA error occurred'))).toBe('Skillcheck Cloud error occurred');
  });
});

const SAMPLE_RESULT = {
  skill: { name: 'Docs Skill' },
  config: { tasks: 3, trials: 2 },
  result: {
    verdict: 'helps',
    effect_pp: 25,
    ci_pp: [5, 45],
    with_skill_pass: 0.75,
    no_skill_pass: 0.5,
    token_overhead: 120
  }
};

describe('result card rendering', () => {
  it('keeps every border perfectly aligned (equal visible width on all lines)', () => {
    const lines = formatResultCard(SAMPLE_RESULT, 'results/long-path-to-a-saved-result-file.json').split('\n');
    const widths = new Set(lines.map((line) => visibleWidth(line)));
    expect(widths.size).toBe(1);
    expect(stripAnsi(lines[0]!).startsWith('╭')).toBe(true);
    expect(stripAnsi(lines.at(-1)!).startsWith('╰')).toBe(true);
  });

  it('word-wraps the verdict explanation inside the card', () => {
    const card = stripAnsi(formatResultCard(SAMPLE_RESULT));
    expect(card).toContain('The skill HELPED');
    // The full sentence is longer than the card, so it must span multiple rows.
    const rows = card.split('\n').filter((line) => /The skill HELPED|without\./.test(line));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('flags a wide confidence interval as inconclusive', () => {
    const card = stripAnsi(
      formatResultCard({
        ...SAMPLE_RESULT,
        result: { ...SAMPLE_RESULT.result, ci_pp: [-30, 35] }
      })
    );
    expect(card).toMatch(/inconclusive/i);
    expect(card).toMatch(/Thorough/);
  });

  it('truncates an overlong saved path instead of breaking the box', () => {
    const longPath = `results/${'very-'.repeat(30)}long.json`;
    const lines = formatResultCard(SAMPLE_RESULT, longPath).split('\n');
    const widths = new Set(lines.map((line) => visibleWidth(line)));
    expect(widths.size).toBe(1);
    expect(stripAnsi(lines.join('\n'))).toContain('…');
  });
});

describe('quota upsell block', () => {
  it('renders an aligned box pointing at the pricing page', () => {
    const lines = formatQuotaUpsell().split('\n');
    const widths = new Set(lines.map((line) => visibleWidth(line)));
    expect(widths.size).toBe(1);
    expect(stripAnsi(lines.join('\n'))).toContain('#pricing');
  });
});

describe('fatal error block', () => {
  it('shows a headline with the sanitized message indented beneath', () => {
    const message = formatFatalError(new Error('NVIDIA NIM exploded\nsecond line'));
    expect(stripAnsi(message)).toMatch(/✗ Skillcheck stopped/);
    expect(message).toContain('  Skillcheck Cloud exploded');
    expect(message).toContain('  second line');
  });

  it('routes quota errors to the upsell instead of a stack-trace dump', () => {
    const error = Object.assign(new Error('quota_exceeded'), { status: 402 });
    const message = stripAnsi(formatFatalError(error));
    expect(message).toContain('Out of free runs');
    expect(message).toContain('#pricing');
  });
});
