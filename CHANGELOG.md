# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.10.0] - 2026-08-16

### Fixed

- `skillcheck matrix` crashed while rendering its table (verdict/score were read from a shape the result never had). It now reads the typed result, and its default model list only applies on multi-vendor providers (NIM, Cloud, OpenRouter) — on other providers it asks for `--models` up front instead of failing mid-run.
- `skillcheck verify` re-runs through your configured provider instead of always NVIDIA NIM, so BYOK keys are no longer sent to the wrong upstream.
- Skill files with multi-line YAML front-matter descriptions (`>` and `|` block scalars — a common authoring style) no longer extract a garbage domain; tasks are now generated from the full folded description.
- The non-JSON grader fallback no longer zeroes clear passes when unrelated negation words appear elsewhere in the grader's explanation; only a negation near the pass-word counts.
- A corrupted `~/.config/skillcheck/config.json` now logs a warning instead of silently resetting to an empty config.

### Changed

- Result JSON cleanup — **breaking for external consumers of `--json` output**: removed duplicate keys (`runner_version`, `grader_version`, and the `toolDependent` spelling of `tool_dependent`); per-task pass rates renamed `arm_a_pass_rate`/`arm_b_pass_rate` → `with_skill_pass_rate`/`no_skill_pass_rate`; `history` entries carry `runner_model`. In-repo consumers (rot, leaderboard, verify) are updated and still read older result files.
- The `m0` calibration gate now runs the exact production runner prompt instead of a hand-rolled variant.

### Dashboard (self-hosted)

- Run metering is atomic at the quota boundary, and each run id is capped at 200 model calls — replaying one `x-skillcheck-run` id can no longer bypass metering.
- All outbound calls (Upstash, NVIDIA, Clerk, Stripe) carry request timeouts; billing confirm is POST-only; Stripe errors are reported by status instead of crashing on HTML; `TOKEN_PEPPER` no longer falls back to a public constant.
- The dashboard API is now statically type-checked (JSDoc + `tsc --checkJs`) in CI.

## [0.9.3] - 2026-07-23

### Fixed

- Pass session `x-skillcheck-run` header on all model completion calls in `evalSkill` so an entire evaluation run is metered as 1 single run instead of charging per call.
- Monthly automatic quota reset: free tier 10 runs auto-refresh on the 1st of every calendar month.
- Immediately refreshed 10/10 free runs for all existing users affected by the previous header bug.

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
