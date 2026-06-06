# Skillcheck Dashboard — Setup Guide

This is the complete, click-by-click guide to deploy the dashboard and wire up every API key. Follow it top to bottom once. Total time: ~20–30 minutes.

## What you are building

```
User → signs in with GitHub on your dashboard
     → gets a Skillcheck API key (sk_live_…) with 10 free runs
     → pastes it into the skillcheck CLI
CLI  → calls https://your-app.vercel.app/api/chat/completions  (Bearer sk_live_…)
Proxy→ authenticates the key, meters the run, then calls NVIDIA with YOUR server key
     → after 10 runs, returns 402 and the user upgrades (Stripe)
```

Your NVIDIA key lives **only** on Vercel as an environment variable. It is never in the npm package, the browser, or the user's terminal.

## What you need (5 accounts, all have free tiers)

| Platform | Used for | Required |
|---|---|---|
| [Vercel](https://vercel.com) | Hosts the dashboard + API | Yes |
| [NVIDIA build](https://build.nvidia.com) | The model provider (NIM) | Yes |
| [Upstash](https://upstash.com) | Redis database (users, keys, run counts) | Yes |
| [GitHub OAuth](https://github.com/settings/developers) | Sign-in | Yes |
| [Stripe](https://stripe.com) | Paid upgrade after 10 runs | Optional |

---

## Step 1 — NVIDIA API key (the upstream model)

1. Go to <https://build.nvidia.com>, sign in.
2. Open any model (e.g. **qwen/qwen3-next-80b-a3b-instruct**).
3. Click **Get API Key** / **Generate Key**. It looks like `nvapi-…`.
4. Save it. You will paste it as `NVIDIA_API_KEY` in Step 5.

> The dashboard pins all hosted requests to `SKILLCHECK_MODEL` (default `qwen/qwen3-next-80b-a3b-instruct`) for cost control. Change it in env if you want a different backing model.

## Step 2 — Upstash Redis (storage)

1. Go to <https://console.upstash.com>, sign in.
2. **Create Database** → name `skillcheck` → pick a region near your Vercel region → **Create**.
3. On the database page, scroll to **REST API** and copy:
   - **UPSTASH_REDIS_REST_URL** (e.g. `https://us1-xxx.upstash.io`)
   - **UPSTASH_REDIS_REST_TOKEN** (a long token)
4. Save both for Step 5.

> Without Upstash the app falls back to in-memory storage, which is wiped on every deploy/instance — fine for local testing, not for production.

## Step 3 — GitHub OAuth app (sign-in)

You need your final app URL for the callback. If you do not have it yet, do Step 5 first to get the `https://<app>.vercel.app` URL, then come back.

1. Go to <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**.
2. Fill in:
   - **Application name**: `Skillcheck`
   - **Homepage URL**: `https://YOUR-APP.vercel.app`
   - **Authorization callback URL**: `https://YOUR-APP.vercel.app/api/auth/callback`
3. **Register application**.
4. Copy the **Client ID** → `AUTH_GITHUB_ID`.
5. Click **Generate a new client secret** → copy it → `AUTH_GITHUB_SECRET`.

## Step 4 — Generate auth secrets

Run locally and copy each output:

```bash
openssl rand -base64 32   # → AUTH_SECRET
openssl rand -base64 32   # → TOKEN_PEPPER
```

`AUTH_SECRET` signs login cookies. `TOKEN_PEPPER` hashes API keys before storage.

## Step 5 — Deploy to Vercel

1. Push this repository to GitHub (the dashboard lives in the `dashboard/` folder).
2. Go to <https://vercel.com/new> → **Import** your repo.
3. **Configure Project**:
   - **Root Directory**: click **Edit** → select `dashboard`.
   - **Framework Preset**: **Other** (it is plain static files + serverless functions — no build step).
4. Expand **Environment Variables** and add everything from the table below.
5. **Deploy**. You get a URL like `https://skillcheck-xyz.vercel.app`.
6. If you had not created the GitHub OAuth app yet, do Step 3 now with this URL, then add `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` in **Settings → Environment Variables** and **redeploy**.

### Environment variables to set in Vercel

| Name | Value / source | Required |
|---|---|---|
| `NVIDIA_API_KEY` | `nvapi-…` from Step 1 | Yes |
| `NVIDIA_BASE_URL` | `https://integrate.api.nvidia.com/v1` | No (default) |
| `SKILLCHECK_MODEL` | `qwen/qwen3-next-80b-a3b-instruct` | No (default) |
| `UPSTASH_REDIS_REST_URL` | from Step 2 | Yes |
| `UPSTASH_REDIS_REST_TOKEN` | from Step 2 | Yes |
| `AUTH_GITHUB_ID` | from Step 3 | Yes |
| `AUTH_GITHUB_SECRET` | from Step 3 | Yes |
| `AUTH_SECRET` | from Step 4 | Yes |
| `TOKEN_PEPPER` | from Step 4 | Recommended |
| `FREE_RUNS` | `10` | No (default) |
| `PRO_RUN_LIMIT` | `0` (0 = unlimited) | No |
| `STRIPE_SECRET_KEY` | from Step 7 | Only for billing |
| `STRIPE_PRICE_ID` | from Step 7 | Only for billing |
| `STRIPE_MODE` | `payment` or `subscription` | No (default `payment`) |

> After changing any env var, **redeploy** — Vercel applies env vars to new deployments only.

## Step 6 — Test the core flow (do this before billing)

1. Visit `https://YOUR-APP.vercel.app` → **Sign in with GitHub** → authorize.
2. You land on the dashboard with a `sk_live_…` key, usage `0 / 10`, and quickstart commands.
3. In a terminal:

   ```bash
   npm install -g @sx4im/skillcheck
   export SKILLCHECK_API_URL=https://YOUR-APP.vercel.app/api
   export SKILLCHECK_TOKEN=sk_live_...        # your key from the dashboard
   skillcheck check ./SKILL.md
   ```

4. Reload the dashboard — **Usage** should tick up by 1. That confirms: auth → key → metered proxy → NVIDIA all work.

## Step 7 — Stripe upgrade (optional)

Skip this to launch a free-only beta; the Upgrade button stays hidden until both Stripe vars are set.

1. Go to <https://dashboard.stripe.com/apikeys> → copy the **Secret key** (`sk_live_…` or `sk_test_…`) → `STRIPE_SECRET_KEY`.
2. Go to <https://dashboard.stripe.com/products> → **Add product** → set a price (e.g. $19 one-time) → copy the **Price ID** (`price_…`) → `STRIPE_PRICE_ID`.
3. Set `STRIPE_MODE=payment` (one-time unlock) or `subscription` (recurring).
4. Add the three vars in Vercel → **redeploy**.
5. The dashboard now shows **Upgrade to Pro**. Payment redirects to Stripe Checkout and, on return, the app verifies the session server-side and flips the account to `pro` (unlimited). No webhook required.

> Use Stripe **test mode** keys + card `4242 4242 4242 4242` to rehearse before going live.

---

## Connecting the CLI (what your users do)

Give users either flow:

```bash
# Interactive
skillcheck setup     # paste the API URL, then the API key

# Or environment variables
export SKILLCHECK_API_URL=https://YOUR-APP.vercel.app/api
export SKILLCHECK_TOKEN=sk_live_...
skillcheck check ./SKILL.md
```

When free runs run out, the CLI prints a clear message with your dashboard URL to upgrade.

## Operating it

- **Change free-run allowance**: set `FREE_RUNS` and redeploy.
- **Give someone Pro manually**: in the Upstash console, find `user:<uid>`, set `"plan":"pro"`. (Find the uid via `ghid:<githubId>`.)
- **A user lost / leaked their key**: they click **Rotate key** in the dashboard; the old key stops working immediately.
- **Cost control**: every hosted request is pinned to one model and capped at `max_tokens` by the CLI; metering caps free usage at `FREE_RUNS` runs per account.

## Security notes

- `NVIDIA_API_KEY`, `STRIPE_SECRET_KEY`, `UPSTASH_*`, `AUTH_SECRET` live only in Vercel env vars — never commit them.
- API keys are stored so the dashboard can show them to their owner; they are also indexed by `sha256(key + TOKEN_PEPPER)` for proxy lookup. They grant only metered access to your proxy and are revocable by rotation.
- Session cookies are HttpOnly, Secure, SameSite=Lax, and HMAC-signed with `AUTH_SECRET`.
- The proxy uses Bearer-key auth (not cookies), so its permissive CORS cannot be abused with a victim's ambient credentials.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `GitHub sign-in is not configured` | `AUTH_GITHUB_ID` not set, or you didn't redeploy after setting it |
| Redirect loop / `error=oauth_state` | The OAuth **callback URL** must be exactly `https://YOUR-APP.vercel.app/api/auth/callback` |
| Dashboard shows the key but the CLI says "not connected" | `SKILLCHECK_API_URL` must end in `/api` (e.g. `https://app.vercel.app/api`) |
| `Server is missing NVIDIA_API_KEY` from a check | Set `NVIDIA_API_KEY` in Vercel and redeploy |
| Usage never increments | `UPSTASH_*` not set → in-memory store resets per request; add Upstash |
| Upgrade button missing | Set both `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID`, then redeploy |
| Checks fail with a timeout | The proxy is configured for a 60s `maxDuration` (`vercel.json`). Vercel's Hobby plan may cap function duration lower — upgrade the Vercel plan if long model calls are cut off |

## Local development

```bash
cd dashboard
npm install -g vercel        # once
vercel dev                   # serves static pages + /api functions on localhost
npm test                     # runs the logic + proxy integration smoke tests
```

For `vercel dev`, put the same variables in a local `.env` (copy from `.env.example`). Without Upstash it uses an in-memory store that resets when the dev server restarts.
