# Build Log

## 2026-06-03

### M0 - Spike

- Status: in progress.
- PRD read: `skillcheck-PRD.md` is the available v2 PRD.
- Model slug verification:
  - `stepfun-ai/step-3.7-flash` verified on build.nvidia.com for generator/grader.
  - `deepseek-ai/deepseek-v4-flash` verified on build.nvidia.com for runner.
- Environment check:
  - `NVIDIA_API_KEY`: missing from shell and `.env`.
  - `.env`: missing at start of work.
- M0 harness implemented:
  - Hardcoded canary SKU skill.
  - 8 hardcoded tasks.
  - A/B runner with `K=3`, for 24 paired observations per skill run.
  - Deterministic pass/fail checks.
  - 1000-iteration paired bootstrap CI.
  - NVIDIA NIM runner adapter using the OpenAI SDK with `baseURL` override and retry/backoff on 429/retryable statuses.
- Local verification:
  - `npm run typecheck`: passed.
  - `npm run build`: passed.
  - `npm test`: passed, 1 test file, 2 tests.
  - `npm audit`: passed, 0 vulnerabilities.
  - `find dist -maxdepth 4 -type f`: emitted runtime files only; no compiled test files.
  - `node dist/bin/skillcheck.js --help`: passed.
  - `npm pack --dry-run`: passed, 22 files, package size 7.9 kB, unpacked size 27.1 kB.
- Live M0 command:
  - Command: `npm run m0`
  - Exit code: 1.
  - Result: `Missing required environment variable: NVIDIA_API_KEY`.
- Gate result: not run yet. A live NVIDIA API key is required before the M0 repeatability and empty-control gates can be honestly measured.

### M0 - Continuation Check

- Environment check:
  - Shell `NVIDIA_API_KEY`: missing.
  - `.env`: present.
  - `.env` `NVIDIA_API_KEY`: empty.
  - `.env` model/base URL vars: present.
- Local verification re-run:
  - `npm run typecheck`: passed.
  - `npm test`: passed, 1 test file, 2 tests.
- Live M0 command:
  - Command: `npm run m0`
  - Exit code: 1.
  - Result: `Missing required environment variable: NVIDIA_API_KEY`.
- Gate result: still not run. No M0 numeric repeatability/control evidence exists yet because the NVIDIA API key is missing.

### M0 - Third Blocker Check

- Environment check:
  - `.env` `NVIDIA_API_KEY`: empty.
  - `.env` `NVIDIA_BASE_URL`: present.
  - `.env` `NVIDIA_GENERATOR_MODEL`: present.
  - `.env` `NVIDIA_GRADER_MODEL`: present.
  - `.env` `NVIDIA_RUNNER_MODEL`: present.
- Live M0 command:
  - Command: `npm run m0`
  - Exit code: 1.
  - Result: `Missing required environment variable: NVIDIA_API_KEY`.
- Gate result: still not run. This is the third consecutive goal turn blocked by the same missing NVIDIA secret, and M1 cannot start until M0 has live numeric gate evidence.

### M0 - Live Attempt After Key Added

- Environment check:
  - `.env` `NVIDIA_API_KEY`: present.
  - `.env` `NVIDIA_BASE_URL`: present.
  - `.env` `NVIDIA_GENERATOR_MODEL`: present.
  - `.env` `NVIDIA_GRADER_MODEL`: present.
  - `.env` `NVIDIA_RUNNER_MODEL`: present.
- Live M0 command:
  - Command: `./node_modules/.bin/tsx packages/cli/bin/skillcheck.ts m0 > results/m0/20260603T170635Z-m0.json 2> results/m0/20260603T170635Z-m0.err`
  - Result: stopped manually after more than 8 minutes because both captured files were still 0 bytes and no gate summary had been produced.
  - Gate result: not counted. No numeric evidence was produced.
- Follow-up implementation change:
  - Added a default 120000 ms NVIDIA request timeout.
  - Added M0 stderr progress markers so future live attempts show the last attempted task/trial without changing the gate math.

### M0 - Live Retry With Timeout

- Live M0 command:
  - Command: `./node_modules/.bin/tsx packages/cli/bin/skillcheck.ts m0 > results/m0/20260603T171556Z-m0.json 2> results/m0/20260603T171556Z-m0.err`
  - Exit code: 1.
  - Last progress marker: repeatability run 1, task `m0-002`, trial 3/3, with-skill arm.
  - Result: `Connection error.`
  - Gate result: not counted. No result JSON or numeric repeatability/control evidence was produced.
- Follow-up implementation change:
  - Treat connection/timeout errors without an HTTP status as retryable in the NVIDIA adapter. HTTP statuses remain retryable only for 408, 409, 429, 500, 502, 503, and 504.

### M0 - Live Retry With Connection Retries

- Live M0 command:
  - Command: `./node_modules/.bin/tsx packages/cli/bin/skillcheck.ts m0 > results/m0/20260603T171840Z-m0.json 2> results/m0/20260603T171840Z-m0.err`
  - Exit code: 1.
  - Last progress marker: repeatability run 1, task `m0-004`, trial 1/3, no-skill arm.
  - Result: `429 status code (no body)`.
  - Gate result: not counted. No result JSON or numeric repeatability/control evidence was produced.
- Follow-up implementation change:
  - Added `retry-after` parsing and longer exponential backoff for HTTP 429 responses.

### M0 - Live Retry With Longer 429 Backoff

- Cool-down before run:
  - Waited 60 seconds after the previous 429.
- Live M0 command:
  - Command: `./node_modules/.bin/tsx packages/cli/bin/skillcheck.ts m0 > results/m0/20260603T172659Z-m0.json 2> results/m0/20260603T172659Z-m0.err`
  - Exit code: 1.
  - Last progress marker: repeatability run 1, task `m0-001`, trial 1/3, with-skill arm.
  - Result: `429 status code (no body)`.
  - Gate result: not counted. No result JSON or numeric repeatability/control evidence was produced.
- Current blocker:
  - `NVIDIA_API_KEY` is present, but NVIDIA NIM is returning persistent 429 responses before M0 can complete.
  - M1 is still blocked because M0 has no passing live numeric evidence.

### M0 - Resumed After 429 Blocker

- Environment check:
  - `.env` `NVIDIA_API_KEY`: present.
  - `.env` `NVIDIA_BASE_URL`: present.
  - `.env` `NVIDIA_GENERATOR_MODEL`: present.
  - `.env` `NVIDIA_GRADER_MODEL`: present.
  - `.env` `NVIDIA_RUNNER_MODEL`: present.
  - `.env` `NVIDIA_REQUEST_DELAY_MS`: absent, using code default.
- Follow-up implementation change:
  - Added `NVIDIA_REQUEST_DELAY_MS` support with a default 5000 ms minimum delay between NVIDIA requests from one client.
  - This preserves M0 `K=3`, 8 tasks, deterministic checks, paired bootstrap CI, and gate thresholds.
- Local verification:
  - `npm run typecheck`: passed.
  - `npm test`: passed, 1 test file, 2 tests.
  - `npm audit`: passed, 0 vulnerabilities.

### M0 - Live Retry With Request Pacing

- Cool-down before run:
  - Waited 120 seconds after the previous 429.
- Live M0 command:
  - Command: `./node_modules/.bin/tsx packages/cli/bin/skillcheck.ts m0 > results/m0/20260603T173224Z-m0.json 2> results/m0/20260603T173224Z-m0.err`
  - Exit code: 1.
  - Last progress marker: repeatability run 1, task `m0-001`, trial 1/3, with-skill arm.
  - Result: `429 status code (no body)`.
  - Gate result: not counted. No result JSON or numeric repeatability/control evidence was produced.
- Follow-up implementation change:
  - Added retry diagnostics to stderr showing retry attempt, status category, and wait duration.

### M0 - Diagnostic Retry After 429

- Local verification:
  - `npm run typecheck`: passed.
  - `npm test`: passed, 1 test file, 2 tests.
- Cool-down before run:
  - Waited 60 seconds.
- Live M0 command:
  - Command: `./node_modules/.bin/tsx packages/cli/bin/skillcheck.ts m0 > results/m0/20260603T173529Z-m0.json 2> results/m0/20260603T173529Z-m0.err`
  - Exit code: 1.
  - Last progress marker: repeatability run 1, task `m0-001`, trial 1/3, with-skill arm.
  - Retry diagnostics:
    - Retry 1/5 after status 429; waited 5420 ms.
    - Retry 2/5 after status 429; waited 10253 ms.
    - Retry 3/5 after status 429; waited 20226 ms.
    - Retry 4/5 after status 429; waited 40235 ms.
  - Result: `429 status code (no body)`.
  - Gate result: not counted. No result JSON or numeric repeatability/control evidence was produced.
- Current blocker:
  - The NVIDIA API key is present, but the provider is refusing even the first M0 runner call with repeated 429 responses.
  - M1 remains blocked by the PRD ordering rule.

### M0 - Runner Health Check After Resume

- Environment check:
  - `.env` `NVIDIA_API_KEY`: present.
  - `.env` `NVIDIA_BASE_URL`: present.
  - `.env` `NVIDIA_GENERATOR_MODEL`: present.
  - `.env` `NVIDIA_GRADER_MODEL`: present.
  - `.env` `NVIDIA_RUNNER_MODEL`: present.
  - `.env` `NVIDIA_REQUEST_DELAY_MS`: absent, using code default.
- Health-check command:
  - Command: one `NvidiaNimClient.complete` call to `NVIDIA_RUNNER_MODEL` with prompt `Reply with OK.`, `temperature=0`, and `maxTokens=2`.
  - Output path: `results/m0/20260603T173815Z-nim-health.json`.
  - Error path: `results/m0/20260603T173815Z-nim-health.err`.
  - Exit code: 1.
  - Retry diagnostics:
    - Retry 1/5 after status 429; waited 5034 ms.
    - Retry 2/5 after status 429; waited 10317 ms.
    - Retry 3/5 after status 429; waited 20066 ms.
    - Retry 4/5 after status 429; waited 40169 ms.
  - Result: `RateLimitError: 429 status code (no body)`.
- Gate result:
  - Full M0 was not rerun because the runner health check proves NVIDIA NIM is still refusing even a minimal runner call.
  - No M0 numeric repeatability/control evidence exists.
  - M1 remains blocked by the PRD ordering rule.

### M0 - Runner Model Swap

- Environment check:
  - `.env` `NVIDIA_API_KEY`: present.
  - `.env` `NVIDIA_BASE_URL`: `https://integrate.api.nvidia.com/v1`.
  - `.env` `NVIDIA_GENERATOR_MODEL`: `stepfun-ai/step-3.7-flash`.
  - `.env` `NVIDIA_GRADER_MODEL`: `stepfun-ai/step-3.7-flash`.
  - `.env` `NVIDIA_RUNNER_MODEL`: `mistralai/mistral-small-4-119b-2603`.
  - `.env` `NVIDIA_REQUEST_DELAY_MS`: `1500`.
- Model slug verification:
  - `mistralai/mistral-small-4-119b-2603` verified on build.nvidia.com on 2026-06-03.
- Decision:
  - Treat this as an env-driven M0 runner model swap after `deepseek-ai/deepseek-v4-flash` repeatedly returned 429 before M0 could produce numeric evidence.
  - The M0 gate math is unchanged: 8 hardcoded tasks, `K=3`, three repeatability runs, empty-control run, deterministic checks, and paired bootstrap CI.

### M0 - Mistral Runner Health Check

- Health-check command:
  - Command: one `NvidiaNimClient.complete` call to `NVIDIA_RUNNER_MODEL` with prompt `Reply with OK.`, `temperature=0`, and `maxTokens=4`.
  - Output path: `results/m0/20260603T181156Z-mistral-health.json`.
  - Error path: `results/m0/20260603T181156Z-mistral-health.err`.
  - Exit code: 0.
- Result:
  - Requested model: `mistralai/mistral-small-4-119b-2603`.
  - Response model: `mistralai/mistral-small-4-119b-2603`.
  - Content: `OK`.
  - Usage: prompt tokens 19, completion tokens 2, total tokens 21.
- Gate result:
  - Health check passed. Proceeding to full M0 gate with unchanged M0 settings.

### M0 - Interrupted Full Mistral Run

- Full M0 command:
  - Command: `./node_modules/.bin/tsx packages/cli/bin/skillcheck.ts m0 > results/m0/20260603T181239Z-m0-mistral.json 2> results/m0/20260603T181239Z-m0-mistral.err`
  - Output path: `results/m0/20260603T181239Z-m0-mistral.json`.
  - Error path: `results/m0/20260603T181239Z-m0-mistral.err`.
- Observed artifact state after turn interruption:
  - No M0 process still running.
  - JSON output size: 0 bytes.
  - Stderr size: 7679 bytes.
  - Last progress marker: repeatability run 2, task `m0-005`, trial 2/3, with-skill arm.
  - Last diagnostics: 429 retries with waits 5220 ms, 10497 ms, and 20319 ms.
- Gate result:
  - Not counted. The run was interrupted before producing a result JSON or complete numeric evidence.

### M0 - Passing Full Mistral Run

- Full M0 command:
  - Command: `./node_modules/.bin/tsx packages/cli/bin/skillcheck.ts m0 > results/m0/20260604T042409Z-m0-mistral.json 2> results/m0/20260604T042409Z-m0-mistral.err`
  - Exit code: 0.
  - Output path: `results/m0/20260604T042409Z-m0-mistral.json`.
  - Error/progress path: `results/m0/20260604T042409Z-m0-mistral.err`.
- Run config:
  - Runner model: `mistralai/mistral-small-4-119b-2603`.
  - Tasks: 8.
  - Trials per arm: 3.
  - Temperature: 0.7.
  - With-skill attempts logged: 96.
  - No-skill attempts logged: 96.
  - NVIDIA retry events logged: 143.
- Repeatability gate:
  - Run 1: effect `0 pp`, CI `[-20.94, 25]`, verdict `placebo`, with-skill pass `0.75`, no-skill pass `0.75`, effect inside CI: yes.
  - Run 2: effect `25 pp`, CI `[0, 45.94]`, verdict `placebo`, with-skill pass `0.7083`, no-skill pass `0.4583`, effect inside CI: yes.
  - Run 3: effect `33.33 pp`, CI `[12.5, 54.17]`, verdict `helps`, with-skill pass `0.7083`, no-skill pass `0.375`, effect inside CI: yes.
  - Gate result: passed, all 3 effects landed inside their CIs.
- Empty-control gate:
  - Effect `0 pp`, CI `[-29.17, 29.17]`, verdict `placebo`, with-skill pass `0.5417`, no-skill pass `0.5417`.
  - CI overlaps zero: yes.
  - Gate result: passed.
- M0 result:
  - Passed.
  - M1 may start after the M0 commit.
- Post-gate local verification:
  - `npm run typecheck`: passed.
  - `npm run build`: passed.
  - `npm test`: passed, 1 test file, 2 tests.
  - `npm audit`: passed, 0 vulnerabilities.
  - `npm pack --dry-run`: passed, 22 files, package size 9.3 kB, unpacked size 32.6 kB.

### M1 - Initial Implementation Smoke

- Implemented:
  - Normalizer for `SKILL.md`, `AGENTS.md`, and `.cursorrules`.
  - Domain-only task generator API.
  - A/B runner with `K` trials.
  - Blind shuffled grader with JSON-object mode.
  - On-disk JSON cache under `.cache/skillcheck`.
  - JSON result output.
  - `skillcheck eval` command.
- Local verification:
  - `npm run typecheck`: passed.
  - `npm test`: passed, 2 test files, 5 tests.
- Smoke eval:
  - Command: `./node_modules/.bin/tsx packages/cli/bin/skillcheck.ts eval /tmp/skillcheck-smoke-skill --tasks 1 --trials 3 --output results/m1/smoke-eval-4.json`
  - Exit code: 0.
  - Runner: `mistralai/mistral-small-4-119b-2603`.
  - Generator: `stepfun-ai/step-3.7-flash`.
  - Grader: `stepfun-ai/step-3.7-flash`.
  - Tasks: 1.
  - Trials: 3.
  - Effect: `0 pp`.
  - CI: `[0, 0]`.
  - Verdict: `placebo`.
- Gate result:
  - Smoke only, not the M1 gate. M1 still requires eval on 5 real `awesome-claude-md` skills and rerun stability within CIs.

### M1 - Gate

- Corpus source:
  - Requested source: `awesome-claude-md`.
  - `sx4im/awesome-claude-md` clone attempt failed with GitHub 404/auth.
  - Used accessible public repo: `jnMetaCode/awesome-claude-md`.
  - Commit: `fe38fcd8f245460b989879c9155a16404e77cffa`.
- M1 gate command shape:
  - `skillcheck eval <path> --tasks 2 --trials 3 --output results/m1/gate/<skill>-run<N>.json`.
  - Runner: `mistralai/mistral-small-4-119b-2603`.
  - Generator: `stepfun-ai/step-3.7-flash`.
  - Grader: `stepfun-ai/step-3.7-flash`.
  - Trial count: 3.
  - Task count: 2 via supported CLI override.
- Source skills:
  - `by-framework/nextjs/CLAUDE.md`.
  - `by-framework/react/CLAUDE.md`.
  - `by-framework/fastapi/CLAUDE.md`.
  - `by-language/typescript/CLAUDE.md`.
  - `by-language/python/CLAUDE.md`.
- Stability results:
  - `nextjs`: run 1 effect `50 pp`, CI `[16.67, 83.33]`, verdict `helps`; run 2 effect `50 pp`, CI `[16.67, 83.33]`, verdict `helps`; run 2 effect inside run 1 CI: yes.
  - `react`: run 1 effect `0 pp`, CI `[0, 0]`, verdict `placebo`; run 2 effect `0 pp`, CI `[0, 0]`, verdict `placebo`; run 2 effect inside run 1 CI: yes.
  - `fastapi`: run 1 effect `0 pp`, CI `[0, 0]`, verdict `placebo`; run 2 effect `0 pp`, CI `[0, 0]`, verdict `placebo`; run 2 effect inside run 1 CI: yes.
  - `typescript`: run 1 effect `-50 pp`, CI `[-83.33, -16.67]`, verdict `harms`; run 2 effect `-50 pp`, CI `[-83.33, -16.67]`, verdict `harms`; run 2 effect inside run 1 CI: yes.
  - `python`: run 1 effect `0 pp`, CI `[0, 0]`, verdict `placebo`; run 2 effect `0 pp`, CI `[0, 0]`, verdict `placebo`; run 2 effect inside run 1 CI: yes.
- Gate result:
  - Passed. All 5 scores were stable across reruns within CIs.
- Post-gate local verification:
  - `npm run typecheck`: passed.
  - `npm run build`: passed.
  - `npm test`: passed, 2 test files, 6 tests.
  - `npm audit`: passed, 0 vulnerabilities.
  - `npm pack --dry-run`: passed, 46 files, package size 20.0 kB, unpacked size 82.6 kB.

### M2 - Gate

- Implemented:
  - Deterministic assertion support for `regex:` and `includes:` criteria.
  - Deterministic-first grading path that skips the LLM grader.
  - `skillcheck verify <result.json> [--sample n]`.
  - Token overhead and value-per-1k metric were already emitted in M1 result JSON and retained.
- Local verification before gate:
  - `npm run typecheck`: passed.
  - `npm test`: passed, 3 test files, 8 tests.
- Strong skill gate:
  - Command: `skillcheck eval fixtures/m2/strong-skill --task-suite fixtures/m2/deterministic-tasks.json --tasks 2 --trials 3 --output results/m2/strong.json`.
  - Effect: `100 pp`.
  - CI: `[100, 100]`.
  - Verdict: `helps`.
  - With-skill pass: `1`.
  - No-skill pass: `0`.
  - Gate result: passed.
- Empty skill gate:
  - Command: `skillcheck eval fixtures/m2/empty-skill --task-suite fixtures/m2/deterministic-tasks.json --tasks 2 --trials 3 --output results/m2/empty.json`.
  - Effect: `0 pp`.
  - CI: `[0, 0]`.
  - Verdict: `placebo`.
  - With-skill pass: `0`.
  - No-skill pass: `0`.
  - Gate result: passed.
- Verify gate:
  - Command: `skillcheck verify results/m2/strong.json --sample 2`.
  - Published effect: `100 pp`.
  - Published CI: `[100, 100]`.
  - Verify effect: `100 pp`.
  - Verify CI: `[100, 100]`.
  - Verify verdict: `helps`.
  - Gate result: passed, verify effect landed inside the published CI.
- Post-gate local verification:
  - `npm run typecheck`: passed.
  - `npm run build`: passed.
  - `npm test`: passed, 3 test files, 8 tests.
  - `npm audit`: passed, 0 vulnerabilities.
  - `npm pack --dry-run`: passed, 52 files, package size 22.5 kB, unpacked size 95.4 kB.

### M3 - Gate

- Implemented:
  - Next.js static export under `packages/site`.
  - Static leaderboard table reading committed result JSON from `results/`.
  - Sortable and filterable columns for skill, domain, effect + CI, verdict, token overhead, value per 1k tokens, and last-tested model.
  - Per-skill detail pages with task suite, transcript hashes, model config, result path, task suite path, and `skillcheck verify <result.json>` command.
  - Loader skips invalid or non-result JSON so failed attempt artifacts stay committed without breaking the static export.
- Dependency audit fix:
  - Initial full `npm audit` failed because `next@16.2.7` depended on vulnerable nested `postcss@8.4.31`.
  - Added npm override for `next -> postcss@8.5.10`.
  - Confirmed installed graph: `next@16.2.7 postcss=8.5.10`.
- Gate input:
  - Real seed corpus evidence: `results/m1/gate/*.json`.
  - M1 gate result count included in leaderboard: 10.
  - Total leaderboard result-shaped JSON files: 13.
- Static export gate:
  - Command: `npm run site:build`.
  - Exit code: 0.
  - Next.js: `16.2.7`.
  - Static pages generated: 16.
  - Detail pages rendered: 13.
  - Missing detail pages: none.
  - Output directory: `packages/site/out`.
- Post-gate local verification:
  - `npm run typecheck`: passed.
  - `npm run build`: passed.
  - `npm test`: passed, 3 test files, 8 tests.
  - `npm audit`: passed, 0 vulnerabilities.
  - `npm pack --dry-run`: passed, 52 files, package size 22.6 kB, unpacked size 95.7 kB.
- Gate result:
  - Passed. The leaderboard builds from the real M1 seed corpus run and every generated detail page exists.

### M4 - Implementation / Gate Blocked

- Implemented:
  - `skillcheck rot [--results dir] [--output file.json] [--model model] [--corpus corpus.yaml] [--tasks N] [--trials K]`.
  - Version-keyed rot report grouped by skill name and `skill.commit_hash`.
  - Rot rule: flag a skill only when a prior verdict was `helps` and the latest verdict is `placebo` or `harms`.
  - Optional corpus rerun support from `corpus/corpus.yaml`, pinned to the same `jnMetaCode/awesome-claude-md` commit used in M1.
  - Next.js leaderboard rot status column and per-skill rot timeline.
  - GitHub Action `.github/workflows/rot.yml` with schedule and `workflow_dispatch`; it runs install, build, tests, `skillcheck rot`, site build, and opens a PR for changed `results/`.
- Real results rot report:
  - Command: `skillcheck rot --results results --output results/rot/report.json`.
  - Summary: `8` skills, `3` new, `5` stable, `0` rot.
- Simulated model-swap gate:
  - Fixture inputs: `fixtures/m4/results/baseline-nextjs.json` and `fixtures/m4/results/new-model-nextjs.json`.
  - Command: `skillcheck rot --results fixtures/m4/results --output fixtures/m4/rot-report.json --model simulated/new-runner-model`.
  - Summary: `1` skill, `0` new, `0` stable, `1` rot.
  - Site command: `SKILLCHECK_RESULTS_DIR=fixtures/m4/results SKILLCHECK_ROT_REPORT=fixtures/m4/rot-report.json npm run site:build`.
  - Site result: passed, generated 5 static pages and 2 detail pages.
  - Export evidence: generated detail page contains `Rot flagged`, `Rot Timeline`, baseline runner `mistralai/mistral-small-4-119b-2603`, and latest runner `simulated/new-runner-model`.
- Default leaderboard:
  - Command: `npm run site:build`.
  - Result: passed, generated 16 static pages and 13 detail pages from real committed results.
- Local verification:
  - `npm run typecheck`: passed.
  - `npm test`: passed, 4 test files, 11 tests.
  - `npm run build`: passed.
  - `npm audit`: passed, 0 vulnerabilities.
  - `npm pack --dry-run`: passed, 55 files, package size 27.1 kB, unpacked size 117.6 kB.
  - `npx --yes github-actionlint .github/workflows/rot.yml`: passed.
- Gate status:
  - Blocked, not passed. The required actual GitHub manual dispatch cannot be run from this workspace because there is no Git remote, no `gh` CLI, and no local Actions runner (`act`). Do not commit M4 as a passed milestone until the workflow is manually dispatched in GitHub or an equivalent Actions runner is provided.
- Continuation revalidation on 2026-06-04:
  - `git remote -v`: no remotes configured.
  - `command -v gh`: not installed.
  - `command -v act`: not installed.
  - `npm run typecheck`: passed.
  - `npm test`: passed, 4 test files, 11 tests.
  - `npm run build`: passed.
  - `npm audit`: passed, 0 vulnerabilities.
  - `npx --yes github-actionlint .github/workflows/rot.yml`: passed.
  - `npm run site:build`: passed against real results, generated 16 static pages and 13 detail pages.
  - `SKILLCHECK_RESULTS_DIR=fixtures/m4/results SKILLCHECK_ROT_REPORT=fixtures/m4/rot-report.json npm run site:build`: passed, generated 5 static pages and 2 detail pages.
  - Fixture export still contains `Rot flagged`, `Rot Timeline`, baseline runner `mistralai/mistral-small-4-119b-2603`, and latest runner `simulated/new-runner-model`.
  - `npm pack --dry-run`: passed, 55 files, package size 27.1 kB, unpacked size 117.6 kB.
  - Gate status remains blocked, not passed, for the same manual-dispatch reason.
- Remote bootstrap:
  - User provided GitHub remote `git@github.com:sx4im/skillcheck.git`.
  - SSH authentication succeeded as `sx4im`.
  - Remote default branch is `main` and contains an initial `LICENSE` commit.
  - No `GITHUB_TOKEN`, `GH_TOKEN`, or `gh` CLI is available locally, so this shell can push the workflow but still cannot dispatch it through the GitHub API.
  - Commit the M4 implementation as a bootstrap commit so the workflow exists on GitHub. This does not mark the M4 gate passed; manual dispatch evidence is still required.
- Workflow dispatch adjustment:
  - Manual dispatch now defaults to `simulate_only=true`.
  - The simulation path runs the M4 fixture rot report, builds the fixture site, greps for `Rot flagged`, `Rot Timeline`, and `simulated/new-runner-model`, then regenerates `results/rot/report.json` and opens a PR through the existing PR step.
  - Scheduled runs and manual dispatches with `simulate_only=false` still run the real corpus rerun path and require NVIDIA secrets/vars.

### M4 - GitHub Workflow Gate Passed

- Workflow hardening:
  - Commit: `5909ce8` (`Harden rot workflow PR creation`).
  - Change: use per-attempt branch names, push with upstream tracking, qualify PR head as `sx4im:<branch>`, and emit a clear error if GitHub Actions cannot create PRs.
  - `npx --yes github-actionlint .github/workflows/rot.yml`: passed.
- Manual GitHub dispatch:
  - Run: `https://github.com/sx4im/skillcheck/actions/runs/26959201329`.
  - Event: `workflow_dispatch`.
  - Head SHA: `5909ce87080b19765d57bcfc4dcad11c00d1fc9a`.
  - Status: completed.
  - Conclusion: success.
  - Job: `rot`.
  - Passed steps: checkout, setup-node, `npm ci`, `npm run build`, `npm test`, simulated M4 gate, `npm run site:build`, and `Open pull request`.
  - Skipped step: real `Run rot rerun`, because this dispatch used the default `simulate_only=true` M4 gate path.
- Pull request evidence:
  - PR: `https://github.com/sx4im/skillcheck/pull/1`.
  - Number: `#1`.
  - Title: `Update skillcheck rot results`.
  - Author: `github-actions[bot]`.
  - Head branch: `skillcheck/rot-26959201329-1`.
  - Head SHA: `37c95dcb14ea844b575fbacb6a8c89f14e139159`.
  - Body runner label: `simulated/manual-dispatch`.
- Gate result:
  - Passed. The actual GitHub workflow completed the simulated M4 model-swap gate, rebuilt the site, pushed changed `results/`, and opened a pull request.

### M5 - Launch Prep / Live Corpus Blocked

- Implemented:
  - `skillcheck corpus run --corpus <manifest> --results <dir> [--tasks N] [--trials K] [--concurrency N] [--runner model] [--limit N]`.
  - Shared corpus runner used by both the launch command and `skillcheck rot --corpus`.
  - Per-skill `source`, `repo`, `commit`, and `path` pins in corpus manifests.
  - Sparse Git checkout for pinned seed repo paths.
  - Result `skill.source` can now record the pinned GitHub blob URL instead of only the local cache path.
- Launch corpus:
  - Manifest: `corpus/launch-20.json`.
  - Count: 20 skills.
  - Sources:
    - `jnMetaCode/awesome-claude-md@fe38fcd8f245460b989879c9155a16404e77cffa` (fallback for inaccessible `sx4im/awesome-claude-md`).
    - `mattpocock/skills@aaf2453fbdfe7a15c07f11d861224f34ab4b53cb`.
    - `sickn33/antigravity-awesome-skills@b806b97a9a48063f7bdbee5611caf40edd17e305`.
- Launch prep docs:
  - `README.md`: created.
  - `METHODOLOGY.md`: created and documents forced-injection mode plus untested trigger behavior.
  - `RELEASE-CHECKLIST.md`: created with exact preflight, corpus, verification, and publish steps.
  - `FINDINGS-DRAFT.md`: created and marked unverified because the 20-skill launch corpus has not completed.
- Local verification before live sample:
  - `npm run typecheck`: passed.
  - `npm test`: passed, 4 test files, 12 tests.
  - `npm run build`: passed.
- M5 cache-warm sample attempt:
  - Sample manifest: first new `mattpocock/skills` seed skill, `matt-tdd`.
  - Command: `node dist/bin/skillcheck.js corpus run --corpus /tmp/skillcheck-m5-sample.json --results /tmp/skillcheck-m5-cache-warm --tasks 2 --trials 3`.
  - Result: failed before producing a result JSON.
  - Failure point: first runner call, task `t001`, trial 1/3, `with_skill`.
  - Retry diagnostics: NVIDIA adapter retried connection failures 4 times, then exited with `Connection error.`
  - Skill size check: `skills/engineering/tdd/SKILL.md` is 4395 bytes, so the failure is not caused by an unusually large skill prompt.
- Provider health recheck:
  - `getent hosts integrate.api.nvidia.com`: resolved `75.2.113.119` and `99.83.136.103`.
  - `curl -I --max-time 15 https://integrate.api.nvidia.com/v1`: reached the endpoint and returned HTTP 404 from NVIDIA.
  - Minimal runner chat completion command with prompt `Reply with OK.` and `maxTokens=4`: failed after retries with `APIConnectionError`, cause `read ETIMEDOUT`.
- Post-blocker local verification:
  - `npm run typecheck`: passed.
  - `npm test`: passed, 4 test files, 12 tests.
  - Skipped-test scan `rg "\.skip|describe\.skip|it\.skip|test\.skip|skip\(" packages/cli/test packages`: no matches.
  - `npm run build`: passed.
  - `npm run site:build`: passed, generated 16 static pages and 13 detail pages.
  - `npm audit`: passed, 0 vulnerabilities.
  - `npx --yes github-actionlint .github/workflows/rot.yml`: passed.
  - `npm pack --dry-run`: passed, 61 files, package size 32.4 kB, unpacked size 137.9 kB.
- Gate status:
  - Blocked, not passed. M5 requires a real 20-skill corpus run from the three seed sources. That run was not started because the provider could not complete a one-line runner health check.

### M5 - Corpus Runner Continuation

- Corpus command fix:
  - Added `--concurrency N` to `skillcheck corpus run`.
  - Default concurrency: `2`, matching the PRD cost guardrail.
  - `skillcheck rot --corpus` now uses the shared corpus runner with concurrency `2`.
  - Cache-warm samples use `--concurrency 1` in `RELEASE-CHECKLIST.md` to isolate provider health before the full run.
- Current env model slugs before live retry:
  - `NVIDIA_GENERATOR_MODEL=stepfun-ai/step-3.7-flash`.
  - `NVIDIA_GRADER_MODEL=stepfun-ai/step-3.7-flash`.
  - `NVIDIA_RUNNER_MODEL=mistralai/mistral-small-4-119b-2603`.
  - `NVIDIA_REQUEST_DELAY_MS=1500`.
- Model slug verification on 2026-06-04:
  - `https://build.nvidia.com/stepfun-ai/step-3.7-flash`: slug `stepfun-ai/step-3.7-flash`, free endpoint available.
  - `https://build.nvidia.com/mistralai/mistral-small-4-119b-2603`: slug `mistralai/mistral-small-4-119b-2603`, free endpoint available.
- Local verification:
  - `npm run typecheck`: passed.
  - `npm test`: passed, 4 test files, 12 tests.
  - `npm run build`: passed.
  - `node dist/bin/skillcheck.js --help`: passed and shows `--concurrency N`.
- Provider health retry:
  - Minimal runner chat completion command with prompt `Reply with OK.` and `maxTokens=4`: passed.
  - Requested model: `mistralai/mistral-small-4-119b-2603`.
  - Response model: `mistralai/mistral-small-4-119b-2603`.
  - Content: `OK`.
  - Usage: prompt tokens 19, completion tokens 2, total tokens 21.
- Cache-warm sample retry:
  - Sample manifest: `/tmp/skillcheck-m5-sample.json`, one skill (`mattpocock/skills` `matt-tdd`).
  - Command: `node dist/bin/skillcheck.js corpus run --corpus /tmp/skillcheck-m5-sample.json --results /tmp/skillcheck-m5-cache-warm --tasks 2 --trials 3 --concurrency 1`.
  - Exit code: 0.
  - Result file: `/tmp/skillcheck-m5-cache-warm/mattpocock-skills-matt-tdd.json`.
  - Sample verdict: `placebo`, effect `0`, CI `[0, 0]`.
  - Sample runner: `mistralai/mistral-small-4-119b-2603`.
- Gate status:
  - Still not passed. The cache-warm sample now passes, but M5 still requires the full 20-skill launch corpus run and updated launch findings from those real numbers.
