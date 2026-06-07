# Skillcheck Dashboard — Setup Guide

This is the complete, click-by-click guide to deploy the dashboard and wire up every API key. Follow it top to bottom once. Total time: ~20–30 minutes.

## What you are building

```
User → signs in with Google or GitHub (via Clerk) on your dashboard
     → gets a Skillcheck API key (chk_live_…) with 10 free runs
     → pastes it into the skillcheck CLI
CLI  → calls https://your-app.vercel.app/api/chat/completions  (Bearer chk_live_…)
Proxy→ authenticates the key, meters the run, then calls NVIDIA with YOUR server key
     → after 10 runs, returns 402 and the user upgrades (Stripe)
```

Your NVIDIA key lives **only** on Vercel as an environment variable. It is never in the npm package, the browser, or the user's terminal.

## What you need (all have free tiers)

| Platform | Used for | Required |
|---|---|---|
| [Vercel](https://vercel.com) | Hosts the dashboard + API | Yes |
| [NVIDIA build](https://build.nvidia.com) | The model provider (NIM) | Yes |
| [Clerk](https://clerk.com) | Sign-in (Google, GitHub, …) | Yes |
| [Upstash](https://upstash.com) | Redis database (users, keys, run counts) | Yes |
| [Stripe](https://stripe.com) | Paid upgrade after 10 runs | Optional |

---

## Step 1 — NVIDIA API key (the upstream model)

1. Go to <https://build.nvidia.com>, sign in.
2. Open any model (e.g. **minimaxai/minimax-m2.7**).
3. Click **Get API Key** / **Generate Key**. It looks like `nvapi-…`.
4. Save it. You will paste it as `NVIDIA_API_KEY` in Step 5.

> The dashboard pins all hosted requests to `SKILLCHECK_MODEL` (default `minimaxai/minimax-m2.7`) for cost control.

## Step 2 — Clerk (sign-in with Google + GitHub)

1. Go to <https://dashboard.clerk.com>, sign in, **Create application**.
2. Name it `Skillcheck`. Under the sign-in options, enable **Google** and **GitHub** (and email/anything else you want). Clerk supplies shared dev OAuth credentials so these work immediately in development.
3. Open **API keys** and copy:
   - **Publishable key** (`pk_test_…` or `pk_live_…`) → `CLERK_PUBLISHABLE_KEY`
   - **Secret key** (`sk_test_…` or `sk_live_…`) → `CLERK_SECRET_KEY`
4. Save both for Step 5.

> Development keys (`pk_test_…`) work right away on your Vercel URL for testing (with a small Clerk dev badge). For production without the badge, create a Clerk **production** instance and add your domain under **Domains**. To add or remove providers later, just toggle them in Clerk — no code change.

## Step 3 — Upstash Redis (storage)

1. Go to <https://console.upstash.com>, sign in.
2. **Create Database** → name `skillcheck` → pick a region near your Vercel region → **Create**.
3. On the database page, under **REST API**, copy:
   - **UPSTASH_REDIS_REST_URL** (e.g. `https://us1-xxx.upstash.io`)
   - **UPSTASH_REDIS_REST_TOKEN**
4. Save both for Step 5.

> Without Upstash the app falls back to in-memory storage, which is wiped on every deploy/instance — fine for local testing, not for production.

## Step 4 — Pepper for API keys (optional but recommended)

`TOKEN_PEPPER` is mixed in when hashing issued API keys. If unset it defaults to `CLERK_SECRET_KEY`. To set your own:

```bash
openssl rand -base64 32   # → TOKEN_PEPPER
```

## Step 5 — Deploy to Vercel

1. Push this repository to GitHub (the dashboard lives in the `dashboard/` folder).
2. Go to <https://vercel.com/new> → **Import** your repo.
3. **Configure Project**:
   - **Root Directory**: click **Edit** → select `dashboard`.
   - **Framework Preset**: **Other**.
4. Expand **Environment Variables** and add everything from the table below.
5. **Deploy**. You get a URL like `https://skillcheck-xyz.vercel.app`.
6. (Production Clerk only) add that domain in Clerk → **Domains**, then redeploy.

### Environment variables to set in Vercel

| Name | Value / source | Required |
|---|---|---|
| `NVIDIA_API_KEY` | `nvapi-…` from Step 1 | Yes |
| `NVIDIA_BASE_URL` | `https://integrate.api.nvidia.com/v1` | No (default) |
| `SKILLCHECK_MODEL` | `minimaxai/minimax-m2.7` | No (default) |
| `CLERK_PUBLISHABLE_KEY` | from Step 2 | Yes |
| `CLERK_SECRET_KEY` | from Step 2 | Yes |
| `UPSTASH_REDIS_REST_URL` | from Step 3 | Yes |
| `UPSTASH_REDIS_REST_TOKEN` | from Step 3 | Yes |
| `TOKEN_PEPPER` | from Step 4 | Recommended |
| `FREE_RUNS` | `10` | No (default) |
| `PRO_RUN_LIMIT` | `0` (0 = unlimited) | No |
| `STRIPE_SECRET_KEY` | from Step 7 | Only for billing |
| `STRIPE_PRICE_ID` | from Step 7 | Only for billing |
| `STRIPE_MODE` | `payment` or `subscription` | No (default `payment`) |

> After changing any env var, **redeploy** — Vercel applies env vars to new deployments only.

## Step 6 — Test the core flow (do this before billing)

1. Visit `https://YOUR-APP.vercel.app`. The landing page loads normally — it does **not** redirect to sign-in until you click a button.
2. Click **Get your API key** (or **Continue with Google / GitHub**) → complete Clerk sign-in.
3. You land on the dashboard with a `chk_live_…` key, usage `0 / 10`, and quickstart commands.
4. In a terminal:

   ```bash
   npm install -g @sx4im/skillcheck
   skillcheck                # paste your chk_live_ key when asked, then pick a skill file
   ```

5. Reload the dashboard — **Usage** should tick up by 1. That confirms: Clerk auth → key → metered proxy → NVIDIA all work.

## Step 7 — Stripe upgrade (optional)

Skip this to launch a free-only beta; the Upgrade button stays hidden until both Stripe vars are set.

1. <https://dashboard.stripe.com/apikeys> → copy the **Secret key** → `STRIPE_SECRET_KEY`.
2. <https://dashboard.stripe.com/products> → **Add product** → set a price (e.g. $19 one-time) → copy the **Price ID** (`price_…`) → `STRIPE_PRICE_ID`.
3. Set `STRIPE_MODE=payment` (one-time unlock) or `subscription` (recurring).
4. Add the three vars in Vercel → **redeploy**.
5. The dashboard now shows **Upgrade to Pro**. Payment redirects to Stripe Checkout and, on return, the app verifies the session server-side and flips the account to `pro` (unlimited). No webhook required.

> Use Stripe **test mode** keys + card `4242 4242 4242 4242` to rehearse before going live.

---

## Connecting the CLI (what your users do)

```bash
# Interactive (recommended): the hosted URL is built into the CLI, so users
# only paste their key. It is verified before saving, then the file picker opens.
skillcheck                # or: skillcheck setup

# Or non-interactive via environment variable
export SKILLCHECK_TOKEN=chk_live_...
skillcheck check ./SKILL.md
```

When free runs run out, the CLI prints a clear message with your dashboard URL to upgrade.

> Self-hosting under a different domain? Point the CLI at it with `export SKILLCHECK_API_URL=https://your-domain/api` (and optionally `SKILLCHECK_WEB_URL` for the "grab your key" link).

## Operating it

- **Add/remove sign-in providers**: toggle them in Clerk → no code change.
- **Change free-run allowance**: set `FREE_RUNS` and redeploy.
- **Give someone Pro manually**: in Upstash, find `user:<clerkUserId>` and set `"plan":"pro"`.
- **A user lost / leaked their key**: they click **Rotate key**; the old key stops working immediately.

## Security notes

- `NVIDIA_API_KEY`, `STRIPE_SECRET_KEY`, `UPSTASH_*`, `CLERK_SECRET_KEY` live only in Vercel env vars — never commit them.
- Dashboard endpoints (`/api/me`, `/api/key/rotate`, `/api/billing/*`) require a verified Clerk session token. The CLI-facing endpoints (`/api/chat/completions`, `/api/key/verify`) are authenticated by the `chk_live_` key, not Clerk.
- API keys are stored so the dashboard can show them to their owner, and indexed by `sha256(key + TOKEN_PEPPER)` for proxy lookup. They grant only metered access to your proxy and are revocable by rotation.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Buttons do nothing / "Sign-in is not configured" | Set `CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` and redeploy |
| Google/GitHub not offered on Clerk's page | Enable those Social connections in the Clerk dashboard |
| Dashboard shows the key but the CLI says "not connected" | `SKILLCHECK_API_URL` must end in `/api` (e.g. `https://app.vercel.app/api`) |
| `Server is missing NVIDIA_API_KEY` from a check | Set `NVIDIA_API_KEY` in Vercel and redeploy |
| Usage never increments | `UPSTASH_*` not set → in-memory store resets per request; add Upstash |
| Upgrade button missing | Set both `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID`, then redeploy |
| Checks fail with a timeout | The proxy is configured for a 60s `maxDuration` (`vercel.json`). Vercel's Hobby plan may cap duration lower — upgrade the plan if long model calls are cut off |

## Local development

```bash
cd dashboard
npm install                  # installs @clerk/backend
npm install -g vercel        # once
vercel dev                   # serves static pages + /api functions on localhost
npm test                     # runs the logic + proxy integration smoke tests (offline)
```

For `vercel dev`, put the same variables in a local `.env` (copy from `.env.example`). Without Upstash it uses an in-memory store that resets when the dev server restarts.
