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

Headings are used as the declared domain when front matter is absent. However, a heading that is itself an instruction (e.g. `# Always write concise commit messages`) leaks into task generation, causing generated tasks to test that exact rule. Use `--domain "<neutral topic>"` for a blind run with an unprompted task generator.

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

Statistical evaluations based on small numbers of tasks can exhibit elevated false discovery rates (Type I errors). When evaluated tasks are fewer than 5, `skillcheck` emits a warning and sets `low_sample: true` in the JSON result to maintain scientific honesty.

### Empirical False Discovery Rates under True Null

Using the seeded Monte Carlo simulation (`node scripts/simulate-null.mjs`, seed 42, 2,500 replications per condition, importing `dist/src/score.js`), false HELPS and false HARMS rates were evaluated under a true null hypothesis (population mean effect = 0.0 pp) across effort profiles and per-task effect spreads:

| Profile | Tasks | Trials | Total N | SD = 0.00 (Homogeneous) | SD = 0.15 (Mild) | SD = 0.30 (Moderate) | SD = 0.50 (High) |
|---|---|---|---|---|---|---|---|
| **Quick** | 2 | 1 | 2 | 12.72% (6.04% / 6.68%) | 13.48% (6.92% / 6.56%) | 13.96% (7.08% / 6.88%) | 18.40% (8.76% / 9.64%) |
| **Standard** | 3 | 3 | 9 | 7.56% (3.36% / 4.20%) | 9.80% (4.88% / 4.92%) | 12.76% (5.80% / 6.96%) | 18.72% (9.08% / 9.64%) |
| **Thorough** | 5 | 3 | 15 | 5.76% (2.92% / 2.84%) | 6.00% (3.00% / 3.00%) | 9.16% (4.60% / 4.56%) | 15.28% (7.44% / 7.84%) |

### Tasks vs. Trials: Why More Trials on Few Tasks Do Not Fix Small Samples

Varying trial counts on few tasks demonstrates that extra trials on the same tasks do not add independent evidence:

| Configuration | Tasks | Trials | Total N | SD = 0.00 | SD = 0.15 | SD = 0.30 | SD = 0.50 |
|---|---|---|---|---|---|---|---|
| **2 × 1** | 2 | 1 | 2 | 12.72% | 13.48% | 13.96% | 18.40% |
| **2 × 5** | 2 | 5 | 10 | 6.48% | 9.28% | 16.52% | 27.32% |
| **2 × 10** | 2 | 10 | 20 | 4.76% | 10.56% | 22.80% | 37.72% |
| **3 × 3** | 3 | 3 | 9 | 7.56% | 9.80% | 12.76% | 18.72% |
| **5 × 3** | 5 | 3 | 15 | 5.76% | 6.00% | 9.16% | 15.28% |
| **10 × 1** | 10 | 1 | 10 | 6.48% | 6.84% | 6.84% | 6.28% |

Under moderate heterogeneity (SD = 0.30), increasing trials on 2 tasks from 1 to 10 trials raises the false verdict rate from 13.96% to 22.80% because repeated trials reduce noise around an unrepresentative task sample without expanding domain coverage. Conversely, evaluating 10 tasks with 1 trial each (Total N = 10) holds false verdict rates to 6.84%.

The nominal ~5% false discovery rate holds only when every task responds the same way to the skill (SD = 0.00). When per-task effects vary across a domain (SD = 0.15 to 0.50), false verdict rates range from 9.8% to 18.7% for Standard (3 tasks) and 6.0% to 15.3% for Thorough (5 tasks). When fewer than 5 tasks are evaluated, false verdict rates exceed ~11% when effects vary moderately or more (sd 0.30 or higher), so `skillcheck` sets `low_sample: true` and warns that verdicts can be wrong more often than the nominal 95% interval suggests.

### Simulation Assumptions

1. **Independent Bernoulli Trials**: Outcomes for each trial are independent Bernoulli variables conditional on task difficulty and treatment probability.
2. **Paired Observations**: For each task and trial, `with_skill` and `no_skill` are paired.
3. **Random Per-Task Effects**: For each task, delta ~ N(0, sd^2), with probabilities pWith = clamp(0.5 + delta/2, 0, 1) and pNo = clamp(0.5 - delta/2, 0, 1), ensuring a true population mean effect of 0.0 pp. The effect SD values (0.15, 0.30, 0.50) are assumed model scenarios to test sensitivity to heterogeneity, not measured empirical distributions.
4. **Percentile Bootstrap**: 1,000 resamples per evaluation using 2.5% and 97.5% quantiles (nominal 95% two-sided confidence interval).
5. **Decision Boundary**: `helps` requires the entire 95% CI to be strictly positive; `harms` requires the entire 95% CI to be strictly negative; `placebo` is assigned when the CI spans zero.
6. **True Null**: Population mean effect across the domain is exactly 0.0 pp. Any `helps` or `harms` verdict represents a Type I error.

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
