# skillcheck

[![npm version](https://img.shields.io/npm/v/@sx4im/skillcheck)](https://www.npmjs.com/package/@sx4im/skillcheck)
[![npm downloads](https://img.shields.io/npm/dm/@sx4im/skillcheck)](https://www.npmjs.com/package/@sx4im/skillcheck)
[![CI](https://github.com/sx4im/skillcheck/actions/workflows/rot.yml/badge.svg)](https://github.com/sx4im/skillcheck/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](https://nodejs.org)

**Measure whether an agent skill actually improves a model's task performance.**

Most published SKILL.md files have never actually been tested, so you can't tell whether they help your model or are just decoration.

Drop in a `SKILL.md` (or any `.md`) and `skillcheck` runs a controlled A/B test: it
generates fresh tasks for the skill's domain, has the model solve them **with** and
**without** the skill instructions, grades both blind, and reports the effect with a
bootstrap confidence interval and a 0–100 quality score.

```
$ skillcheck

+------------------------------------------------------+
| SKILLCHECK RESULT
+------------------------------------------------------+
| Skill           API Documentation
| Run size        5 tasks × 3 trials
|
| Verdict         HELPS
| The skill HELPED — model passed 80% of tasks with it vs 55% without.
|
| With skill      80.0% of tasks passed
| Without skill   55.0% of tasks passed
| Skill effect    +25.0 pp change in pass rate
| Confidence      +8.0 pp to +42.0 pp (95% range)
| Token cost      +480 tokens to include the skill
+------------------------------------------------------+
| Satisfaction    ██████████████████░░░░░░  75.0/100  GOOD
+------------------------------------------------------+
```

## Install

```bash
npm install -g @sx4im/skillcheck

# or run it without installing:
npx @sx4im/skillcheck
```

Requires Node.js 20+.

Skillcheck checks npm for a newer version about once a day and offers to update you
(like the Codex and Gemini CLIs). To turn that off, set `SKILLCHECK_NO_UPDATE_CHECK=1`.

## Quick start

```bash
skillcheck
```

On first run it asks for your Skillcheck API key (grab a free one from the dashboard —
the URL is built in). The key is verified, then an interactive picker opens. Navigate
folders with the arrow keys and pick any `.md` file. Choose an effort level and you get
a result card.

You can also point it straight at a file or folder:

```bash
skillcheck check ./SKILL.md
skillcheck ./my-skill-folder            # a folder containing a .md
```

Skip the prompt entirely with an environment variable:

```bash
export SKILLCHECK_TOKEN=chk_live_...
skillcheck check ./SKILL.md
```

## Effort levels

The interactive run asks how thorough to be — more tasks/trials means a tighter
confidence interval but a longer run:

| Level  | Tasks × trials | Typical time |
|--------|----------------|--------------|
| Low    | 2 × 1          | seconds      |
| Medium | 3 × 2          | ~1–2 min     |
| Strong | 5 × 3          | ~2–4 min     |

For scripted runs, set it explicitly: `skillcheck check ./SKILL.md --tasks 5 --trials 3`.

## Reading the result

- **Verdict** — `HELPS` / `PLACEBO` / `HARMS`, decided by whether the confidence
  interval clears zero. `PLACEBO` means *no measurable difference*, not necessarily a
  bad skill.
- **Skill effect** — the change in pass rate, in percentage points (pp).
- **Confidence** — the 95% range for the true effect. A **wide** range means the run was
  inconclusive; re-run at a higher effort for a clearer signal.
- **Satisfaction** — a 0–100 quality score where **50 = no effect**:

  | Score | Band | Score | Band |
  |-------|------|-------|------|
  | ≤10 | Very bad | 51–60 | Decent |
  | 11–30 | Bad | 61–80 | Good |
  | 31–50 | Normal | 81–100 | Excellent |

Each run is independent — tasks and model outputs are generated fresh every time and
nothing is cached locally, so results vary run to run.

## Commands

```bash
skillcheck                                  # interactive: pick a file, pick effort, run
skillcheck check <path> [--tasks N] [--trials K] [--output file.json] [--json]
skillcheck setup                            # re-enter / change your API key
skillcheck logout                           # remove your saved API key
skillcheck eval <path> [...]                # raw JSON evaluator (no result card)
skillcheck verify <result.json> [--sample n]
skillcheck --version                        # print the installed version
```

## Self-hosting the model

Skillcheck runs on a hosted model behind a metered proxy so end users never need their
own provider key. The `dashboard/` folder is a deployable Vercel app (Clerk sign-in,
free-tier metering, optional Stripe upgrade) that issues API keys and forwards to your
server-side NVIDIA NIM key. See **[`dashboard/SETUP.md`](dashboard/SETUP.md)** for the
deploy walkthrough.

To run against your own NVIDIA key directly (no proxy), set `NVIDIA_API_KEY` — see
[`.env.example`](.env.example) for all options (model, timeouts, rate-limit delay).

## How it works

The task generator only sees the skill's declared **domain**, never the skill body, so it
can't leak the instructions into the tasks. The model is then run with and without forced
skill injection, and a **blind** grader scores each output without knowing which arm it
came from. The effect and its confidence interval come from a paired bootstrap. Full
details in [`METHODOLOGY.md`](METHODOLOGY.md).

## Development

```bash
npm ci
npm run build      # compile to dist/
npm test           # vitest
npm run typecheck
```

## License

MIT
