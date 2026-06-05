# Findings Draft

Status: unverified draft. Do not post as final release copy yet.

## M5 Launch Corpus

The M5 launch run completed on 2026-06-05 in `results/launch/20260605T110514Z-qwen-next`.

- Corpus: 20 pinned seed skills from `corpus/launch-20.json`.
- Evaluation shape: 10 generated tasks per skill, 3 paired trials per task.
- Mode: forced injection.
- Generator, grader, and runner: `qwen/qwen3-next-80b-a3b-instruct`.
- Provider evidence: API key was valid, `/v1/models` returned HTTP 200, the final run exited `0`, and the final run log had 75 recovered NVIDIA connection retries with 0 `429` lines.

## Aggregate Result

Across the 20 launch results:

- `helps`: 3 / 20, 15%.
- `placebo`: 11 / 20, 55%.
- `harms`: 6 / 20, 30%.
- `placebo` or `harms`: 17 / 20, 85%.
- Mean effect: -6.5 pp.
- Median effect: between -10 pp and 0 pp.

This launch result supports the main product claim: many popular agent-skill files do not reliably improve task performance under controlled forced injection, and some can harm measured performance.

## Skills That Helped

- `Angular Expert`: +40 pp, CI `[13.33, 60]`.
- `CLAUDE.md - Go 项目规范`: +20 pp, CI `[6.67, 36.67]`.
- `Prototype`: +20 pp, CI `[6.67, 33.33]`.

## Skills That Harmed

- `Triage`: -40 pp, CI `[-56.67, -23.33]`.
- `Test-Driven Development`: -30 pp, CI `[-53.33, -6.67]`.
- `to-prd`: -30 pp, CI `[-46.67, -13.33]`.
- `Python 项目规范`: -20 pp, CI `[-36.67, -6.67]`.
- `React 19 + Vite SPA 项目`: -20 pp, CI `[-36.67, -6.67]`.
- `To Issues`: -20 pp, CI `[-36.67, -6.67]`.

## Rot

The launch-only rot report in `results/rot/report.json` shows 20 skills as `new` and 0 rot flags because this is the first complete launch run under the selected Qwen Next model stack.

## Caveats

- This measures skill content under forced injection, not whether an agent triggers the skill correctly.
- Results are specific to the Qwen Next NVIDIA NIM model stack and the generated task suites committed with the run.
- The original StepFun/DeepSeek/Mistral stack was not reliable enough to complete M5 in this environment; the model swap is documented in `DECISIONS.md` and `BUILD-LOG.md`.
