# Skillcheck Architecture & Feature Roadmap: v0.12.0 ➔ v1.0.0

This document outlines the architectural blueprint, technical specifications, and execution phases for the next major evolution of **Skillcheck** (`@sx4im/skillcheck`).

Skillcheck is transitioning from a passive statistical testing utility into an **active compiler, linter, and automated optimizer for AI agent instructions** (`.cursorrules`, `CLAUDE.md`, `SKILL.md`, `AGENTS.md`).

---

## Strategic Vision

Prompt engineering and agent rule authoring have historically been treated like subjective "vibes". In contrast, Skillcheck treats agent instructions with the same scientific discipline as software engineering and clinical drug trials:
- **Counterfactual Control Arms**: Measuring performance *with* vs. *without* the instruction.
- **Statistical Rigor**: 1,000-resample bootstrap confidence intervals (`effect_pp`, `ci_pp`).
- **Context Economics**: Measuring the ongoing token tax and latency penalty of rule files.
- **Senior Engineering Standards**: Zero speculative abstraction, bounded outbound calls, modular UI, and zero bloat.

---

## Release Phases Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       SKILLCHECK ROADMAP: V0.12 ➔ V1.0                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PHASE 1 (v0.12.0): Core Ergonomics & Local Power ("The Delight Release")   │
│  ├─ Smart Workspace Auto-Discovery (zero-keystroke launch)                  │
│  ├─ Zero-Config Local LLM Auto-Discovery (Ollama, LM Studio, vLLM)          │
│  ├─ Zero-Binary OSC 52 Clipboard Export (one-key PR comments across SSH)    │
│  ├─ Live Dual-Arm Telemetry & Real-Time Token Monitor                       │
│  ├─ In-Memory Fuzzy Search Filter in File Picker                            │
│  └─ Native Shell Completions Generator (bash, zsh, fish)                    │
│                                                                             │
│  PHASE 2 (v0.13.0): Daily Developer Habit Loop ("The Workflow Release")     │
│  ├─ skillcheck watch (tiered cascading hot-reloading on save)               │
│  ├─ skillcheck hook install (git pre-commit regression guard)               │
│  ├─ "Skillcheck Lens" interactive alternate-screen post-run inspector       │
│  └─ Checkpointed Resumable Evaluations (--resume)                           │
│                                                                             │
│  PHASE 3 (v1.0.0): The Compiler & Optimizer ("The Unassailable Moat")       │
│  ├─ skillcheck optimize (AST-surgical automated prompt optimizer)           │
│  ├─ skillcheck pareto (multi-objective effect vs context-cost frontier)     │
│  ├─ skillcheck tasks create (synthetic discrimination dataset studio)       │
│  ├─ skillcheck view (zero-dependency localhost visualizer)                  │
│  └─ Multi-turn agentic VFS evaluation harness (--agentic)                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Core Ergonomics & Local Power (v0.12.0)

Target: Transform the terminal experience to match the responsiveness, elegance, and zero-friction feel of tools like Hermes Agent and OpenCode.

### 1.1 Smart Workspace Auto-Discovery
- **Goal**: When running `skillcheck` in a repository without arguments, automatically detect standard agent instructions and offer an instant one-press execution.
- **Implementation**:
  - Traverse up from `process.cwd()` to find the git root (`.git`).
  - Scan for conventional instruction files: `CLAUDE.md`, `.cursorrules`, `SKILL.md`, `AGENTS.md`, `.cursor/rules/*.mdc`, `.claude/skills/**/*.md`.
  - If **exactly one** skill file is detected in the workspace, display a clean instant-launch prompt:
    ```text
    ◆ Skillcheck v0.12.0
      Detected workspace skill: ./CLAUDE.md (650 tokens)

      [Enter] Check this skill (3 tasks × 3 trials)
      [e]     Change effort level
      [b]     Browse filesystem for another file
      [q]     Quit
    ```
  - Reduces Time-to-First-Run from 6 navigation keystrokes down to a **single `Enter` keypress**.

### 1.2 Zero-Config Local LLM Auto-Discovery (Ollama, LM Studio, vLLM)
- **Goal**: Allow developers to benchmark skills with 0 cost, 0 API keys, and 100% offline local privacy.
- **Implementation**:
  - Non-blocking micro-probe (`timeout: 100ms` via `AbortSignal.timeout`) on startup:
    - `http://127.0.0.1:11434/v1` (Ollama)
    - `http://127.0.0.1:1234/v1` (LM Studio)
    - `http://127.0.0.1:8000/v1` (vLLM)
  - When detected, auto-populate model selection with active local coding models (`qwen2.5-coder:32b`, `llama3.3:70b`, `deepseek-r1`).
  - Routes directly through `OpenAiCompatClient` with zero additional SDK dependencies.

### 1.3 Zero-Binary OSC 52 Clipboard Export
- **Goal**: One-key copy of rich GitHub-flavored Markdown summaries and PR review tables without OS clipboard dependencies (`pbcopy`, `xclip`, `wl-copy`).
- **Implementation**:
  - Implement the **OSC 52 terminal protocol** (`\x1b]52;c;<base64>\x07`) in `packages/cli/src/ui/clipboard.ts`.
  - Works transparently over SSH, Docker, devcontainers, and tmux.
  - In post-run card or inspector, pressing `c` instantly copies formatted markdown tables with confidence intervals, pass rate deltas, and token overhead.
  - Command-line flag: `skillcheck check ./SKILL.md --clipboard`.

### 1.4 Live Dual-Arm Telemetry & Real-Time Token Monitor
- **Goal**: Replace the single progress spinner with an informative dual-arm live tracker that communicates experimental fairness.
- **Implementation**:
  - Render dual progress bars in `packages/cli/src/ui/progress.ts`:
    ```text
    ⠋ Running trials · 8/18 complete (44%) · 22s elapsed
      Arm A (With Skill):    ▰▰▰▰▰▱▱▱▱▱  5/9 trials
      Arm B (Without Skill): ▰▰▰▱▱▱▱▱▱▱  3/9 trials
      Tokens: ~18.4k in flight · Concurrency: 4 · Model: claude-3-5-sonnet
    ```

### 1.5 In-Memory Fuzzy Filter in File Picker
- **Goal**: Enable instant typing in the alternate-screen file picker to jump directly to files.
- **Implementation**:
  - In `packages/cli/src/ui/picker.ts`, capture alphanumeric input in raw TTY mode.
  - Real-time substring filtering with highlighted match ranges.
  - Pin detected skills (`CLAUDE.md`, `SKILL.md`) to the top with accent markers.

### 1.6 Native Shell Completions Generator
- **Goal**: Tab completions for Bash, Zsh, and Fish without third-party dependencies.
- **Implementation**:
  - `skillcheck completion [bash|zsh|fish]` outputs native POSIX completion scripts.
  - `skillcheck completion install` automatically detects the active shell and registers completions in `~/.bashrc`, `~/.zshrc`, or `~/.config/fish/config.fish`.
  - Filters file completions to `.md`, `.cursorrules`, and directories.

---

## Phase 2: Daily Developer Habit Loop (v0.13.0)

Target: Embed Skillcheck into everyday prompt authoring workflows (hot-reloading on save and git pre-commit safety barriers).

### 2.1 `skillcheck watch` (Cascading Hot-Reloading on Save)
- **Goal**: Provide Vitest-like instantaneous feedback when tweaking `.cursorrules` or `SKILL.md`.
- **Implementation**:
  - Tier 0 (<10ms, Local): Instant token count delta (`Tokens: 640 ➔ 712 (+72 tokens)`) and syntax/contradiction linter.
  - Tier 1 (1.5s, Micro-Sample): Re-evaluates only previously failing or borderline tasks.
  - Tier 2 (3–5s, Debounced): Maps modified markdown sections to relevant domain tasks.
  - Interactive terminal controls: `[r]` re-run all, `[f]` run failed tasks, `[m]` switch model, `[q]` quit.

### 2.2 `skillcheck hook install` (Git Pre-Commit Regression Guard)
- **Goal**: Prevent developers and teams from accidentally committing prompt changes that score `HARMS` or introduce severe token bloat.
- **Implementation**:
  - Installs `.git/hooks/pre-commit` (compatible with Husky and `lint-staged`).
  - Scans staged files (`git diff --cached --name-only`). If no prompts changed, exits in <15ms.
  - If a prompt file changed, runs a micro-benchmark (`3 tasks × 2 trials`, ~4–6s).
  - Blocks commit (`exit 1`) if the change introduces a statistically verified regression (`Verdict: HARMS`).
  - Optional flag: `--strict` (also blocks `PLACEBO` prompt bloat).

### 2.3 "Skillcheck Lens" Alternate-Screen Post-Run Inspector
- **Goal**: Interactive deep-dive into model trial outputs, diffs, and grader critiques without dumping huge text walls to stdout.
- **Implementation**:
  - Accessible via `skillcheck check ./SKILL.md --inspect` or pressing `i` after a check completes.
  - Alternate-screen dual-pane viewer (`withRawMode`):
    - Left Pane: List of tasks with effect tags (`[+66.7 pp] HELPS`, `[ 0.0 pp] NEUTRAL`, `[-33.3 pp] HARMS`).
    - Right Pane: Side-by-side trial diff (Output With Skill vs. Output Without Skill), task prompt, and blind grader rationale.
    - Vim keys (`j`/`k`, `Tab`, `Enter`, `q`).

### 2.4 Checkpointed Resumable Evaluations (`--resume`)
- **Goal**: Protect developer time and API spend from network drops, rate limits, or accidental interruptions.
- **Implementation**:
  - Atomically save in-progress trial observations to `~/.config/skillcheck/checkpoints/<hash>.json`.
  - When interrupted, output:
    `Interrupted during trial 11/18. Resume with: skillcheck check ./SKILL.md --resume`
  - Re-running prompts to resume from the last completed trial.

---

## Phase 3: The Compiler & Optimizer (v1.0.0)

Target: Build an unassailable competitive moat that sets Skillcheck far ahead of assertion-based linters like Promptfoo.

### 3.1 `skillcheck optimize` — Self-Healing / Automated Prompt Optimizer
- **Goal**: Automatically edit and refine `.cursorrules` or `SKILL.md` to boost effect size and eliminate token waste.
- **Implementation**:
  - **AST-Surgical Decomposition**: Parses markdown into Frontmatter, Headings, Bullet Rules, and Code Blocks.
  - **Credit Assignment**: Uses grader failure critiques (`GradedOutput.reason`) as textual gradients to identify failing rules.
  - **Targeted Mutation Operators**:
    - Constraint Clarification (strengthens weak guidelines into strict imperatives).
    - Negative Constraint Injection (adds `NEVER` / `DO NOT` clauses for recurring failure modes).
    - Pruning & Compression (deletes dead, decorative paragraphs that provide zero pass-rate lift).
  - **Paired Bootstrap Selection Gate**: Validates candidate variants against holdout tasks. Accepts changes only if:
    `Effect(variant) > Effect(baseline)` AND `Lower_CI(variant) >= Lower_CI(baseline)` AND `Tokens(variant) <= Tokens(baseline) * 1.15`.
  - Displays a colorized terminal git diff of proposed prompt improvements before writing.

### 3.2 `skillcheck pareto` — Pareto Frontier & Context-Tax Engine
- **Goal**: Solve the "Context Tax" by balancing model lift against token overhead and latency.
- **Implementation**:
  - Generates multiple compression variants of the skill (Compact, Balanced, Detailed, Exemplar-Heavy).
  - Evaluates variants across tasks to compute the **Pareto Optimal Frontier**.
  - Highlights the **Optimal Knee**: the variant delivering maximum marginal lift per context token.
  - Renders a terminal ASCII/Unicode Pareto plot.

### 3.3 `skillcheck tasks create` — Synthetic Dataset Studio
- **Goal**: Generate maximally discriminative evaluation task suites that eliminate trivial floor/ceiling effects.
- **Implementation**:
  - Multi-Axis Evol-Instruct generator across 4 axes: Negative constraints, Edge-case stress, Multi-step reasoning, Contextual ambiguity.
  - Automated discrimination pre-flight: discards tasks where both arms pass 100% (too easy) or both fail 0% (impossible).
  - Interactive TUI review studio (`skillcheck tasks review`) to curate, edit, and approve tasks.

### 3.4 `skillcheck view` — Zero-Dependency Localhost Visualizer
- **Goal**: Beautiful browser-based inspection of evaluation traces, token waterfalls, and confidence curves without third-party frameworks.
- **Implementation**:
  - Zero-dependency Node.js HTTP server on `localhost:3141`.
  - Serves an embedded, self-contained single-page dashboard (<85KB).
  - Interactive transcript diffs, token cost waterfalls, and SVG bootstrap confidence distributions.

### 3.5 Multi-Turn Agentic VFS Evaluation Harness (`skillcheck eval --agentic`)
- **Goal**: Evaluate agent skills inside real multi-turn tool-calling loops rather than single-turn completions.
- **Implementation**:
  - In-memory Virtual File System (VFS) with mock tools (`read_file`, `write_file`, `list_dir`, `exec`).
  - Evaluates both **Outcome** (correct code delivered) and **Trajectory Compliance** (adherence to operational rules and security boundaries).

---

## Implementation Standards & Quality Checklist

In accordance with `CLAUDE.md`, every feature in this roadmap must adhere to:
1. **Senior Engineering Discipline**: Small, focused functions explaining *why* decisions were made.
2. **Zero Bloat & Speculative Abstraction**: No unnecessary npm dependencies; native Node.js APIs (`node:http`, `node:fs`, `node:crypto`) are preferred.
3. **Modular UI Layer**: Terminal extensions belong under `packages/cli/src/ui/`.
4. **Typed Cross-Module Contracts**: Concrete TypeScript interfaces for all shared payloads.
5. **Bounded Outbound Calls**: Strict timeouts (`AbortSignal.timeout`) on all network operations.
6. **100% Test Coverage Gate**: Vitest test coverage must remain above 85% across all new modules.
