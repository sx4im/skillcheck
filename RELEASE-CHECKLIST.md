# Release Checklist

Do not publish to npm until every item below is complete.

## Preconditions

- `BUILD-LOG.md` records M0-M5 as passed.
- `DECISIONS.md` records the current model slugs and source URLs.
- `.env` contains a valid `NVIDIA_API_KEY`.
- `NVIDIA_GENERATOR_MODEL`, `NVIDIA_GRADER_MODEL`, and `NVIDIA_RUNNER_MODEL` resolve on build.nvidia.com.
- `git status --short` is clean except intentional release edits.

## M5 Corpus Run

1. Confirm runner health:

   ```bash
   node --input-type=module -e "import { NvidiaNimClient } from './dist/src/adapters/nvidia-nim.js'; import { loadNvidiaConfig } from './dist/src/env.js'; const config = loadNvidiaConfig(); const client = new NvidiaNimClient(config); const result = await client.complete({ model: config.runnerModel, temperature: 0, maxTokens: 4, messages: [{ role: 'user', content: 'Reply with OK.' }] }); console.log(JSON.stringify({ model: result.model, content: result.content, usage: result.usage }, null, 2));"
   ```

2. Warm the cache on one seed skill:

   ```bash
   jq '.skills = [.skills[7]]' corpus/launch-20.json > /tmp/skillcheck-m5-sample.json
   node dist/bin/skillcheck.js corpus run --corpus /tmp/skillcheck-m5-sample.json --results /tmp/skillcheck-m5-cache-warm --tasks 2 --trials 3 --concurrency 1
   ```

3. Run the capped 20-skill corpus:

   ```bash
   NVIDIA_TIMEOUT_MS=120000 NVIDIA_REQUEST_DELAY_MS=5000 NVIDIA_MAX_ATTEMPTS=8 NVIDIA_MAX_RETRY_DELAY_MS=60000 node dist/bin/skillcheck.js corpus run --corpus corpus/launch-20.json --results results/launch/$(date -u +%Y%m%dT%H%M%SZ) --tasks 10 --trials 3 --concurrency 1
   ```

4. Regenerate the launch-only rot report:

   ```bash
   node dist/bin/skillcheck.js rot --results results/launch/20260605T110514Z-qwen-next --output results/rot/report.json
   ```

5. Update `FINDINGS-DRAFT.md` from the real 20-skill result numbers.

## Verification

Run all checks:

```bash
npm run typecheck
npm test
npm run build
npm run site:build
npm audit
npm pack --dry-run
npx --yes github-actionlint .github/workflows/rot.yml
```

Confirm no skipped tests:

```bash
rg "\\.skip|describe\\.skip|it\\.skip|test\\.skip|skip\\(" packages/cli/test packages
```

The command above should print nothing.

## Publish Steps

Only after M5 passes:

1. Set the intended package version in `package.json`.
2. Commit the release prep changes.
3. Tag the release:

   ```bash
   git tag vX.Y.Z
   git push origin main --tags
   ```

4. Publish manually:

   ```bash
   npm publish --access public
   ```

5. Verify:

   ```bash
   npx skillcheck@X.Y.Z --help
   ```
