# Skillcheck — Developer & Code Quality Guidelines

## Code Quality Standards

1. **Senior Engineering Discipline**
   - **Small, Focused Functions**: Keep functions short, clear, and single-purpose.
   - **Explanatory Comments**: Write comments that explain *why* a decision was made (e.g., protocol quirks, retry behavior, fallback rationale), not just *what* the code does.
   - **Zero Speculative Abstraction**: Do not introduce unnecessary abstractions, unrequested config options, or interfaces with only one implementation (YAGNI).
   - **Modular UI Design**: Keep UI code modular and decoupled (separate concerns for banner wordmark, file picker, step tracking, result cards, and prompt menus under `packages/cli/src/ui/`).
   - **No Bloat**: No defensive code for impossible scenarios, no unused helpers, no unnecessary indirection.

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
