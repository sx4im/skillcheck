#!/usr/bin/env node

/**
 * Seeded Monte Carlo simulation evaluating Type I error (false HELPS / false HARMS)
 * rates under a true null hypothesis (mean skill effect = 0.0 pp) across Skillcheck
 * effort profiles: Quick, Standard, and Thorough, plus task vs. trial sweeps.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distScorePath = path.resolve(__dirname, '../dist/src/score.js');

if (!fs.existsSync(distScorePath)) {
  console.error(
    `Error: Built distribution not found at ${distScorePath}.\nPlease run 'npm run build' before running this simulation script.`
  );
  process.exit(1);
}

const { scorePairedObservations } = await import(distScorePath);

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function gaussian(rng, mean = 0, sd = 1) {
  let u1 = rng();
  let u2 = rng();
  while (u1 === 0) u1 = rng();
  return mean + Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2) * sd;
}

function runSimulation(tasks, trials, sd, reps = 2500, masterSeed = 42) {
  const rng = seededRandom(masterSeed);
  let helps = 0;
  let harms = 0;
  let placebo = 0;

  for (let r = 0; r < reps; r += 1) {
    const observations = [];
    for (let t = 0; t < tasks; t += 1) {
      const delta = sd === 0 ? 0 : gaussian(rng, 0, sd);
      const pWith = Math.max(0, Math.min(1, 0.5 + delta / 2));
      const pNo = Math.max(0, Math.min(1, 0.5 - delta / 2));
      for (let k = 0; k < trials; k += 1) {
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
    tasks,
    trials,
    n: tasks * trials,
    sd,
    falseHelpsPct: Number(((helps / reps) * 100).toFixed(2)),
    falseHarmsPct: Number(((harms / reps) * 100).toFixed(2)),
    falseVerdictPct: Number((((helps + harms) / reps) * 100).toFixed(2)),
    placeboPct: Number(((placebo / reps) * 100).toFixed(2))
  };
}

function formatTable(headers, rows) {
  const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));

  const pad = (s, w) => String(s).padEnd(w);
  const padNum = (s, w) => String(s).padStart(w);

  const printRow = (r) =>
    r.map((c, i) => (i >= 1 ? padNum(c, colWidths[i]) : pad(c, colWidths[i]))).join(' | ');

  const separator = colWidths.map((w) => '-'.repeat(w)).join('-|-');

  return [printRow(headers), separator, ...rows.map(printRow)].join('\n');
}

function main() {
  const REPS = 2500;
  const SEED = 42;

  const PROFILES = [
    { name: 'Quick', tasks: 2, trials: 1 },
    { name: 'Standard', tasks: 3, trials: 3 },
    { name: 'Thorough', tasks: 5, trials: 3 }
  ];

  console.log('================================================================================');
  console.log('Skillcheck Calibration Simulation: True Null False Verdict Rates');
  console.log(`Replications: ${REPS.toLocaleString()} per condition | Master Seed: ${SEED}`);
  console.log('Scorer: scorePairedObservations from built dist/src/score.js');
  console.log('================================================================================\n');

  console.log('Table 1: Effort Profiles across Task Effect Heterogeneity (Zero Mean Effect)');
  console.log('True population mean effect is 0.0 pp. Per-task effect standard deviation varies from 0.00 to 0.50.\n');

  const table1Headers = [
    'Profile',
    'Tasks',
    'Trials',
    'Total N',
    'Effect SD',
    'False HELPS',
    'False HARMS',
    'Total False',
    'Placebo (Correct)'
  ];

  const table1Rows = [];
  for (const profile of PROFILES) {
    for (const sd of [0.0, 0.15, 0.3, 0.5]) {
      const res = runSimulation(profile.tasks, profile.trials, sd, REPS, SEED);
      table1Rows.push([
        profile.name,
        profile.tasks,
        profile.trials,
        res.n,
        sd.toFixed(2),
        `${res.falseHelpsPct.toFixed(2)}%`,
        `${res.falseHarmsPct.toFixed(2)}%`,
        `${res.falseVerdictPct.toFixed(2)}%`,
        `${res.placeboPct.toFixed(2)}%`
      ]);
    }
  }
  console.log(formatTable(table1Headers, table1Rows));
  console.log('');

  console.log('Table 2: Few Tasks with Varying Trials (Moderate Heterogeneity, Effect SD = 0.30)');
  console.log('Demonstrates that adding trials on the same tasks narrows the CI around unrepresentative');
  console.log('task samples rather than adding independent domain evidence.\n');

  const trialSweepConfigs = [
    { label: '2 x 1', tasks: 2, trials: 1 },
    { label: '2 x 5', tasks: 2, trials: 5 },
    { label: '2 x 10', tasks: 2, trials: 10 },
    { label: '3 x 3', tasks: 3, trials: 3 },
    { label: '5 x 3', tasks: 5, trials: 3 },
    { label: '10 x 1', tasks: 10, trials: 1 }
  ];

  const table2Headers = [
    'Configuration',
    'Tasks',
    'Trials',
    'Total N',
    'False HELPS',
    'False HARMS',
    'Total False',
    'Placebo (Correct)'
  ];

  const table2Rows = trialSweepConfigs.map((cfg) => {
    const res = runSimulation(cfg.tasks, cfg.trials, 0.3, REPS, SEED);
    return [
      cfg.label,
      cfg.tasks,
      cfg.trials,
      res.n,
      `${res.falseHelpsPct.toFixed(2)}%`,
      `${res.falseHarmsPct.toFixed(2)}%`,
      `${res.falseVerdictPct.toFixed(2)}%`,
      `${res.placeboPct.toFixed(2)}%`
    ];
  });
  console.log(formatTable(table2Headers, table2Rows));

  console.log('\nTable 3: Trial Sweep Comparison across All Spreads (Total False Verdict Rate)');
  console.log('Comparing false verdict rates (%) as effect heterogeneity increases:\n');

  const table3Headers = ['Configuration', 'Tasks', 'Trials', 'Total N', 'SD = 0.00', 'SD = 0.15', 'SD = 0.30', 'SD = 0.50'];
  const table3Rows = trialSweepConfigs.map((cfg) => {
    const r0 = runSimulation(cfg.tasks, cfg.trials, 0.0, REPS, SEED).falseVerdictPct.toFixed(2);
    const r15 = runSimulation(cfg.tasks, cfg.trials, 0.15, REPS, SEED).falseVerdictPct.toFixed(2);
    const r30 = runSimulation(cfg.tasks, cfg.trials, 0.3, REPS, SEED).falseVerdictPct.toFixed(2);
    const r50 = runSimulation(cfg.tasks, cfg.trials, 0.5, REPS, SEED).falseVerdictPct.toFixed(2);
    return [cfg.label, cfg.tasks, cfg.trials, cfg.tasks * cfg.trials, `${r0}%`, `${r15}%`, `${r30}%`, `${r50}%`];
  });
  console.log(formatTable(table3Headers, table3Rows));

  console.log('\n================================================================================');
  console.log('Assumptions & Statistical Notes:');
  console.log('1. True Null Hypothesis: Population mean skill effect across domain tasks is 0.0 pp.');
  console.log('   Any verdict of HELPS or HARMS represents a false positive (Type I error).');
  console.log('2. Random Per-Task Effects: For each task, delta ~ N(0, sd^2). Success probabilities');
  console.log('   are pWith = clamp(0.5 + delta/2, 0, 1) and pNo = clamp(0.5 - delta/2, 0, 1),');
  console.log('   preserving an expected effect of 0.0 pp while modeling domain heterogeneity.');
  console.log('   Effect SD values (0.15, 0.30, 0.50) are assumed model scenarios, not measured.');
  console.log('3. Independent Bernoulli Trials: Conditioned on task difficulty, each trial outcome');
  console.log('   is an independent Bernoulli draw.');
  console.log('4. Paired Bootstrap: Observations are paired at the (task, trial) level.');
  console.log('   Confidence intervals are computed via 1,000 paired bootstrap resamples (2.5% and');
  console.log('   97.5% quantiles for nominal 95% coverage).');
  console.log('5. Decision Rules: HELPS = entire 95% CI > 0; HARMS = entire 95% CI < 0; PLACEBO otherwise.');
  console.log('6. Sample Size Finding: Extra trials on few tasks (e.g. 2 x 10) increase false verdict');
  console.log('   rates under heterogeneity because the bootstrap interval tightens around a small,');
  console.log('   unrepresentative task sample.');
  console.log('================================================================================');
}

main();
