#!/usr/bin/env node

/**
 * Seeded Monte Carlo simulation evaluating Type I error (false HELPS / false HARMS)
 * rates under a true null hypothesis (mean skill effect = 0.0 pp) across Skillcheck
 * effort profiles: Quick, Standard, and Thorough.
 */

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function quantile(sortedValues, q) {
  const index = (sortedValues.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sortedValues[lower];
  }
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function scorePairedObservations(observations, iterations = 1000, seed = 1337) {
  const random = seededRandom(seed);
  const bootstrapEffects = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let total = 0;
    for (let index = 0; index < observations.length; index += 1) {
      const sample = observations[Math.floor(random() * observations.length)];
      total += Number(sample.withSkillPass) - Number(sample.noSkillPass);
    }
    bootstrapEffects.push(total / observations.length);
  }

  bootstrapEffects.sort((a, b) => a - b);
  const lower = Number((quantile(bootstrapEffects, 0.025) * 100).toFixed(2));
  const upper = Number((quantile(bootstrapEffects, 0.975) * 100).toFixed(2));
  const verdict = lower > 0 ? 'helps' : upper < 0 ? 'harms' : 'placebo';

  return { lower, upper, verdict };
}

function runSimulation(profile, getTaskProbs, reps = 5000, masterSeed = 42) {
  const rng = seededRandom(masterSeed);
  let helps = 0;
  let harms = 0;
  let placebo = 0;

  for (let r = 0; r < reps; r += 1) {
    const observations = [];
    for (let t = 0; t < profile.tasks; t += 1) {
      const { pWith, pNo } = getTaskProbs(t, profile.tasks);
      for (let k = 0; k < profile.trials; k += 1) {
        observations.push({
          withSkillPass: rng() < pWith,
          noSkillPass: rng() < pNo
        });
      }
    }
    const score = scorePairedObservations(observations, 1000, (r * 10007 + 1337) >>> 0);
    if (score.verdict === 'helps') {
      helps += 1;
    } else if (score.verdict === 'harms') {
      harms += 1;
    } else {
      placebo += 1;
    }
  }

  return {
    profile: profile.name,
    tasks: profile.tasks,
    trials: profile.trials,
    n: profile.tasks * profile.trials,
    falseHelpsPct: Number(((helps / reps) * 100).toFixed(2)),
    falseHarmsPct: Number(((harms / reps) * 100).toFixed(2)),
    falseSigPct: Number((((helps + harms) / reps) * 100).toFixed(2)),
    placeboPct: Number(((placebo / reps) * 100).toFixed(2))
  };
}

function formatTable(rows) {
  const header = ['Profile', 'Tasks', 'Trials', 'Total N', 'False HELPS', 'False HARMS', 'Total Type I', 'Placebo (Correct)'];
  const formattedRows = rows.map((r) => [
    r.profile,
    String(r.tasks),
    String(r.trials),
    String(r.n),
    `${r.falseHelpsPct.toFixed(2)}%`,
    `${r.falseHarmsPct.toFixed(2)}%`,
    `${r.falseSigPct.toFixed(2)}%`,
    `${r.placeboPct.toFixed(2)}%`
  ]);

  const colWidths = header.map((h, i) => Math.max(h.length, ...formattedRows.map((r) => r[i].length)));

  const pad = (s, w) => s.padEnd(w);
  const padNum = (s, w) => s.padStart(w);

  const printRow = (r) =>
    r.map((c, i) => (i >= 1 && i <= 6 ? padNum(c, colWidths[i]) : pad(c, colWidths[i]))).join(' | ');

  const separator = colWidths.map((w) => '-'.repeat(w)).join('-|-');

  return [printRow(header), separator, ...formattedRows.map(printRow)].join('\n');
}

function main() {
  const REPS = 5000;
  const SEED = 42;

  const PROFILES = [
    { name: 'Quick', tasks: 2, trials: 1 },
    { name: 'Standard', tasks: 3, trials: 3 },
    { name: 'Thorough', tasks: 5, trials: 3 }
  ];

  console.log('================================================================================');
  console.log('Skillcheck Calibration Simulation: True Null False Discovery Rates');
  console.log(`Replications: ${REPS.toLocaleString()} per profile | Master Seed: ${SEED}`);
  console.log('================================================================================\n');

  // Scenario 1: Homogeneous Null (baseline difficulty = 50%, delta = 0)
  console.log('Scenario 1: Homogeneous Null');
  console.log('All tasks share equal difficulty (p = 0.50), true skill effect = 0.0 pp.\n');
  const s1Rows = PROFILES.map((p) =>
    runSimulation(p, () => ({ pWith: 0.5, pNo: 0.5 }), REPS, SEED)
  );
  console.log(formatTable(s1Rows));
  console.log('');

  // Scenario 2: Heterogeneous Difficulty Null (baseline difficulty varies 20% - 80%, delta = 0)
  console.log('Scenario 2: Heterogeneous Task Difficulty Null');
  console.log('Task difficulties vary across domain [p = 0.20 to 0.80], true skill effect = 0.0 pp on all tasks.\n');
  const s2Rows = PROFILES.map((p) =>
    runSimulation(
      p,
      (t, total) => {
        const pBase = 0.2 + (t / Math.max(1, total - 1)) * 0.6;
        return { pWith: pBase, pNo: pBase };
      },
      REPS,
      SEED + 101
    )
  );
  console.log(formatTable(s2Rows));
  console.log('');

  // Scenario 3: Varying Per-Task Effects with Net Zero Mean Effect
  console.log('Scenario 3: Varying Per-Task Effects (Net Mean Effect = 0.0 pp)');
  console.log('Per-task effects alternate (+15 pp and -15 pp) with net zero population effect.\n');
  const s3Rows = PROFILES.map((p) =>
    runSimulation(
      p,
      (t) => {
        const effect = t % 2 === 0 ? 0.15 : -0.15;
        return { pWith: 0.5 + effect, pNo: 0.5 };
      },
      REPS,
      SEED + 202
    )
  );
  console.log(formatTable(s3Rows));
  console.log('\n================================================================================');
  console.log('Assumptions:');
  console.log('1. Independent Bernoulli Trials: Trial pass/fail outcomes are independent conditioned');
  console.log('   on task difficulty and arm treatment probability.');
  console.log('2. Paired Sampling: For each task and trial, with_skill and no_skill are paired.');
  console.log('3. Bootstrap Confidence Intervals: Standard percentile bootstrap with 1,000 resamples');
  console.log('   using 2.5% and 97.5% quantiles (nominal 95% two-sided confidence interval).');
  console.log('4. Decision Rule: HELPS requires entire 95% CI > 0; HARMS requires entire 95% CI < 0;');
  console.log('   PLACEBO when CI spans zero.');
  console.log('5. True Null: Ground truth population mean effect is exactly 0.0 pp. Any HELPS or');
  console.log('   HARMS verdict represents a false discovery (Type I error).');
  console.log('================================================================================');
}

main();
