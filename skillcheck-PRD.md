# skillcheck — Product Requirements Document v2

**CLI name:** `skillcheck` (npm: `npx skillcheck`)
**One line:** Measure whether an agent skill actually improves task performance, publish the results as a living public leaderboard, and flag skills that silently break when models update.
**Owner:** Saim Shafique (sx4im / saimshafique.com)
**Status:** Final, ready for execution
**Last updated:** 2026-06-03

---

## 1. Problem

The agent-skill ecosystem is exploding and almost none of it is verified. Thousands of `SKILL.md`, `AGENTS.md`, and `.cursorrules` files now ship as "capability packs" with zero evidence they help. Two things exist and neither closes the gap:

- **Anthropic skill-creator** (March 2026): evaluates skills you authored, Claude-only, tests against the skill's own examples, no cross-ecosystem comparison.
- **SkillsBench** (Stanford / CMU / Berkeley, Feb 2026): a static academic paper measuring curated skills at +16.2pp average. Not a tool you can point at an arbitrary community skill. Not updated when models change.

The open lane is a tool that scores any skill you did not write, on any model, produces a comparable effectiveness number, and re-runs the corpus whenever a model updates to catch silent regressions (rot).

---

## 2. Goals and non-goals

### Goals
1. Score any skill with a single command: `npx skillcheck eval <path>`.
2. Produce a defensible number: effect in percentage points with a bootstrap confidence interval and a significance verdict.
3. Work across formats: `SKILL.md`, `AGENTS.md`, `.cursorrules` in v1.
4. Be reproducible: every result links to the exact skill version, task suite, model version, and config, and can be re-verified.
5. Track rot: re-run the corpus on model releases, diff the scores, flag regressions.
6. Publish a living leaderboard seeded from awesome-claude-md, mattpocock/skills, and antigravity-awesome-skills.

### Non-goals (v1)
- Not a production observability tool (Braintrust, Langfuse, Latitude already own that).
- Not a memory or knowledge-graph product.
- Not a skill authoring assistant (skill-creator owns that).
- No hosted SaaS, no multi-tenant accounts, no database. Results are static JSON committed to the repo.

---

## 3. Positioning

| | skill-creator | SkillsBench | skillcheck |
|---|---|---|---|
| Works on skills you didn't write | No | Fixed set | Yes |
| Models | Claude only | Claude / GPT / Gemini | Any (NVIDIA NIM default) |
| Comparable cross-skill score | No | Paper only | Yes |
| Formats | SKILL.md | SKILL.md | SKILL.md, AGENTS.md, .cursorrules |
| Tracks rot over model versions | No | No | Yes |
| Living public leaderboard | No | No | Yes |

---

## 4. Provider and models

The engine is provider-agnostic with thin adapters. v1 uses NVIDIA NIM via the OpenAI-compatible endpoint.

**Base URL:** `https://integrate.api.nvidia.com/v1`
**Auth:** `NVIDIA_API_KEY` from `.env`
**Adapter:** OpenAI SDK with `baseURL` and `apiKey` overridden. No other change.

Three model roles, each a separate env var so they can be swapped per run:

| Role | Env var | Default model | Why |
|---|---|---|---|
| Generator | `NVIDIA_GENERATOR_MODEL` | `stepfun-ai/step-3.7-flash` | 100% tool call success, best for structured task generation |
| Grader | `NVIDIA_GRADER_MODEL` | `stepfun-ai/step-3.7-flash` | Same: precise rubric following, reliable structured output |
| Runner | `NVIDIA_RUNNER_MODEL` | `deepseek-ai/deepseek-v4-flash` | Different from grader to avoid self-evaluation bias; 1M context handles long skill injections |

Verify exact model slugs from build.nvidia.com before first run and record them in `DECISIONS.md`. The NIM catalog uses an `org/model-name` format but slugs can carry version suffixes.

v2 adapters (post-launch): Anthropic, OpenAI, Ollama (local/private skills).

---

## 5. The measurement method

This is the product. Weak methodology produces a noise leaderboard that gets dunked on. Build this part first.

### 5.1 Skill normalization

Parse any supported input into a common shape:

- `instructions`: the full body injected into context.
- `domain`: the declared scope from description / `when_to_use` / front matter. If absent, infer from the first 200 tokens of instructions.
- `format`: the source format (SKILL.md / AGENTS.md / cursorrules).
- `assets`: bundled scripts or files (recorded, not executed in v1).

### 5.2 Task generation (the fairness rule)

Generate N tasks in the skill's declared domain. The single most important rule:

**The generator receives only the `domain` field, never the `instructions` body.**

This is what separates skillcheck's number from a vendor A/B. skill-creator tests against the skill's own examples. skillcheck does not. Breaking this rule quietly is the most likely way the methodology fails, so enforce it structurally: the function that calls the generator must not have access to the instructions field.

Each task carries one of:
- A **deterministic assertion** (regex match, format check, code runs and passes a provided test). Always prefer these.
- An **LLM rubric** (0–1 score against an explicit checklist) for tasks where deterministic checks are not possible.

Generate 2N tasks per run and sample N to reduce single-generation bias. Commit the task suite alongside every result.

Default N = 10. Override via `--tasks`.

### 5.3 A/B run

For each task, run the runner model (DeepSeek V4 Flash by default) twice:
- **Arm A (with skill):** `instructions` injected as a system-context prefix, then the task prompt.
- **Arm B (without skill):** task prompt only.

Run K trials per arm (default K = 3). Never run one trial per arm. Single-trial results are noise.

Record every transcript. Cache by hash of `(model_id, model_version, prompt, temperature)`.

### 5.4 Blind grading

A separate call to the grader model (Step 3.7 Flash by default) scores each output:
- The grader receives: the task's success criterion and the output to grade. It does not receive the arm label or the other arm's output.
- Arm order is shuffled per grading batch so the grader cannot infer arm from position.
- Deterministic assertions run first and are never sent to the grader.
- Cache by hash of `(grader_id, grader_version, criterion, output)`.

### 5.5 Scoring

```
effect_pp = mean(arm_a_pass_rate) − mean(arm_b_pass_rate)
```

Bootstrap the confidence interval over trials (1000 resamples). Report:

| Field | Definition |
|---|---|
| `effect_pp` | Point estimate of the effect in percentage points |
| `ci_pp` | [lower, upper] 95% bootstrap CI |
| `verdict` | `helps` (CI fully above 0), `placebo` (CI overlaps 0), `harms` (CI fully below 0) |
| `with_skill_pass` | Mean pass rate, arm A |
| `no_skill_pass` | Mean pass rate, arm B |
| `token_overhead` | Extra tokens the skill costs per run |
| `value_per_1k_tokens` | `effect_pp / (token_overhead / 1000)` |

### 5.6 Modes

**Forced-injection mode (v1, default):** skill body always injected regardless of trigger logic. Measures content value in isolation. State this clearly in every result.

**Trigger-respecting mode (v2):** measures real-world value including whether the skill fires correctly. Out of scope for v1.

### 5.7 Rot detection

Persist every result keyed by `(skill_version_hash, model_id, model_version, run_date)`. On a new model release or scheduled cron, re-run the corpus. Diff verdicts. Flag any skill whose verdict moved from `helps` to `placebo` or `harms`. Render a per-skill timeline on the leaderboard.

---

## 6. Anti-gaming

- Submitters cannot supply scoring tasks for their own skill. Tasks come from the generator, which only sees the declared domain.
- `skillcheck verify <result.json>` re-runs a random sample of the result's tasks and confirms the score lands within the published CI. A result that fails verification is flagged on the leaderboard.
- Every result records: skill commit hash, task suite path, model and model version, full config, transcript hashes. A number without provenance is not published.
- The generator and grader are structurally separated in code so neither can receive data it should not see.

---

## 7. CLI surface

```bash
npx skillcheck eval <path-or-url>
  [--runner <model-id>]
  [--grader <model-id>]
  [--generator <model-id>]
  [--trials <K>]
  [--tasks <N>]
  [--mode forced|trigger]
  [--output <file.json>]

npx skillcheck verify <result.json> [--sample <n>]

npx skillcheck corpus run [--corpus <path>] [--concurrency <n>]

npx skillcheck rot [--model <new-model-id>] [--corpus <path>]

npx skillcheck report [--results <dir>] [--out <site-dir>]
```

Publish to npm so `npx skillcheck` works with zero install friction. That zero-friction entry point drives stars.

---

## 8. Results JSON schema

```json
{
  "skill": {
    "name": "string",
    "source": "awesome-claude-md",
    "format": "SKILL.md",
    "commit_hash": "abc123",
    "domain": "docx formatting"
  },
  "config": {
    "runner_model": "deepseek-ai/deepseek-v4-flash",
    "runner_version": "string",
    "grader_model": "stepfun-ai/step-3.7-flash",
    "grader_version": "string",
    "generator_model": "stepfun-ai/step-3.7-flash",
    "trials": 3,
    "tasks": 10,
    "temperature": 0.7,
    "mode": "forced-injection"
  },
  "result": {
    "effect_pp": 14.3,
    "ci_pp": [6.1, 22.0],
    "verdict": "helps",
    "with_skill_pass": 0.71,
    "no_skill_pass": 0.57,
    "token_overhead": 820,
    "value_per_1k_tokens": 17.4
  },
  "tasks": [
    {
      "id": "t001",
      "prompt": "string",
      "criterion_type": "deterministic|rubric",
      "criterion": "string",
      "arm_a_pass_rate": 0.8,
      "arm_b_pass_rate": 0.6
    }
  ],
  "reproducibility": {
    "task_suite_path": "results/tasks/abc123.json",
    "transcript_hashes": ["sha256:..."]
  },
  "history": [
    { "runner_version": "string", "run_date": "2026-06-03", "effect_pp": 11.0, "verdict": "helps" }
  ],
  "run_date": "2026-06-03"
}
```

---

## 9. Stack

| Layer | Choice | Notes |
|---|---|---|
| CLI | TypeScript / Node | npm package, `npx` entry point |
| Provider adapter | OpenAI SDK | base URL + apiKey override for NVIDIA NIM |
| Generator | Step 3.7 Flash via NIM | domain-only context, structured output |
| Runner | DeepSeek V4 Flash via NIM | different from grader, 1M context |
| Grader | Step 3.7 Flash via NIM | blind, structured 0-1 score |
| Cache | On-disk JSON keyed by hash | resets never, grows monotonically |
| Results store | Static JSON in `results/` | no DB, committed to repo |
| Leaderboard | Next.js static export | Vercel or GitHub Pages, free |
| Tests | Vitest | unit + integration |
| Automation | GitHub Actions | cron + dispatch |

---

## 10. Repo structure

```
skillcheck/
  packages/
    cli/                  engine + all commands
      src/
        normalize.ts      skill parser (SKILL.md, AGENTS.md, .cursorrules)
        generate.ts       task generator (domain-only, Step 3.7 Flash)
        run.ts            A/B runner (K trials, DeepSeek V4 Flash)
        grade.ts          blind grader (Step 3.7 Flash)
        score.ts          bootstrap CI, verdicts, token overhead
        verify.ts         reproducibility re-runner
        rot.ts            rot detector
        report.ts         leaderboard JSON regenerator
        cache.ts          on-disk hash cache
        adapters/
          nvidia-nim.ts   OpenAI SDK + NVIDIA base URL
          ollama.ts       (v2, local)
      bin/skillcheck.ts   CLI entry point
    site/                 Next.js leaderboard (static export)
  corpus/
    corpus.yaml           tracked skills + sources
  results/                committed JSON result files
  .github/
    workflows/
      cron-rerun.yml      weekly corpus re-run
      rot-check.yml       triggered on model-release tags
  .claude/
    commands/
      btw.md              mid-run interrupt command
  METHODOLOGY.md          full methodology, public credibility doc
  DECISIONS.md            build decisions log
  BUILD-LOG.md            milestone gate evidence
```

---

## 11. Milestones with verification gates

### M0 — Spike (3 to 4 days)
Prove the number is trustworthy before building anything on top of it.

Build: one hardcoded skill, hardcoded task suite, A/B runner with K=3 trials, bootstrap CI, output to stdout.

Gates (both must hold before M1):
1. **Repeatability:** run the same skill 3 times. The effect must land inside its CI on all 3 runs. If it does not, the method is too noisy. Fix it before moving on.
2. **Control:** run an empty skill (no instructions). Its CI must overlap zero. If an empty skill shows a real effect, the harness is broken.

Log both with numbers in `BUILD-LOG.md`.

### M1 — CLI core (week 1 to 2)
Build: normalizer supporting SKILL.md + AGENTS.md + .cursorrules, independent task generator (Step 3.7 Flash, domain-only), A/B runner (DeepSeek V4 Flash, K trials), blind grader (Step 3.7 Flash, shuffled), JSON result output, `skillcheck eval` command, npm package structure, on-disk cache.

Gate: run `eval` on 5 real skills from awesome-claude-md. Scores must be stable across reruns within their CIs. Log all 5 results.

### M2 — Rigor and reproducibility (week 3)
Build: deterministic assertion support, bootstrap CI with significance logic, token overhead and value metric, `skillcheck verify` command, per-task breakdown in result JSON.

Gates:
- A known-strong skill scores `helps`.
- A deliberately empty skill scores `placebo`.
- `verify` re-runs a sample and lands within the published CI.

### M3 — Leaderboard (week 4)
Build: Next.js static export reading committed results JSON. Sortable / filterable table: skill name, source, domain, effect + CI, verdict, token overhead, value per 1k tokens, last-tested model, rot status. Per-skill detail page with task suite, transcripts, and the `verify` command to reproduce.

Gate: leaderboard builds from a real run of the seed corpus and all detail pages render without broken links.

### M4 — Rot and automation (week 5)
Build: version-keyed result history, `skillcheck rot` command, per-skill timeline on the leaderboard, GitHub Action for scheduled rerun + model-release dispatch that opens a PR with updated results.

Gate: simulate a model swap by changing the runner model ID. The leaderboard must flag changed verdicts and render the history timeline. The Action runs successfully via manual dispatch.

### M5 — Launch prep (week 6)
Build: corpus run on 20 skills from the three seed repos. `METHODOLOGY.md` written and honest about forced-injection mode and untested triggering. README. `RELEASE-CHECKLIST.md`. `FINDINGS-DRAFT.md` with the aggregate finding from the real numbers. Vitest suite green. npm pack passes.

Gate: all of the above exist, are accurate, and the test suite passes with no skipped tests.

---

## 12. The launch finding

Run the seed corpus and publish the aggregate result. The finding writes itself: what percentage of trending skills show no measurable lift, what percentage have rotted on the current model version. That is a claim people argue about, which is how a solo repo travels without a newsletter.

The seed corpus (start here, expand after launch):
- `sx4im/awesome-claude-md` (your own repo, instant credibility and distribution)
- `mattpocock/skills`
- `antigravity-awesome-skills` (repos you contributed PRs to)

Add a scored column to awesome-claude-md pointing each entry at its skillcheck result. That converts an existing link list into the first scored skill index.

---

## 13. Cost and budget

NVIDIA NIM free tier with your `NVIDIA_API_KEY`. Rate-limited but sufficient for a 20-skill seed corpus.

Per skill at defaults (10 tasks × 3 trials × 2 arms = 60 generations + up to 60 grades = ~120 short calls). A 20-skill corpus is ~2,400 calls. Caching makes repeat runs cheaper.

Rules:
- Caching is mandatory before any corpus run.
- Never run the full corpus without confirming the cache is warm on a sample first.
- First corpus cap: 20 skills. Expand only after launch.
- `NVIDIA_API_KEY` from `.env`, never hardcoded, never committed.

---

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Task generator bias (tasks reflect generator's domain model, not skill's) | Domain taxonomy, reviewable task pool, community task contributions subject to the same independence rule |
| Variance swamps small effects | K trials, bootstrap CI, minimum resolvable effect threshold; do not report effects the method cannot resolve |
| Grader bias | Blind grading, deterministic-first, human spot audits of a sample |
| "You measure forced injection, not real use" | Say so in every result and in METHODOLOGY.md; trigger-respecting mode is v2 |
| Leaderboard gaming | Independent task generation; submitters cannot supply scoring tasks; `verify` re-runs |
| NIM model slug changes | Model IDs in env vars, logged in DECISIONS.md, checked against build.nvidia.com before each corpus run |
| Rate limiting on NIM free tier | Cache aggressively, run corpus in low-concurrency mode (`--concurrency 2`), retry with backoff |

---

## 15. Monetization (post-launch, optional)

Keep CLI and public leaderboard fully MIT and free. Monetization only if the project gets traction.

Natural paid tier: continuous skillcheck for private skills. Point it at your team's private skills, get a rerun and an alert whenever a model release rots one. Hosted CI service, $15 to $30 per month via Lemon Squeezy or Paddle (merchant of record, Pakistan-friendly, no Stripe needed, payout via Payoneer to HBL).

Do not build the paid tier before the free project has stars and users.

---

## 16. Do-not list (things the build agent must not attempt)

- Do not publish to npm. Leave `RELEASE-CHECKLIST.md` with exact publish steps instead.
- Do not write or post the launch thread. Draft `FINDINGS-DRAFT.md` from real numbers, marked unverified.
- Do not pick the final public corpus. Use the 20-skill seed.
- Do not build the paid hosted tier.
- Do not add a database.
