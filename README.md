# skillcheck

Measure whether an agent skill actually improves task performance.

`skillcheck` runs a forced-injection A/B evaluation: the runner model solves generated tasks with and without the skill instructions, then the result is scored as an effect in percentage points with a bootstrap confidence interval.

## Status

- M0-M4 gates have passed and are recorded in `BUILD-LOG.md`.
- M5 launch prep is in progress.
- The M5 20-skill launch corpus is defined in `corpus/launch-20.json`, but the live run is not complete yet because NVIDIA NIM chat completions timed out during the cache-warm sample on 2026-06-04.

## Install

Local development:

```bash
npm ci
npm run build
node dist/bin/skillcheck.js --help
```

After npm publication:

```bash
npx skillcheck --help
```

## Environment

Copy `.env.example` to `.env` and set `NVIDIA_API_KEY`.

Required for live runs:

```bash
NVIDIA_API_KEY=...
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_GENERATOR_MODEL=stepfun-ai/step-3.7-flash
NVIDIA_GRADER_MODEL=stepfun-ai/step-3.7-flash
NVIDIA_RUNNER_MODEL=mistralai/mistral-small-4-119b-2603
```

Useful rate-limit controls:

```bash
NVIDIA_TIMEOUT_MS=120000
NVIDIA_REQUEST_DELAY_MS=1500
```

## Commands

```bash
skillcheck eval <path> --tasks 10 --trials 3 --output results/my-run.json
skillcheck verify <result.json> --sample 3
skillcheck corpus run --corpus corpus/launch-20.json --results results/launch/20260604 --tasks 10 --trials 3
skillcheck rot --results results --output results/rot/report.json
```

## Methodology

The generator receives only the skill domain, never the full skill instructions. The runner is evaluated with and without forced skill injection. The grader is blind to arm labels, and deterministic assertions run before LLM grading when available.

Forced injection is the v1 default. It measures whether the skill content helps when injected; it does not test trigger reliability. See `METHODOLOGY.md`.

## Leaderboard

Build the static leaderboard:

```bash
npm run site:build
```

The site reads committed JSON results from `results/` and rot history from `results/rot/report.json`.

## Release

Do not publish from this repo until `RELEASE-CHECKLIST.md` is complete and M5 has passed.
