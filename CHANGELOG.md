# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.1] - 2026-07-23

### Fixed

- Allow explicit re-configuration via `skillcheck setup` even when direct provider environment variables are set.
- Add `--setup` and `--config` command aliases to `skillcheck setup`.
- Comprehensive `--help` UI documentation for multi-provider BYOK, `matrix` benchmarking, and `--concurrency`.

## [0.9.0] - 2026-07-23

### Added

- Zero-dependency async pool concurrency for trial execution (`--concurrency N`), speeding up evaluation runs by 60–75%.
- `skillcheck matrix <path>` command to benchmark skills across multiple models/providers side-by-side in one command.

## [0.8.0] - 2026-07-23

### Added

- Multi-provider Bring Your Own Key (BYOK) support for direct mode: OpenAI, Anthropic, Google Gemini, Groq, Mistral AI, OpenRouter, and NVIDIA NIM.
- Live model listing & verification during interactive `skillcheck setup`.
- Role-based model overrides per provider (`OPENAI_RUNNER_MODEL`, `ANTHROPIC_RUNNER_MODEL`, etc.).
- Refactored CLI UI modules under `packages/cli/src/ui/`.

## [0.7.1] - 2026-06-16

### Added

- Interactive per-task breakdown offer: after a human `check` run the CLI now asks
  "See the per-task breakdown?" instead of exiting — answer yes to print it with no
  re-run (the data is computed from the run's own outputs). `--explain` still shows
  it straight away, unprompted.

### Changed

- Progress bar fills by floor — it never reads "full" while work remains — and shows
  a precise percentage next to the count.

### Fixed

- `skillcheck check <path>` on an interactive terminal now asks for an effort level
  (Quick / Standard / Thorough) when you don't pass `--tasks`/`--trials`, instead of
  silently running at the defaults. Pinning `--tasks`/`--trials`, `--json`, and
  non-interactive sessions are unaffected.

## [0.7.0] - 2026-06-16

### Added

- `--explain` flag for `check`/`eval`: prints a per-task breakdown (with/without
  pass rates, the change, and a contrasting example output from each arm) below the
  result card, and includes it in `--json` output under `explain`. Reuses the run's
  existing outputs, so it makes no extra model calls.

## [0.6.0] - 2026-06-16

### Added

- End-to-end tests that drive the command router (`main()`) through the full
  normalize → generate → run → grade → score → render pipeline against a mocked
  model, plus unit suites for the retry adapter, the M0 gate, corpus
  orchestration, rot status classification, cloud-key verification, and the UI
  formatters (74 → 131 tests).
- Enforced code-coverage gate (`npm run test:coverage`, Vitest + v8) at 85%
  statements / functions / lines and 70% branches over the decision-making logic.
- ESLint (flat config, typescript-eslint) with `npm run lint`.
- Continuous integration on every push and pull request (`.github/workflows/ci.yml`):
  lint, typecheck, coverage, and a clean build on Node 20 and 22, plus the
  dashboard's offline test suite and a published-package validation job.
- Provenance-signed release workflow (`.github/workflows/release.yml`) that
  publishes to npm on a `v*` tag.
- Dependabot updates for npm and GitHub Actions.

### Changed

- `skillcheck <command> --help` now prints usage instead of erroring on a missing
  path; `--help` is honoured anywhere on the command line.
- `prepublishOnly` now runs lint, typecheck, build, and the coverage gate before a
  publish.

## [0.5.3]

- Recalibrated effort-level time estimates to observed `gpt-oss-120b` runs.

[Unreleased]: https://github.com/sx4im/skillcheck/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/sx4im/skillcheck/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/sx4im/skillcheck/compare/v0.5.3...v0.6.0
[0.5.3]: https://github.com/sx4im/skillcheck/releases/tag/v0.5.3
