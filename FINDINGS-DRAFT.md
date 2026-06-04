# Findings Draft

Status: unverified. Do not post.

The M5 20-skill launch corpus has not completed yet. NVIDIA NIM chat completions failed during the M5 cache-warm sample on 2026-06-04, including a minimal runner health check that ended with `read ETIMEDOUT`.

## Current Non-Launch Aggregate

The committed result store currently contains 13 result-shaped JSON files from M1/M2 gates and smoke/control runs:

- `helps`: 3 / 13, 23.1%
- `placebo`: 8 / 13, 61.5%
- `harms`: 2 / 13, 15.4%
- `placebo` or `harms`: 10 / 13, 76.9%

This is not the launch finding. It includes repeat runs and control fixtures, so it must not be framed as a public corpus result.

## M1 Seed Observation

Across the five accessible `awesome-claude-md` skills used for the M1 gate:

- Next.js measured `helps` in both gate runs.
- FastAPI measured `placebo` in both gate runs.
- Python measured `placebo` in both gate runs.
- React measured `placebo` in both gate runs.
- TypeScript measured `harms` in both gate runs.

This is useful internal evidence that the evaluator produces stable repeated verdicts, not a launch claim.

## Rot

The real committed rot report currently shows `0` rot flags. The M4 model-swap fixture demonstrates the rot UI and algorithm with one simulated regression, but that simulated result is not part of the public leaderboard data.

## Required Before Posting

- Complete `skillcheck corpus run --corpus corpus/launch-20.json` on all 20 pinned seed skills.
- Regenerate `results/rot/report.json`.
- Recompute aggregate percentages from only the 20 launch results.
- Replace this draft with numbers from the launch corpus only.
