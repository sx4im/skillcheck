# skillcheck

Measure whether an agent skill actually improves task performance.

`skillcheck` runs a forced-injection A/B evaluation: the runner model solves generated tasks with and without the skill instructions, then the result is scored as an effect in percentage points with a bootstrap confidence interval.

## Status

- M0-M4 gates have passed and are recorded in `BUILD-LOG.md`.
- M5 completed a 20-skill launch corpus in `results/launch/20260605T110514Z-qwen-next`.
- Published on npm as `@sx4im/skillcheck`.

## One-Line Install

```bash
npm install -g @sx4im/skillcheck
```

Requires Node.js 20 or newer.

## Usage

```bash
skillcheck
```

On first run, Skillcheck asks for your Skillcheck API URL and saves it locally. Then it opens the interactive picker. Select `SKILL.md`, `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, or a folder containing one.

Change the saved API URL later:

```bash
skillcheck setup
```

You can also pass a path directly:

```bash
skillcheck check path/to/SKILL.md
skillcheck path/to/skill-folder
```

The quick run shows a blue/white result card in the terminal. It does not write a results folder unless you explicitly pass `--output`.

## Cloud Setup

For shared/public usage, point the CLI at your Skillcheck Cloud endpoint:

```bash
export SKILLCHECK_API_URL=https://api.yourdomain.com/v1
```

See `docs/skillcheck-cloud.md` for the proxy and dashboard plan.

## Local Development

```bash
npm ci
npm run build
node dist/bin/skillcheck.js --help
```

## Commands

Friendly skill check:

```bash
skillcheck check path/to/SKILL.md
```

You can also omit `check` when the argument is an existing path:

```bash
skillcheck path/to/skill-folder
```

Run a stronger check:

```bash
skillcheck check path/to/SKILL.md --tasks 10 --trials 3
```

Advanced raw JSON evaluator:

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

To publish the public npm package, log in with the npm account that should own `skillcheck`, then run one of the publish flows below.

With npm WebAuthn/security-key 2FA enabled:

```bash
npm login
npm publish --access public
npm view @sx4im/skillcheck version
npx --yes @sx4im/skillcheck@latest --help
```

With an authenticator-app OTP:

```bash
npm publish --access public --otp=123456
```

Replace `123456` with the current 6-digit npm two-factor authentication code.

Without account 2FA, create a granular access token on npm with `Bypass two-factor authentication` enabled and `Read and write` access to all packages, then publish with that token.

If the package name is still free, `npm publish` creates/registers `@sx4im/skillcheck` automatically.
