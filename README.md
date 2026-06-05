# skillcheck

Measure whether an agent skill actually improves task performance.

`skillcheck` runs a forced-injection A/B evaluation: the runner model solves generated tasks with and without the skill instructions, then the result is scored as an effect in percentage points with a bootstrap confidence interval.

## Status

- M0-M4 gates have passed and are recorded in `BUILD-LOG.md`.
- M5 completed a 20-skill launch corpus in `results/launch/20260605T110514Z-qwen-next`.
- The launch used `qwen/qwen3-next-80b-a3b-instruct` for generator, grader, and runner after direct NVIDIA diagnostics showed the original StepFun, DeepSeek, and Mistral stack was not reliable enough to complete the corpus.
- Do not publish to npm until `RELEASE-CHECKLIST.md` is complete.

## One-Line Install

Install the CLI from this GitHub repo:

```bash
npm install -g git+ssh://git@github.com/sx4im/skillcheck.git
```

After npm publication, the install command becomes:

```bash
npm install -g skillcheck
```

Requires Node.js 20 or newer.

## Local Development

```bash
npm ci
npm run build
node dist/bin/skillcheck.js --help
```

You can also run the compiled CLI directly:

```bash
node dist/bin/skillcheck.js eval fixtures/m2/strong-skill/SKILL.md --task-suite fixtures/m2/deterministic-tasks.json --tasks 3 --trials 3 --output /tmp/skillcheck-result.json
```

## Environment

Copy `.env.example` to `.env` and set `NVIDIA_API_KEY`.

Required for live NVIDIA NIM calls:

```bash
NVIDIA_API_KEY=...
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_GENERATOR_MODEL=qwen/qwen3-next-80b-a3b-instruct
NVIDIA_GRADER_MODEL=qwen/qwen3-next-80b-a3b-instruct
NVIDIA_RUNNER_MODEL=qwen/qwen3-next-80b-a3b-instruct
```

Recommended launch-run provider controls:

```bash
NVIDIA_TIMEOUT_MS=120000
NVIDIA_REQUEST_DELAY_MS=5000
NVIDIA_MAX_ATTEMPTS=8
NVIDIA_MAX_RETRY_DELAY_MS=60000
```

The final M5 run used `--concurrency 1` and a 5 second process-wide request delay. The completed run had 75 recovered NVIDIA connection retries and no `429` rate-limit lines.

## Commands

Evaluate one skill:

```bash
skillcheck eval path/to/SKILL.md --tasks 10 --trials 3 --output results/my-run.json
```

Verify a published result:

```bash
skillcheck verify results/my-run.json --sample 3
```

Run the launch corpus:

```bash
skillcheck corpus run --corpus corpus/launch-20.json --results results/launch/$(date -u +%Y%m%dT%H%M%SZ) --tasks 10 --trials 3 --concurrency 1
```

Regenerate the launch-only rot report used by the leaderboard:

```bash
skillcheck rot --results results/launch/20260605T110514Z-qwen-next --output results/rot/report.json
```

Build the static leaderboard:

```bash
npm run site:build
```

By default, the leaderboard reads the launch directory pointed to by `results/launch/latest-qwen-next-dir.txt`. Override with `SKILLCHECK_RESULTS_DIR` when you want to render a different result set.

## Methodology

The generator receives only the declared skill domain, never the full skill body. The runner is evaluated with and without forced skill injection. The grader is blind to arm labels, and deterministic assertions run before LLM grading when available.

Forced injection is the v1 default. It measures whether the skill content helps when injected; it does not test trigger reliability. See `METHODOLOGY.md`.

## Launch Findings

The M5 launch corpus measured 20 pinned seed skills:

- `helps`: 3 / 20, 15%.
- `placebo`: 11 / 20, 55%.
- `harms`: 6 / 20, 30%.

See `FINDINGS-DRAFT.md` for the current draft write-up and caveats.

## Release

Do not publish from this repo until `RELEASE-CHECKLIST.md` is complete and M5 final verification has passed.
