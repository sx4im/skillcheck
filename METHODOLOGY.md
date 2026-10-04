# Methodology

This document describes how `skillcheck` measures skill effectiveness in v1.

## What Is Measured

`skillcheck` measures the value of skill instructions under forced injection. The skill body is always injected into the runner model's context for the `with_skill` arm and omitted for the `no_skill` arm.

This is intentionally narrower than real agent behavior. It answers: "Does this skill content help when the model receives it?" It does not answer: "Will an agent trigger this skill at the right time?" Trigger-respecting evaluation is out of scope for v1.

## Skill Normalization

Supported input formats:

- `SKILL.md`
- `AGENTS.md`
- `.cursorrules`
- `CLAUDE.md` for the accessible `awesome-claude-md` seed corpus

Each skill is normalized into:

- `instructions`: full injected content
- `domain`: declared scope from front matter or inferred text
- `format`: source format
- `assets`: recorded sibling files, not executed in v1
- `commit_hash`: SHA-256 hash of the instruction body

## Task Generation

The task generator receives only the normalized `domain`. It never receives the instruction body.

For each run, the generator creates `2N` tasks and `skillcheck` deterministically samples `N` tasks. This reduces dependence on a single generation order while preserving reproducibility for the same domain and generator model.

## A/B Runner

For each task, the runner model is called in two arms:

- `with_skill`: system context includes the skill instructions
- `no_skill`: task prompt only

Each arm runs `K` trials. The default is `K=3`; single-trial results are not accepted as launch-quality evidence.

## Grading

Deterministic assertions run first when a task has one. Otherwise, the grader model receives the output and the criterion, but not the arm label. This keeps grading blind to whether an answer came from the skill-injected arm (the grader is blind to which arm produced an output, while the subject model cannot be).

The generator, runner, and grader model IDs are separate environment variables so they can be swapped independently.

## Scoring

`effect_pp` is:

```text
mean(with_skill_pass_rate) - mean(no_skill_pass_rate)
```

The confidence interval is a paired bootstrap over task/trial observations. Verdicts are:

- `helps`: the full CI is above zero
- `placebo`: the CI overlaps zero
- `harms`: the full CI is below zero

Results also report token overhead and value per 1k extra prompt tokens.

## Calibration

Statistical evaluations based on small samples can exhibit elevated false discovery rates (Type I errors). When total observations (`tasks × trials`) falls below 9 (the size of the Standard 3 tasks × 3 trials profile), `skillcheck` emits a warning and sets `low_sample: true` in the JSON result to maintain scientific honesty.

### Empirical False Discovery Rates under True Null

Using the seeded Monte Carlo simulation (`node scripts/simulate-null.mjs`, seed 42, 5,000 replications per profile), false HELPS and false HARMS rates were evaluated under a true null hypothesis (population mean effect = 0.0 pp):

| Profile | Tasks | Trials | Total N | Homogeneous Null (p = 0.50) | Heterogeneous Null (p in [0.20, 0.80]) | Varying Effects (±15 pp, net 0 pp) |
|---|---|---|---|---|---|---|
| **Quick** | 2 | 1 | 2 | 11.98% (6.00% H / 5.98% H) | 4.86% (2.46% H / 2.40% H) | 10.98% (5.48% H / 5.50% H) |
| **Standard** | 3 | 3 | 9 | 8.02% (3.98% H / 4.04% H) | 7.48% (3.70% H / 3.78% H) | 7.62% (5.56% H / 2.06% H) |
| **Thorough** | 5 | 3 | 15 | 5.94% (3.08% H / 2.86% H) | 5.54% (2.84% H / 2.70% H) | 5.06% (3.24% H / 1.82% H) |

### Simulation Assumptions

1. **Independent Bernoulli Trials**: Outcomes for each trial are independent Bernoulli variables conditional on task difficulty and treatment probability.
2. **Paired Observations**: For each task and trial, `with_skill` and `no_skill` are paired.
3. **Percentile Bootstrap**: 1,000 resamples per evaluation using 2.5% and 97.5% quantiles (nominal 95% two-sided confidence interval).
4. **Decision Boundary**: `helps` requires the entire 95% CI to be strictly positive; `harms` requires the entire 95% CI to be strictly negative; `placebo` is assigned when the CI spans zero.
5. **True Null**: Population mean effect across the domain is exactly 0.0 pp. Any `helps` or `harms` verdict represents a Type I error.

Due to the discrete granularity of paired differences at N = 2, Quick profile runs have higher false discovery rates (~11% to 12% under symmetric nulls). Standard (N = 9) and Thorough (N = 15) reduce false discoveries toward the nominal 5% level. Quick effort is designed for fast developer iteration, while launch-quality decisions should use Standard or Thorough effort.

## Reproducibility

Every published result records:

- skill source
- skill instruction hash
- task suite path
- runner, grader, and generator model IDs
- trial count and task count
- transcript hashes
- run date

`skillcheck verify <result.json>` reruns a sample of tasks and checks whether the measured effect remains inside the published confidence interval.

## Rot Detection

Rot detection groups result history by normalized skill name plus instruction hash. A skill is flagged as rot only when a previous result was `helps` and the latest result is `placebo` or `harms`.

The leaderboard renders the latest rot status and the per-skill history timeline.

## Known Limitations

- Forced injection does not measure trigger reliability.
- LLM-graded tasks inherit the limitations of the grader model, even with blind labels.
- Assets are recorded but not executed in v1.
- The v1 launch seed corpus is intentionally capped at 20 skills; it is launch evidence, not a comprehensive public corpus.
- Remote provider availability and network rate limits can affect live corpus runs. Failed or interrupted runs are recorded separately from gate-passing evidence, and benchmark findings report results from verified, completed runs.
