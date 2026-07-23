export interface PairedObservation {
  withSkillPass: boolean;
  noSkillPass: boolean;
}

export interface ScoreSummary {
  effectPp: number;
  // Bootstrap mean effect (pp). Unlike the observed effect — which is quantized to
  // 100/N by the sample size — this averages many resamples, so it varies smoothly
  // and gives the satisfaction score continuous, granular values.
  meanEffectPp: number;
  ciPp: [number, number];
  verdict: 'helps' | 'placebo' | 'harms';
  withSkillPass: number;
  noSkillPass: number;
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function quantile(sortedValues: number[], q: number): number {
  if (sortedValues.length === 0) {
    throw new Error('Cannot compute quantile of an empty sample');
  }

  const index = (sortedValues.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sortedValues[lower]!;
  }

  const weight = index - lower;
  return sortedValues[lower]! * (1 - weight) + sortedValues[upper]! * weight;
}

function toPp(value: number): number {
  return Number((value * 100).toFixed(2));
}

export function scorePairedObservations(
  observations: PairedObservation[],
  iterations = 1000,
  seed = 1337
): ScoreSummary {
  if (observations.length === 0) {
    throw new Error('Cannot score zero observations');
  }

  const withSkillPass =
    observations.filter((observation) => observation.withSkillPass).length / observations.length;
  const noSkillPass =
    observations.filter((observation) => observation.noSkillPass).length / observations.length;
  const effect = withSkillPass - noSkillPass;

  const random = createSeededRandom(seed);
  const bootstrapEffects: number[] = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let total = 0;
    for (let index = 0; index < observations.length; index += 1) {
      const sample = observations[Math.floor(random() * observations.length)]!;
      total += Number(sample.withSkillPass) - Number(sample.noSkillPass);
    }
    bootstrapEffects.push(total / observations.length);
  }

  const meanEffect = bootstrapEffects.reduce((sum, value) => sum + value, 0) / bootstrapEffects.length;
  bootstrapEffects.sort((a, b) => a - b);
  const lower = toPp(quantile(bootstrapEffects, 0.025));
  const upper = toPp(quantile(bootstrapEffects, 0.975));
  const verdict = lower > 0 ? 'helps' : upper < 0 ? 'harms' : 'placebo';

  return {
    effectPp: toPp(effect),
    meanEffectPp: toPp(meanEffect),
    ciPp: [lower, upper],
    verdict,
    withSkillPass: Number(withSkillPass.toFixed(4)),
    noSkillPass: Number(noSkillPass.toFixed(4))
  };
}

export function effectInsideCi(summary: ScoreSummary): boolean {
  return summary.effectPp >= summary.ciPp[0] && summary.effectPp <= summary.ciPp[1];
}

export function ciOverlapsZero(summary: ScoreSummary): boolean {
  return summary.ciPp[0] <= 0 && summary.ciPp[1] >= 0;
}
