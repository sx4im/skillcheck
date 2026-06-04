# Methodology

This document describes how `skillcheck` measures skill effectiveness in v1.

## What Is Measured

`skillcheck` measures the value of skill instructions under forced injection. The skill body is always injected into the runner model's context for the `with_skill` arm and omitted for the `no_skill` arm.

This is intentionally narrower than real agent behavior. It answers: "Does this skill content help when the model receives it?" It does not answer: "Will an agent trigger this skill at the right time?" Trigger-respecting evaluation is out of scope for v1.

## Skill Normalization

Supported input formats:

- `SKILL.md`
- `AGENTS.md`
- `.cursorrules`
- `CLAUDE.md` for the accessible `awesome-claude-md` seed corpus

Each skill is normalized into:

- `instructions`: full injected content
- `domain`: declared scope from front matter or inferred text
- `format`: source format
- `assets`: recorded sibling files, not executed in v1
- `commit_hash`: SHA-256 hash of the instruction body

## Task Generation

The task generator receives only the normalized `domain`. It never receives the instruction body.

For each run, the generator creates `2N` tasks and `skillcheck` deterministically samples `N` tasks. This reduces dependence on a single generation order while preserving reproducibility for the same domain and generator model.

## A/B Runner

For each task, the runner model is called in two arms:

- `with_skill`: system context includes the skill instructions
- `no_skill`: task prompt only

Each arm runs `K` trials. The default is `K=3`; single-trial results are not accepted as launch-quality evidence.

## Grading

Deterministic assertions run first when a task has one. Otherwise, the grader model receives the output and the criterion, but not the arm label. This keeps grading blind to whether an answer came from the skill-injected arm.

The generator, runner, and grader model IDs are separate environment variables so they can be swapped independently.

## Scoring

`effect_pp` is:

```text
mean(with_skill_pass_rate) - mean(no_skill_pass_rate)
```

The confidence interval is a paired bootstrap over task/trial observations. Verdicts are:

- `helps`: the full CI is above zero
- `placebo`: the CI overlaps zero
- `harms`: the full CI is below zero

Results also report token overhead and value per 1k extra prompt tokens.

## Reproducibility

Every published result records:

- skill source
- skill instruction hash
- task suite path
- runner, grader, and generator model IDs
- trial count and task count
- transcript hashes
- run date

`skillcheck verify <result.json>` reruns a sample of tasks and checks whether the measured effect remains inside the published confidence interval.

## Rot Detection

Rot detection groups result history by normalized skill name plus instruction hash. A skill is flagged as rot only when a previous result was `helps` and the latest result is `placebo` or `harms`.

The leaderboard renders the latest rot status and the per-skill history timeline.

## Known Limitations

- Forced injection does not measure trigger reliability.
- LLM-graded tasks inherit the limitations of the grader model, even with blind labels.
- Assets are recorded but not executed in v1.
- The seed corpus is intentionally capped before launch; it should not be treated as the final public corpus.
- NVIDIA NIM availability and rate limits affect live corpus completion, so every failed or interrupted run is recorded separately from gate-passing evidence.
