# Skillcheck Dashboard

The hosted Skillcheck Cloud app: users sign in with **Google or GitHub (via Clerk)**, get a Skillcheck API key with **10 free runs**, and the CLI proxies through here to your server-side NVIDIA key. After the free runs, they upgrade via Stripe.

Static HTML/CSS/JS + Vercel serverless functions. The only dependency is `@clerk/backend` (server-side token verification). **Deploy this folder on Vercel.**

```
dashboard/
  index.html            Landing page — buttons open Clerk on click
  app.html              Signed-in dashboard (key, usage, quickstart, "What's new in the CLI")
  sso-callback.html     Clerk OAuth redirect handler
  assets/               styles.css, app.js, landing.js, auth.js (Clerk), clipboard.js
  api/
    config.js           GET  /api/config            (browser-safe: Clerk publishable key)
    health.js           GET  /api/health
    me.js               GET  /api/me                (Clerk session → account, auto-creates)
    key/rotate.js       POST /api/key/rotate
    chat/completions.js POST /api/chat/completions  (the metered proxy the CLI hits)
    billing/checkout,confirm.js                     Stripe upgrade
    _lib/               config, clerk, store (Upstash), keys, users, nvidia, stripe, http
  test/                 smoke.mjs + proxy.mjs (run with `npm test`)
  .env.example          every variable, documented
```

## "What's new in the CLI"

The signed-in dashboard (`app.html`) shows a hand-maintained changelog card so users
see new CLI features without leaving the app. It's static markup (no build step) —
when the CLI ships a release, add an entry at the top of the `<ul class="changelog">`
list and keep it in sync with the root [`CHANGELOG.md`](../CHANGELOG.md). Latest:
**v0.10.0 — matrix crash fixed, `verify` honors your configured provider, multi-line
YAML skill descriptions parse, result JSON schema deduplicated.**

## Quick start

1. Set the environment variables listed in `.env.example` (NVIDIA, Clerk, Upstash, optional Stripe) in your Vercel project.
2. Deploy on Vercel with **Root Directory = `dashboard`** and **Framework = Other**.
3. The CLI connects by pasting the `chk_live_…` key when `skillcheck` prompts for it (the hosted URL is baked in), or via `SKILLCHECK_TOKEN=chk_live_…`.

## Auth

Clerk handles sign-in. The static frontend loads ClerkJS lazily (only when a user clicks a sign-in / get-key button — the landing page never auto-redirects) and sends the Clerk session token to the dashboard's own endpoints. The backend verifies it with `@clerk/backend`. Enable Google, GitHub, or any other provider in the Clerk dashboard — no code change.

## How metering works

A "run" is one `skillcheck check`. The CLI tags every model call in a run with the same `x-skillcheck-run` id; the proxy counts **distinct** ids, so one check = one run regardless of how many model calls it makes. Free accounts get `FREE_RUNS` (default 10); the first call of the 11th run returns HTTP 402 with an upgrade link.

```bash
cd dashboard
npm install       # @clerk/backend
npm test          # logic + proxy integration smoke tests (offline)
```
