import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bannerLines,
  formatQuotaUpsell,
  formatResultCard,
  printBanner,
  printCheckHeader,
  printHelpUi,
  printKeyRejected,
  printKeyUnreachable,
  printKeyVerified,
  printLogout,
  printSetupIntro,
  printUpdateApplied,
  printUpdateAvailable,
  printUpdateFailed,
  printUpdateSkipped,
  supportedSkillFilesText
} from '../src/ui.js';

function capture(fn: () => void): string {
  const out: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    out.push(a.map(String).join(' '));
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return out.join('\n');
}

function card(withPass: number, noPass: number, verdict: string): string {
  return formatResultCard({
    skill: { name: 'Demo' },
    config: { tasks: 3, trials: 2 },
    result: { verdict, effect_pp: (withPass - noPass) * 100, ci_pp: [0, 0], with_skill_pass: withPass, no_skill_pass: noPass, token_overhead: 40 }
  });
}

describe('ui formatters', () => {
  let prevNoColor: string | undefined;
  beforeEach(() => {
    prevNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = '1'; // assert on plain text, not escape codes
  });
  afterEach(() => {
    if (prevNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prevNoColor;
  });

  it('renders the banner with the tagline and version', () => {
    const lines = bannerLines();
    const text = lines.join('\n');
    expect(text).toMatch(/Is your skill actually helping the model\?/);
    expect(text).toMatch(/v\d+\.\d+\.\d+/);
    expect(capture(printBanner)).toContain('Is your skill actually helping');
  });

  it('prints help with usage, commands, and options', () => {
    const text = capture(printHelpUi);
    expect(text).toMatch(/Usage/);
    expect(text).toMatch(/Commands/);
    expect(text).toMatch(/check <path>/);
    expect(text).toMatch(/--help/);
  });

  it('prints a compact check header', () => {
    const text = capture(() => printCheckHeader('./SKILL.md', 3, 2));
    expect(text).toContain('./SKILL.md');
    expect(text).toMatch(/3 tasks × 2 trials/);
  });

  it('describes a HELPS, HARMS, and PLACEBO verdict in plain language', () => {
    expect(card(0.8, 0.5, 'helps')).toContain('The skill HELPED');
    expect(card(0.3, 0.6, 'harms')).toContain('The skill HURT');
    expect(card(0.5, 0.5, 'placebo')).toContain('No measurable difference');
  });

  it('renders the quota upsell and setup intro', () => {
    expect(formatQuotaUpsell()).toMatch(/free Skillcheck runs/i);
    expect(capture(() => printSetupIntro('https://web.test/app.html'))).toContain('https://web.test/app.html');
  });

  it('reports verified, rejected, and unreachable key states', () => {
    expect(capture(() => printKeyVerified({ plan: 'free', runsUsed: 1, runsLimit: 10 }, '/cfg'))).toMatch(/all set/i);
    expect(capture(() => printKeyRejected('bad key', 'https://web.test'))).toMatch(/not accepted/i);
    expect(capture(() => printKeyUnreachable('offline'))).toMatch(/could not reach/i);
  });

  it('renders the update prompts and logout confirmations', () => {
    expect(capture(() => printUpdateAvailable('0.5.0', '0.6.0'))).toMatch(/Update available/);
    expect(capture(() => printUpdateApplied('0.6.0'))).toMatch(/Updated to v0\.6\.0/);
    expect(capture(() => printUpdateSkipped('0.6.0'))).toMatch(/Skipped/);
    expect(capture(printUpdateFailed)).toMatch(/Could not update/);
    expect(capture(() => printLogout({ removed: true, envOverride: false, path: '/cfg' }))).toMatch(/Signed out/);
    expect(capture(() => printLogout({ removed: false, envOverride: true, path: '/cfg' }))).toMatch(/already signed out/i);
  });

  it('exposes a human description of supported inputs', () => {
    expect(supportedSkillFilesText()).toMatch(/Markdown/);
  });
});
