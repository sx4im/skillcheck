# Skillcheck Dashboard

The hosted Skillcheck Cloud app: users sign in with GitHub, get a Skillcheck API key with **10 free runs**, and the CLI proxies through here to your server-side NVIDIA key. After the free runs, they upgrade via Stripe.

Zero-dependency, zero-build — static HTML/CSS/JS plus Vercel serverless functions. **Deploy this folder on Vercel.**

```
dashboard/
  index.html            Landing page (sign in, pricing)        — HP-style design (see ../DESIGN.md)
  app.html              Signed-in dashboard (key, usage, preview)
  assets/               styles.css, app.js, landing.js
  api/
    health.js           GET  /api/health
    me.js               GET  /api/me              (session → account)
    auth/login,callback,logout.js                 GitHub OAuth
    key/rotate.js       POST /api/key/rotate
    chat/completions.js POST /api/chat/completions (the metered proxy the CLI hits)
    billing/checkout,confirm.js                   Stripe upgrade
    _lib/               config, store (Upstash), session, keys, users, nvidia, stripe
  test/                 smoke.mjs + proxy.mjs (run with `npm test`)
  .env.example          every variable, documented
  SETUP.md              full click-by-click deploy + API-key guide
```

## Quick start

1. Read **[SETUP.md](SETUP.md)** — it walks through NVIDIA, Upstash, GitHub OAuth, Stripe, and the Vercel deploy.
2. Deploy on Vercel with **Root Directory = `dashboard`** and **Framework = Other**.
3. The CLI connects with `SKILLCHECK_API_URL=https://your-app.vercel.app/api` and `SKILLCHECK_TOKEN=sk_live_…`.

## How metering works

A "run" is one `skillcheck check`. The CLI tags every model call in a run with the same `x-skillcheck-run` id; the proxy counts **distinct** ids, so one check = one run regardless of how many model calls it makes. Free accounts get `FREE_RUNS` (default 10); the first call of the 11th run returns HTTP 402 with an upgrade link.

```bash
cd dashboard
npm test          # logic + proxy integration smoke tests (offline)
```
