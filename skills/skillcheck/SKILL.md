---
name: skillcheck
description: Test, audit, and improve agent skills. Use when creating or editing a SKILL.md, diagnosing false triggers, checking skill combinations, or reviewing a skill before release.
---

## Check the skill

1. Run the static audit before sending skill content to a model.

   ~~~sh
   npx @sx4im/skillcheck audit ./SKILL.md
   ~~~

2. Resolve critical findings manually. Preview cleanup with
   `skillcheck fix ./SKILL.md --dry-run --recheck`. Review the patch before
   running with `--write`.
3. Run `skillcheck check ./SKILL.md --tasks 10 --trials 3 --explain`. Record the
   effect in percentage points, the 95% interval, and examples of tasks the
   skill helped or hurt. Reuse a task suite when comparing revisions.

## Check discovery and composition

- Write a description that names the action and includes `Use when` with concrete
  triggers. Include nearby requests that should leave the skill inactive.
- Run `skillcheck route ./SKILL.md --against ./skills --queries 20`. Check false
  triggers and interference as well as Hit@1. Review the description patch
  before applying it.
- Run `skillcheck compose ./SKILL.md --with ./related-skills --compare-isolated`
  when agents load the skills together. Review overlapping instructions and token
  cost alongside the measured marginal effect.

## Gate the change

- Use `skillcheck audit ./SKILL.md --format sarif --output skillcheck.sarif` to
  upload findings to GitHub Code Scanning.
- Run `skillcheck audit ./SKILL.md --dynamic` when tool or credential handling
  changed. Review the paired simulated traces before interpreting a failure.
- Use `--fail-on placebo` when promotion requires measurable improvement. Report
  the sample size and the models used alongside the verdict.
