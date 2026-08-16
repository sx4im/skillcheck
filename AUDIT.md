# Code-Quality Audit — packages/cli, dashboard/api, packages/site

Method: every file read end to end; tooling claims verified by running `tsc` (`--listFiles`, standalone typecheck) and grep. Standards enforced are the ones CLAUDE.md already states — the relevant rule is cited per finding. Items with no literal CLAUDE.md rule are marked **[senior flag]** rather than dressed up as rule violations. Files are ordered by centrality to the product, not by smell severity.

**Counts:** 34 findings across 24 files; 2 cross-cutting.

## Cross-cutting findings

**A1. The eval result contract is untyped, and it has already caused a runtime bug.** `evalSkill(): Promise<unknown>` (eval.ts:144) hands a ~60-line object to every consumer, and each consumer reinvents its type:

- `runMatrix` casts it to `{ summary: { verdict, satisfactionScore, effectPp } }` (cli.ts:439-446). No `summary` key exists — the real shape is `result: { verdict, satisfaction, effect_pp }`. `skillcheck matrix` therefore crashes at `r.verdict.padEnd(8)` in table mode and silently drops verdict/score from JSON output.
- `formatResultCard` re-validates the same process's own output with `asRecord`/`typeof` guards (card.ts:8-32, 105-121).
- `verifyResult` carries its own inline cast (verify.ts:18-23).
- The site maintains a hand-synced mirror interface (site `lib/results.ts:5-47`).

**[senior flag]** — one typed result interface deletes all four interpretations and would have caught the matrix bug at compile time. The card even re-implements the satisfaction formula as a fallback (card.ts:30-31), duplicating eval.ts:180.

**A2. The typecheck gate checks zero test files.** `tsconfig.test.json` inherits `exclude: ["packages/cli/test/**/*.ts"]` from the base tsconfig, and exclude wins over its own `include`. The second command in `npm run typecheck` therefore re-checks the 34 src files (already covered by the first command) and nothing else. Verified: `tsc -p tsconfig.test.json --noEmit --listFiles` lists 0 test files. Live proof it matters: `test/helpers.ts:1` imports `NvidiaConfig` from `nvidia-nim.js`, which declares that type locally without exporting it (TS2459 when the file is checked standalone), and `testNvidiaConfig` (helpers.ts:5-11) omits four required fields of the real interface — both invisible to the gate. Violates CLAUDE.md **Build and Testing Verification**: the gate passes while checking nothing new, which is also how 18 `as unknown as NvidiaNimClient` double-casts in tests went unchallenged (17.2).

## 1. packages/cli/src/eval.ts — orchestrator + result contract (most central)

1.1 `evalSkill` (144) returns `Promise<unknown>` — see A1. **[senior flag]**
1.2 `runner_version`/`grader_version` (195, 197) duplicate `runner_model`/`grader_model`; `tool_dependent` + `toolDependent` are emitted in two objects (190-191 and 215-216) with no comment naming a consumer. The downstream cost is visible: card.ts:119 needs a four-way `??` chain to read the flag, and rot.ts:152 needs `runner_version ?? runner_model`. **[senior flag]** — duplicate output keys with no documented reason to exist.
1.3 `taskBreakdowns` (44-58) and `buildExplain` (94-100) hand-roll the same arm-filter + pass-rate calculation, and the copies have drifted: `buildExplain` guards division by zero (98-99), `taskBreakdowns` does not (54-55). Violates **Single Source of Truth for Core Utilities**.
1.4 `parseTaskSuite` (120-124) re-implements `validateTasks`' array-vs-`{tasks}` extraction from generate.ts:30-35. Same rule.
1.5 The satisfaction formula exists twice: eval.ts:180 and the card fallback at card.ts:30-31. Same rule — math helpers get shared, not copied.
1.6 `TaskBreakdown.arm_a_pass_rate`/`arm_b_pass_rate` (types.ts:53-55): "arm A/B" never says which arm is with-skill, while the explain block uses the explicit `with_skill_pass_rate`. **[senior flag]**, minor.

## 2. packages/cli/src/cli.ts — command router

2.1 `runMatrix` (436-453) — the broken shape cast, see A1; also returns `Promise<unknown>` (432). Its hardcoded default model ids (420: `openai/gpt-4o`, `anthropic/claude-3-5-sonnet-20241022`, `google/gemini-1.5-pro`) are NIM/OpenRouter-style namespace ids passed verbatim as the `model` field — they only resolve against NVIDIA NIM, contradicting CLAUDE.md **§2 Dynamic Live Model Listing** and breaking the BYOK promise for `matrix`.
2.2 Option-name string lists are repeated per command: `VALUE_OPTIONS` (181-196) overlaps the per-command lists passed to `assertKnownOptions` (314, 348, 366, 378, 412); the literal `'--tasks'` appears eight-plus times. When one list drifts, a valid option becomes "Unknown option". **Single Source of Truth** in spirit.
2.3 `printHelp` (42-44) wraps `printHelpUi` one-for-one — indirection adding no value. **No Bloat** (unnecessary indirection), trivial.
2.4 The comment at 493-494 says the effort confirmation prints "Standard · 3 tasks × 2 trials"; prompts.ts:149 defines Standard as 3 tasks × 3 trials. A why-comment that misdescribes behavior. **Explanatory Comments**.
2.5 `runInteractiveCheck` (543) re-validates an already-picked path by constructing fake argv through `parseCheckOptions` instead of calling `validateSkillInput` directly. **No Bloat** (indirection), minor.

## 3. packages/cli/src/run.ts — A/B runner

3.1 Clean overall; the cache-key/pseudo-replication comment (31-38) is exemplary. One note: `messagesForArm` (7-19) is re-implemented with different wording in m0/run.ts:54-66 — see 15.1.

## 4. packages/cli/src/grade.ts — blind grading

4.1 `parseGrade` fallback (40-42): a pass requires pass-words and zero negation words anywhere in the grader's own prose, so "meets the criterion; does not include a template but that is optional" scores 0. Longer, more structured with-skill outputs attract nuanced grader prose, meaning the bias correlates with arm — something blinding cannot fix. Documented as "last-resort" but the bias direction is unstated. **[senior flag]**.

## 5. packages/cli/src/generate.ts — task generation

5.1 `validateTasks` extraction duplicated by eval.ts `parseTaskSuite` — see 1.4. Otherwise clean.

## 6. packages/cli/src/normalize.ts — input contract

6.1 `extractFrontMatter` (83) only matches same-line values: `description: >` — the standard YAML folded scalar and a common authoring style for skills — extracts the domain as the literal string `">"` (verified by running the built code against a real skill file that uses it). Any multi-line description gets a garbage or fallback domain. **[senior flag]** — the parser for the project's primary input format rejects that format's standard multi-line form.
6.2 The repo carries two independent hand-rolled format parsers (front matter here, a YAML subset in corpus.ts) with the same failure class. **Single Source of Truth** (parsing helpers).

## 7. packages/cli/src/score.ts — statistics

7.1 `createSeededRandom` (41-47) duplicates the LCG already inlined inside `seededShuffle` (hash.ts:29-32) — same Numerical-Recipes constants, two copies. CLAUDE.md cites `seededShuffle` as the canonical shared utility, yet its own PRNG is not shared. **Single Source of Truth**.

## 8. packages/cli/src/verify.ts — reproducibility path

8.1 `verifyResult` (17) returns `Promise<unknown>`. **[senior flag]**, see A1.
8.2 Lines 33-34 hardcode `loadNvidiaConfig()` + `NvidiaNimClient` regardless of the user's active provider — a Mistral/OpenAI/Anthropic BYOK user running `verify` has their key sent to `integrate.api.nvidia.com`. Violates CLAUDE.md **§2 Provider Abstraction** (BYOK + unified `LlmClient`): this path should use `loadProviderConfig()` + `createLlmClient()` like every other one.

## 9. packages/cli/src/env.ts + adapters/providers.ts — provider layer

9.1 `NvidiaConfig` (env.ts:10-20) duplicates `ProviderConfig`'s nine fields, and `loadNvidiaConfig` (155-168) re-wraps `loadProviderConfig()` with `??` fallbacks for fields that function already guarantees — dead defensive code keeping a NVIDIA-era shape alive for two callers. **No Bloat** (defensive code for impossible scenarios) + **Zero Speculative Abstraction**.

## 10. packages/cli/src/adapters/ — clients

10.1 anthropic.ts and gemini.ts are structural twins: identical `sleep` (also in openai-compat.ts — three copies), same constructor pattern, same ~50-line retry loop (anthropic 56-110 vs gemini 61-112), same `(error as …).status` attachment hack. The three adapters also disagree on retry policy for the same product: openai-compat retries 408/409/429/5xx with Retry-After, jitter, and 8 attempts; anthropic/gemini retry 429/5xx over 5 attempts with none of that. **Single Source of Truth** (copy-paste) + **[senior flag]** (policy inconsistency).
10.2 anthropic.ts:32 / gemini.ts:32 serialize non-string message content with `JSON.stringify` — a dead branch (every caller sends string content) that would silently send JSON-as-text if ever hit, while openai-compat.ts:7-29 has a proper extractor. Three content-handling strategies behind one interface. **No Bloat** + **Single Source of Truth**.
10.3 nvidia-nim.ts:5 re-exports `CompletionRequest`/`CompletionResponse` that nothing imports (verified by grep) — unused helper. The class itself only forwards to `OpenAiCompatClient` and sets one boolean (`sendChatTemplateKwargs`), which providers.ts could pass directly. **No Bloat**.

## 11. packages/cli/src/config.ts — user config

11.1 `loadUserConfig` (160-165): `if (code === 'ENOENT') return {}; return {};` — both branches identical, and a corrupted config file is silently replaced by `{}` (a user's saved key vanishes without any warning). **No Bloat** (dead branch) + **[senior flag]** (silent data loss).

## 12. packages/cli/src/corpus.ts — batch runner

12.1 The worker-pool loop (274-284) re-implements `run.ts`'s `asyncPool` (62-73). **Single Source of Truth** — direct hit.
12.2 The repo/grouping key expression is written twice, in `prepareSources` (207) and `runOne` (235); if the two drift, evals read the wrong checkout. Same rule.
12.3 `parseCorpusManifest` (74-120) is a regex YAML-subset parser — no quoted colons, block scalars, or nested lists; see 6.2 for the paired failure class. **[senior flag]**.

## 13. packages/cli/src/rot.ts — rot reporting

13.1 Well-typed with input guards; clean. Its `resultKey` (71-73) is duplicated in the site — see 18.1.

## 14. packages/cli/src/hash.ts, cache.ts, update.ts, deterministic.ts

14.1 All clean. The hash.ts LCG duplication is noted at 7.1.

## 15. packages/cli/src/m0/ — calibration gate

15.1 `buildMessages` (54-66) re-implements `run.ts`'s `messagesForArm` (7-19) with different system-prompt wording. Either share the builder or add a why-comment declaring independence from the code under test; today it drifts silently. **Single Source of Truth** / **Explanatory Comments**.
15.2 m0/run.ts:141 types the gate to `NvidiaNimClient`/`loadNvidiaConfig` — same NVIDIA-only coupling as 8.2 at lower stakes. **§2 Provider Abstraction**, minor.

## 16. packages/cli/src/ui/ — terminal UX

16.1 Double barrel: `src/ui.ts` (1 line) re-exports `ui/index.ts` (5 lines), which re-exports the five modules — two passthrough layers in front of every import. **No Bloat** (indirection).
16.2 `selectEffort` (prompts.ts:183-234) and `selectMenuOption` (243-327) are two ~80-line copies of the same menu loop (draw/redraw, j/k wraparound, raw-mode cleanup); `selectSkillPath` (picker.ts:207-274) is a third variant of the navigation loop, and `visibleWindow` (picker.ts:122-125) is re-derived inline at prompts.ts:264. **Single Source of Truth**.
16.3 `theme.ts` sits at `src/theme.ts` while CLAUDE.md places UI concerns under `src/ui/` — placement inconsistency with **Modular UI Design**, cosmetic.
16.4 The SIGINT/cursor-restore/exit-130 sequence is written three times (card.ts:225-229, progress.ts:94-99, and the CancelledError paths in prompts/picker). **Single Source of Truth**, minor.

## 17. packages/cli/test/ + tsconfigs

17.1 The gate break itself — see A2 (tsconfig.test.json inheritance + the latent TS2459 in helpers.ts).
17.2 18 `as unknown as NvidiaNimClient` double-casts (run.test.ts, grade.test.ts, generate.test.ts, m0.test.ts) where the production signatures accept `LlmClient` — tests coupled to the concrete NIM class, undermining CLAUDE.md **§2 Unified LlmClient Interface**; unchecked because of A2.
17.3 Compliant: 24 domain-focused test files and one shared `FakeNvidiaNimClient` in helpers.ts — **rule 8 (no catch-all test files, no copy-pasted mocks) is honored**.

## 18. packages/site — leaderboard

18.1 `slugify` (results.ts:77-82) is a copy of hash.ts:13-18; `listJsonFiles` (111-133) is a verbatim copy of rot.ts:98-119; `resultKey` (107-109) re-implements rot.ts:71-73. The last one is a load-bearing string-match contract between two packages with no shared source — if either key format drifts, rot badges silently disappear from the leaderboard. **Single Source of Truth** (cross-package).
18.2 `LeaderboardResult` (5-47) is the fourth hand-rolled interpretation of the eval result — a direct consequence of A1.
18.3 Components are clean, typed React; the site is type-checked via `next build` (no `ignoreBuildErrors`).

## 19. dashboard/api — hosted backend (untyped JS)

19.1 Nothing statically checks this code. eslint explicitly ignores `dashboard/**`; the exclusion comment in eslint.config.mjs claims the dashboard "ships its own plain-JS serverless functions" as if a separate toolchain covers them — it does not: there is no lint, no types, no JSDoc, only runtime smoke tests. The strict-TS CLI vs untyped-JS API gap is real, and the comment misstates the situation, so it cannot even count as a documented decision. **[senior flag]**.
19.2 `getUser` (users.js:13-16) returns `JSON.parse` output consumed bare (`user.plan`, `user.apiKey` at call sites) — no shape validation anywhere in the module. **[senior flag]**, consequence of 19.1.
19.3 me.js:14-18 and key/rotate.js:12-15 duplicate the ensure-user block (getUser → fetchClerkProfile → getOrCreateUser); me.js:29 and key/verify.js:39 duplicate the quota-shaping expression (`Number.isFinite(limit) ? limit : null`). **Single Source of Truth** in spirit.
19.4 users.js:6 header comment documents the store layout as `runsused:<uid>`; the code writes `runsused:<uid>:<month>` (29, 104) — a why-comment describing a schema the code has moved past. **Explanatory Comments**.
19.5 `getOrCreateUser` (37-52) and `consumeRun` (86-106) are check-then-act across awaited I/O: two concurrent first `/api/me` calls can mint two API keys and orphan one key mapping, and the quota boundary can over-count by one. Untyped JS makes the races easier to miss. **[senior flag]**.
19.6 No timeout on any outbound fetch: store.js `upstash` (28-42), nvidia.js `forwardChatCompletion` (51), clerk.js `fetchClerkProfile` (28), stripe.js (15). The CLI adapters all carry AbortController timeouts — the same failure class gets opposite treatment across the repo. **[senior flag]**.
19.7 nvidia.js:43-45 — `enable_thinking:false` is merged beneath caller-supplied `chat_template_kwargs`, and the comment admits a caller can re-enable it; a cost guard that is advisory. **[senior flag]**.
19.8 chat/completions.js meters the run (32) before reading the request body (43) — a malformed request still consumes quota. **[senior flag]**, minor.
19.9 billing/confirm.js (11) mutates the plan on GET — a state-changing GET behind Clerk auth that prefetchers or link scanners can trigger. **[senior flag]**, minor.
19.10 stripe.js:23 parses `response.json()` before checking `response.ok` — a Stripe HTML error page surfaces as an unhandled SyntaxError instead of a handled failure. **[senior flag]**, minor.
19.11 _lib/config.js:24 — `TOKEN_PEPPER` falls back to the hardcoded `'skillcheck-dev-pepper'`; a prod deploy without `TOKEN_PEPPER`/`CLERK_SECRET_KEY` hashes every issued API key with a public constant. **[senior flag]**, security.
19.12 config.js, health.js, key/verify.js structure and the http.js helpers are clean for untyped JS.

## What the audit did not find (calibration)

- No mid-file imports — **Strict Top-Level Import Grouping** is honored everywhere.
- No unused exported functions beyond the nvidia-nim type re-exports (10.3); `slugify` and `cloudPricingUrl` all have callers.
- Rule 8 (test hygiene) fully honored (17.3).
- hash.ts, cache.ts, update.ts, deterministic.ts, rot.ts, theme.ts, progress.ts, and the site components are clean by these standards.
- Many files carry genuinely good why-comments (run.ts's cache-key rationale, cache.ts's tautology note, config.ts's legacy-host migration). The comment discipline is real; the failures above are specific, not pervasive.

## Summary

The highest-leverage fix is A1 — type the result contract. It deletes four hand-rolled interpretations, one live runtime bug (`matrix`), and the card's self-re-validation. The second is A2 — stop tsconfig.test.json from inheriting the test exclude — which turns the existing gate back on and surfaces the latent type errors for free. Everything else is localized.
