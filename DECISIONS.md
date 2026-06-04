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
- M1 corpus source ambiguity: cloning `sx4im/awesome-claude-md` returned GitHub 404/auth, while public indexes expose `awesome-claude-md` under other owners. Use `jnMetaCode/awesome-claude-md` for the M1 gate as the simplest accessible public repo matching the requested corpus name, and record the exact commit in `BUILD-LOG.md`.
- M1 format ambiguity: the accessible `awesome-claude-md` corpus contains `CLAUDE.md` files, while the PRD lists `SKILL.md`, `AGENTS.md`, and `.cursorrules` as required v1 formats. Add `CLAUDE.md` as a minimal alias format so the explicit M1 gate can run against the requested corpus without changing scoring, generation, or grading behavior.
- M1 gate task count: use `skillcheck eval --tasks 2 --trials 3` for the first 5-skill `awesome-claude-md` gate. The PRD explicitly allows `--tasks`; the trial count stays at K=3. This keeps the initial live gate feasible under the observed NVIDIA rate limits while preserving the M1 stability check.
- Step 3.7 Flash returned reasoning traces instead of final JSON for generation/grading. NVIDIA's Step 3.7 Flash docs say to disable reasoning with `chat_template_kwargs: { "thinking": false }`; add adapter support for that field and use it on generator/grader calls.
- M2 deterministic gate uses a committed fixed task suite via `skillcheck eval --task-suite <file>`. Public leaderboard methodology still relies on independent task generation; the fixed suite exists to prove deterministic assertion support and `verify` without depending on generator behavior for the known-strong/empty control gate.
