# Skillcheck — Developer & Code Quality Guidelines

## Code Quality Standards

1. **Senior Engineering Discipline**
   - **Small, Focused Functions**: Keep functions short, clear, and single-purpose.
   - **Explanatory Comments**: Write comments that explain *why* a decision was made (e.g., protocol quirks, retry behavior, fallback rationale), not just *what* the code does.
   - **Zero Speculative Abstraction**: Do not introduce unnecessary abstractions, unrequested config options, or interfaces with only one implementation (YAGNI).
   - **Modular UI Design**: Keep UI code modular and decoupled (separate concerns for banner wordmark, file picker, step tracking, result cards, and prompt menus under `packages/cli/src/ui/`).
   - **No Bloat**: No defensive code for impossible scenarios, no unused helpers, no unnecessary indirection.
   - **Strict Top-Level Import Grouping**: Group all imports at the top of the file. Never place import statements mid-file or duplicate comments around them.
   - **Single Source of Truth for Core Utilities**: Share math, parsing, and data manipulation helpers (e.g. `seededShuffle` in `src/hash.ts`, `pairedObservations` in `src/score.ts`) across modules rather than copy-pasting near-duplicate functions.
   - **No Catch-All Test Files or Copy-Pasted Test Mocks**: Maintain domain-focused test files instead of catch-all coverage grab-bags. Share test mocks (`FakeNvidiaNimClient`, test configs) through `packages/cli/test/helpers.ts`.
   - **Typed Cross-Module Contracts**: A function returning a structured payload that other modules consume (e.g. `evalSkill`'s result) declares and exports a concrete interface — never `Promise<unknown>` — so every consumer reads one shape instead of re-guessing it with casts and runtime guards.
   - **Bounded Outbound Calls**: Every outbound network request (model providers, Upstash, Clerk, Stripe, npm registry) sets an explicit timeout. An unbounded fetch turns platform limits (serverless maxDuration) into opaque failures the caller cannot report.

2. **Provider Abstraction Architecture**
   - **Bring Your Own Key (BYOK)**: Supports OpenAI, Anthropic, Google Gemini, Groq, Mistral, OpenRouter, and NVIDIA NIM in addition to Hosted Mode (`SKILLCHECK_TOKEN`).
   - **Unified `LlmClient` Interface**: All model adapters implement `LlmClient` with `.complete(CompletionRequest): Promise<CompletionResponse>`.
   - **Dynamic Live Model Listing**: Provider keys are verified and available models are dynamically queried from live endpoints (`/v1/models` or provider equivalents), rather than hardcoding static model catalogs.
   - **Role Overrides**: Models default across all 3 roles (generator, runner, grader) with per-role environment variable overrides (`<PROVIDER>_GENERATOR_MODEL`, `<PROVIDER>_RUNNER_MODEL`, `<PROVIDER>_GRADER_MODEL`).
   - **Security**: Credentials are saved with strict `0600` permissions in `~/.config/skillcheck/config.json`, masked during interactive prompts, and never logged or output.

## Build and Testing Verification

Before submitting any code changes, ensure all checks pass:
```bash
npm run typecheck      # Type safety check
npm run build          # Build TypeScript distribution
npm test               # Run Vitest test suite
npm run lint           # ESLint verification
```
