# Contributing to skillcheck

Thanks for taking a look. This guide mirrors the Development workflow already
documented in the README — keep changes small and testable.

## Prerequisites

- Node.js 20+
- npm

## Setup

```bash
npm ci
```

## Checks to run before opening a PR

```bash
npm run lint
npm run typecheck
npm run build
npm test
# optional, matches the CI coverage gate:
npm run test:coverage
```

The test suite is offline (model adapters are mocked). You should not need API
keys for unit/integration tests.

## Scope

- Prefer focused PRs that change one concern at a time.
- Match existing style in the area you touch; don't drive-by reformat unrelated files.
- CLI UI lives under `packages/cli/src/ui/` — keep modules modular (banner, picker,
  step tracker, result card, menus).

## Pull requests

1. Branch from `main`.
2. Make your change and run the checks above.
3. Open a PR with a short summary of *why* the change exists and how you verified it.

Issues and questions: https://github.com/sx4im/skillcheck/issues
