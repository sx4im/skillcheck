# Leaderboard and Benchmark Claims Audit

Date: 2026-10-02
Branch: fix/leaderboard-integrity

## 1. Overview and Objective

This audit verifies whether any per-skill number, verdict count, or "verified" claim displayed on the Skillcheck landing page (`dashboard/index.html`) or documented in the repository `README.md` is reproduced by a committed evaluation result JSON file.

Skillcheck evaluates agent skills empirically through paired evaluation arms, blind grading, and bootstrap confidence intervals. To maintain scientific integrity, any performance claim attached to a named skill or repository must be backed by a committed, reproducible evaluation artifact containing full task definitions, model configurations, and output transcript hashes.

## 2. Audit Findings

### 2.1 Search for Committed Evaluation Artifacts

A full scan of the repository for tracked evaluation result files (`*.json`) was conducted:
- `fixtures/m4/results/baseline-nextjs.json`: Synthetic test fixture for rot canary detection (M4).
- `fixtures/m4/results/new-model-nextjs.json`: Synthetic test fixture for rot canary detection (M4).
- `fixtures/m4/rot-report.json`: Synthetic test fixture for rot reports.
- `results/`: Directory is git-ignored (`.gitignore` line 4) and contains zero committed result files.

**Finding:** There are zero committed result JSON files in the repository for any community or third-party skill.

---

### 2.2 Per-Skill Numbers and Claims

The table below audits every per-skill claim previously published in `dashboard/index.html` and `README.md`:

| Skill Name | Referenced Source / Repository | Claimed Lift (Effect Size) | Claimed 95% CI Range | Claimed Verdict | Claimed Model | Committed Result JSON |
|---|---|---|---|---|---|---|
| Superpowers | `obra/superpowers` | +38.5 pp (previously +29.2 pp) | [+24.0, +53.0] | HELPS | claude-3-7-sonnet | NOT FOUND |
| Ponytail | `alonbaron/claude-skills` | +31.2 pp (previously +2.8 pp) | [+17.5, +45.0] | HELPS (previously PLACEBO) | claude-3-7-sonnet | NOT FOUND |
| UI/UX Pro Max | `nextlevelbuilder/ui-ux-pro-max-skill` | +27.8 pp (previously +24.5 pp) | [+14.0, +41.5] | HELPS | o3-mini | NOT FOUND |
| Frontend Design | `anthropics/claude-code` | +24.6 pp (previously +22.0 pp) | [+11.2, +38.0] | HELPS | claude-3-7-sonnet | NOT FOUND |
| Humanizer | `blader/humanizer` | +21.4 pp (previously +18.6 pp) | [+8.5, +34.2] | HELPS | gpt-4o | NOT FOUND |
| Skill Creator | `anthropics/skills` | +19.8 pp (previously +17.5 pp) | [+7.0, +32.6] | HELPS | deepseek-r1 | NOT FOUND |
| Taste | `senlindesign/taste-skill` | +17.2 pp (previously 0.0 pp) | [+5.5, +29.0] | HELPS (previously PLACEBO) | llama-3-3-70b-instruct | NOT FOUND |
| Caveman | `JuliusBrussee/caveman` | +2.4 pp (previously +15.5 pp, +1.2 pp) | [-3.8, +8.5] | PLACEBO (previously HELPS) | qwen-2-5-coder-32b | NOT FOUND |
| ADHD | `UditAkhourii/adhd` | +1.8 pp (previously +13.2 pp, -8.5 pp) | [-4.2, +7.8] | PLACEBO (previously HELPS, HARMS) | mistral-large-2411 | NOT FOUND |
| No AI Slop | `rcawston/no-ai-slop` | +0.8 pp (previously +11.8 pp, -13.5 pp) | [-5.0, +6.6] | PLACEBO (previously HELPS, HARMS) | gpt-4-5-preview | NOT FOUND |

**Finding:** All 10 skills displayed on the landing page lacked backing evaluation result files. Numbers, confidence intervals, and token counts were adjusted manually across recent commits rather than generated from reproducible model evaluation runs.

---

### 2.3 Verdict Counts and Aggregate Statistics

The landing page and README included several aggregate claims:
1. `dashboard/index.html`: "10 Featured Skills, 7 Helps (70%), 3 Placebo (30%), 0 Harms (0%)" (and previous iterations claiming 10 Verified Helps or 5 Helps / 3 Placebo / 2 Harms).
2. `README.md`: Callout highlighting "verified +38.5 pp lift", "verified +31.2 pp lift", and "verified double-digit accuracy gains".
3. Earlier README text: Claims referencing a "20-Skill Seed Corpus" with "60% placebos, 15% harms, 25% helps".

**Finding:** None of these aggregate counts or percentages are backed by committed evaluation runs.

---

### 2.4 Methodology Phrasing Discrepancies

The landing page stated:
> "Each skill was evaluated with paired randomized trials, double-blind grading at temperature 0, and 1,000 bootstrap resamples."

An audit of the implementation code revealed:
1. `packages/cli/src/run.ts` (`runTrials` / `runOne`):
   - Trials are run in paired arms (`with_skill` vs `no_skill`) across identical tasks with a fixed temperature of 0.7.
   - Trials are not randomized in order or task assignment in `run.ts`.
2. `packages/cli/src/grade.ts` (`gradeTrials`):
   - Outputs from both arms are graded blind without exposing arm provenance to the grader model.
   - Candidate evaluation order is shuffled using `seededShuffle` (seeded with the SHA-256 hash of transcript hashes).
3. `packages/cli/src/score.ts` (`pairedBootstrap`):
   - Generates confidence intervals using a deterministic seeded paired bootstrap with 1,000 resamples.

**Finding:** The phrase "paired randomized trials" does not accurately represent `run.ts`. The actual pipeline executes paired counterfactual trials, followed by blind grading with presentation order determined by a seeded shuffle.

---

## 3. Remediations Applied

1. **Remove Unbacked Third-Party Skill Claims**:
   - Removed all 10 third-party repository rows, names, links, and unbacked percentages from `dashboard/index.html`.
   - Removed all claims of "verified" lifts attached to third-party repositories from `README.md`.

2. **Replace with Clearly Labeled Example Output**:
   - Replaced the landing page leaderboard with an "Example Evaluation Output" section.
   - Used generic illustrative skill names (`nextjs-app-router`, `typescript-strict-types`, `git-commit-standards`, `python-async-patterns`) to demonstrate the three possible verdicts (`HELPS`, `PLACEBO`, `HARMS`).
   - Added an explicit disclaimer: *"The table below displays sample evaluation output schema for illustration. Skillcheck does not publish performance claims for third-party skills without committed, reproducible evaluation result files."*

3. **Correct Methodology Phrasing**:
   - Updated the methodology text to match the codebase:
     *"Each evaluation runs paired trials with and without the skill, applies double-blind grading with presentation order determined by a seeded shuffle, and computes effect sizes with a 1,000-iteration paired bootstrap confidence interval."*
