# Decisions

## 2026-06-03

- The requested file `skillcheck-PRD-v2.md` is not present in the workspace. The available `skillcheck-PRD.md` is titled "Product Requirements Document v2" and has `Last updated: 2026-06-03`, so this build treats `skillcheck-PRD.md` as the authoritative v2 PRD.
- The workspace did not contain a Git repository. Initialized a local repo so the "commit after each milestone" rule can be satisfied once a milestone gate actually passes.
- M0 understanding: before M1, build only a hardcoded measurement spike with one fixed skill, fixed tasks, A/B runner at `K=3`, deterministic pass/fail checks, paired bootstrap 95% CI, and stdout output. Do not implement independent task generation, blind LLM grading, cache, eval, verify, corpus, leaderboard, or rot until M0 gates pass.
- M0 hardcoded skill domain: a private canary SKU checksum rule. This keeps the skill body valuable when injected and keeps the no-skill arm intentionally under-specified. This is acceptable for M0 only because M0 uses hardcoded tasks to prove the scoring harness before the fairness machinery exists.
- M0 bootstrap unit: paired `(with_skill, no_skill)` observations per task/trial. Resampling pairs preserves task/trial covariance and directly estimates the mean pass-rate delta.
- Verified NVIDIA Build model slugs on 2026-06-03:
  - Generator: `stepfun-ai/step-3.7-flash` from `https://build.nvidia.com/stepfun-ai/step-3.7-flash`
  - Grader: `stepfun-ai/step-3.7-flash` from `https://build.nvidia.com/stepfun-ai/step-3.7-flash`
  - Runner: `deepseek-ai/deepseek-v4-flash` from `https://build.nvidia.com/deepseek-ai/deepseek-v4-flash`
- Model slug verification plan: before every live corpus run, re-check the three env-var model IDs against build.nvidia.com and record the date, exact slug, and source URL here.
- The code reads model IDs only from env vars (`NVIDIA_GENERATOR_MODEL`, `NVIDIA_GRADER_MODEL`, `NVIDIA_RUNNER_MODEL`) to preserve the no-hardcoded-model-ID requirement. The verified slugs are documented here and in `.env.example`, not embedded in runtime code.
- After live M0 attempts hit NVIDIA transport instability and HTTP 429 responses, the NVIDIA adapter now supports request pacing via `NVIDIA_REQUEST_DELAY_MS` with a conservative default. This changes only call scheduling, not trial count, task count, scoring, CI width, or gate thresholds.
- The user changed `NVIDIA_RUNNER_MODEL` in `.env` from `deepseek-ai/deepseek-v4-flash` to `mistralai/mistral-small-4-119b-2603` and set `NVIDIA_REQUEST_DELAY_MS=1500` to match a stated 40 RPM capacity. This is treated as an env-driven runner swap for M0 because the PRD requires model IDs to be env-configurable. Verified slug on 2026-06-03 from `https://build.nvidia.com/mistralai/mistral-small-4-119b-2603`.
