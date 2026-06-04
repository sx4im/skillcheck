import { describe, expect, it } from 'vitest';
import { ciOverlapsZero, effectInsideCi, scorePairedObservations } from '../src/score.js';

describe('scorePairedObservations', () => {
  it('reports a positive deterministic effect with a CI containing the point estimate', () => {
    const summary = scorePairedObservations(
      Array.from({ length: 24 }, () => ({ withSkillPass: true, noSkillPass: false }))
    );

    expect(summary.effectPp).toBe(100);
    expect(summary.ciPp).toEqual([100, 100]);
    expect(summary.verdict).toBe('helps');
    expect(effectInsideCi(summary)).toBe(true);
  });

  it('keeps an empty-control style sample overlapping zero', () => {
    const observations = Array.from({ length: 24 }, (_, index) => ({
      withSkillPass: index % 2 === 0,
      noSkillPass: index % 2 === 0
    }));
    const summary = scorePairedObservations(observations);

    expect(summary.effectPp).toBe(0);
    expect(summary.verdict).toBe('placebo');
    expect(ciOverlapsZero(summary)).toBe(true);
  });
});
