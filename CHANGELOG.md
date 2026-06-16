# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/sx4im/skillcheck/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/sx4im/skillcheck/compare/v0.5.3...v0.6.0
[0.5.3]: https://github.com/sx4im/skillcheck/releases/tag/v0.5.3
