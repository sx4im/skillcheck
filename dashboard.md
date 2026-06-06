# Skillcheck Dashboard Plan

This document is the build plan for a separate Skillcheck Cloud dashboard and API. The goal is:

- Users install the CLI with one command.
- On first CLI run, users paste the Skillcheck API URL.
- Users can sign up in a dashboard.
- Users can create a Skillcheck token.
- The CLI calls your backend, not the upstream model provider directly.
- Your upstream provider secret stays only on the backend.

## Target Deployment

Use two separate deploys:

```text
Vercel
  app.skillcheck.yourdomain.com
  Next.js dashboard, marketing, auth pages, API key management, usage UI

Render
  api.skillcheck.yourdomain.com
  Node/Fastify or Hono API, OpenAI-compatible proxy, rate limits, usage tracking

Postgres
  Render Postgres or Neon/Supabase Postgres
  Users, API keys, usage events, runs, billing state

Redis
  Upstash Redis or Render Key Value
  Fast per-token and per-IP rate limits
```

The CLI setup URL should be:

```bash
https://api.skillcheck.yourdomain.com/v1
```

## Recommended Repos

Build this separately from the CLI repo.

```text
skillcheck-dashboard/
  apps/web/        Next.js dashboard deployed to Vercel
  apps/api/        Node API deployed to Render
  packages/db/     Prisma/Drizzle schema and migrations
  packages/shared/ shared types, token helpers, validation schemas
```

If you want to move fast, a single repo with `apps/web` and `apps/api` is better than two repos because shared types and database migrations stay together.

## Product Flow

### User Flow

1. User installs CLI:

   ```bash
   npm install -g @sx4im/skillcheck
   ```

2. User signs up on the dashboard.
3. Dashboard shows onboarding:

   ```bash
   skillcheck setup
   ```

4. User pastes:

   ```bash
   https://api.skillcheck.yourdomain.com/v1
   ```

5. If private beta, dashboard also gives a token:

   ```bash
   export SKILLCHECK_TOKEN=sk_live_...
   ```

6. User runs:

   ```bash
   skillcheck
   ```

7. CLI opens file/folder picker and calls your backend.
8. Dashboard usage page shows requests, tokens, cost estimate, verdict counts, and recent runs.

### Admin Flow

1. Admin logs into dashboard.
2. Admin sees total usage, active users, failed requests, spend estimate.
3. Admin can revoke tokens, ban abusive IPs, adjust quotas, and inspect error logs.

## Frontend: Vercel Dashboard

Use Next.js App Router.

Recommended stack:

```text
Next.js
TypeScript
Tailwind CSS
shadcn/ui or custom components
Clerk for auth if you want fastest launch
Stripe later for billing
PostHog or simple internal analytics later
```

Pages:

```text
/
  Marketing page: what Skillcheck does, install command, demo result card.

/login
  Auth page.

/onboarding
  Shows setup commands and asks user to create first token.

/dashboard
  Overview: total checks, pass/fail/verdict mix, monthly usage, active token.

/tokens
  Create, list, revoke Skillcheck tokens.
  Show token only once after creation.

/usage
  Table of requests with date, token prefix, model, status, prompt tokens, completion tokens, cost estimate.

/runs
  Optional later: user-submitted check summaries if CLI uploads metadata.

/settings
  User profile, org settings, billing, delete account.

/admin
  Admin-only usage, errors, users, abuse controls.
```

Vercel environment variables:

```bash
NEXT_PUBLIC_API_URL=https://api.skillcheck.yourdomain.com
AUTH_SECRET=...
CLERK_SECRET_KEY=...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
DATABASE_URL=...
```

If you use Clerk, do not expose backend admin secrets in the browser. Only expose `NEXT_PUBLIC_*` variables that are safe for the client.

## Backend: Render API

Use Node.js with Fastify or Hono. Fastify is a good default for this API because plugins, hooks, and logging are straightforward.

Core responsibility:

```text
Accept CLI OpenAI-compatible requests.
Authenticate Skillcheck tokens.
Rate limit by token and IP.
Forward requests to upstream provider.
Track usage and errors.
Return OpenAI-compatible responses to the CLI.
```

Render environment variables:

```bash
PORT=10000
DATABASE_URL=postgres://...
REDIS_URL=redis://...

FRONTEND_ORIGIN=https://app.skillcheck.yourdomain.com

SKILLCHECK_TOKEN_PEPPER=long-random-secret
ALLOW_ANONYMOUS=false
ANONYMOUS_DAILY_LIMIT=20

PROVIDER_BASE_URL=https://integrate.api.nvidia.com/v1
PROVIDER_API_KEY=...
DEFAULT_MODEL=qwen/qwen3-next-80b-a3b-instruct

REQUEST_TIMEOUT_MS=120000
REQUEST_DELAY_MS=5000
MAX_ATTEMPTS=8
MAX_RETRY_DELAY_MS=60000
```

Only the Render API should know `PROVIDER_API_KEY`.

## Backend Endpoints

### OpenAI-compatible CLI endpoint

The CLI already expects this:

```http
POST /v1/chat/completions
Authorization: Bearer sk_live_...
Content-Type: application/json
```

Backend behavior:

1. Parse authorization header.
2. If token is missing:
   - If `ALLOW_ANONYMOUS=true`, apply strict IP rate limit.
   - Otherwise return `401`.
3. Hash provided token and find it in `api_keys`.
4. Check revoked status.
5. Rate limit by key and IP.
6. Forward request body to upstream provider.
7. Record request usage.
8. Return upstream response unchanged where possible.

### Dashboard API endpoints

```http
GET    /health
GET    /api/me
GET    /api/usage
GET    /api/tokens
POST   /api/tokens
DELETE /api/tokens/:id
GET    /api/runs
POST   /api/runs
GET    /api/admin/users
GET    /api/admin/usage
POST   /api/admin/tokens/:id/revoke
```

Dashboard endpoints can live in the Render API, not Vercel serverless, to keep all auth, DB, and token logic in one backend.

## Database Schema

Use Postgres.

```sql
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text,
  auth_provider text not null,
  auth_provider_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  owner_user_id uuid not null references users(id),
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  user_id uuid not null references users(id),
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  prefix text not null,
  token_hash text unique not null,
  last_four text not null,
  created_by_user_id uuid not null references users(id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id),
  api_key_id uuid references api_keys(id),
  request_id text,
  path text not null,
  model text,
  status_code integer not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  ip_hash text,
  error_code text,
  created_at timestamptz not null default now()
);

create table skill_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id),
  api_key_id uuid references api_keys(id),
  skill_name text,
  skill_format text,
  verdict text,
  effect_pp numeric,
  with_skill_pass numeric,
  no_skill_pass numeric,
  tasks integer,
  trials integer,
  created_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id),
  user_id uuid references users(id),
  action text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
```

## Token Design

Token format:

```text
sk_live_<random>
sk_test_<random>
```

Token generation:

```text
random = 32 bytes from crypto.randomBytes
token = sk_live_ + base64url(random)
prefix = first 12 visible characters
last_four = last 4 characters
token_hash = sha256(token + SKILLCHECK_TOKEN_PEPPER)
```

Rules:

- Show token only once after creation.
- Store only `token_hash`, prefix, and last four.
- Never log full tokens.
- Redact auth headers from logs.
- Let users revoke tokens instantly.

## Rate Limits

Start with simple quotas:

```text
Free anonymous:
  5 checks per IP per day

Logged-in free:
  50 checks per org per month
  10 requests per minute

Paid:
  Plan-based monthly quota
  30 requests per minute
```

Implement with Redis token buckets:

```text
ratelimit:ip:<hash>:day
ratelimit:key:<api_key_id>:minute
ratelimit:org:<org_id>:month
```

If Redis is unavailable, fail closed for anonymous traffic and fail soft for authenticated paid users with logging.

## Proxy Logic

For `/v1/chat/completions`:

1. Accept the CLI request body.
2. Force or override model if needed:

   ```ts
   body.model = process.env.DEFAULT_MODEL;
   ```

3. Forward to upstream provider:

   ```http
   POST ${PROVIDER_BASE_URL}/chat/completions
   Authorization: Bearer ${PROVIDER_API_KEY}
   ```

4. Return upstream response as-is.
5. Record usage from `response.usage`.

Do not stream in v1. The current CLI sends `stream: false`, so non-streaming is enough.

## Security Checklist

- Store provider secrets only in Render environment variables.
- Store dashboard auth secrets only in Vercel or Render env vars as needed.
- Never put provider secrets in CLI, frontend code, or public docs.
- Hash Skillcheck tokens before storing.
- Use HTTPS only in production.
- CORS allow only:

  ```text
  https://app.skillcheck.yourdomain.com
  ```

- CLI requests do not need browser CORS, but dashboard API calls do.
- Log request IDs, not full payloads.
- Redact prompts by default in production logs.
- Add abuse controls before public launch.

## Vercel Deployment Plan

1. Create `skillcheck-dashboard` repo.
2. Add `apps/web` Next.js app.
3. Push to GitHub.
4. Import repo in Vercel.
5. Set root directory to `apps/web`.
6. Add environment variables.
7. Set production domain:

   ```text
   app.skillcheck.yourdomain.com
   ```

8. Add dashboard pages.
9. Add auth.
10. Add API token UI.

Official note: Vercel environment variables are configured outside source code and apply to new deployments, not old deployments: https://vercel.com/docs/projects/environment-variables

## Render Deployment Plan

1. Add `apps/api` Node service.
2. Add `Dockerfile` or simple Node build/start commands.
3. Create Render Web Service from GitHub repo.
4. Set root directory to `apps/api`.
5. Set build command:

   ```bash
   npm install && npm run build
   ```

6. Set start command:

   ```bash
   npm run start
   ```

7. Add Render Postgres.
8. Add Redis/Key Value.
9. Add environment variables.
10. Set production domain:

    ```text
    api.skillcheck.yourdomain.com
    ```

Official notes:

- Render environment variables are configured per service: https://render.com/docs/configure-environment-variables/
- Render Postgres can host the production database: https://render.com/docs/postgresql

## MVP Build Order

### Phase 1: Working Proxy

Goal: CLI can run against your backend.

- Create `apps/api`.
- Implement `GET /health`.
- Implement `POST /v1/chat/completions`.
- Add provider forwarding.
- Add request timeout and retry.
- Deploy API to Render.
- Run:

  ```bash
  skillcheck setup
  skillcheck check path/to/SKILL.md
  ```

### Phase 2: Token Auth

Goal: users need a Skillcheck token.

- Add Postgres.
- Add `api_keys` table.
- Add token generation endpoint.
- Verify `Authorization: Bearer ...`.
- Add usage logging.
- Add revoke endpoint.

### Phase 3: Dashboard

Goal: users can self-serve.

- Create `apps/web`.
- Add auth.
- Add onboarding page.
- Add create token page.
- Add usage page.
- Deploy to Vercel.

### Phase 4: Abuse and Billing

Goal: safe public launch.

- Add Redis rate limits.
- Add org monthly quotas.
- Add admin dashboard.
- Add Stripe subscriptions.
- Add email alerts for quota exceeded and suspicious usage.

### Phase 5: Run History

Goal: dashboard becomes useful beyond API keys.

- Add optional CLI metadata upload.
- Store `skill_runs`.
- Show verdict trend by skill.
- Show helps/placebo/harms counts.
- Add shareable run page.

## Suggested Backend File Structure

```text
apps/api/src/
  index.ts
  env.ts
  db.ts
  auth/
    tokens.ts
    middleware.ts
  routes/
    health.ts
    chat-completions.ts
    tokens.ts
    usage.ts
    runs.ts
    admin.ts
  services/
    provider.ts
    rate-limit.ts
    usage.ts
    audit.ts
  lib/
    hash.ts
    errors.ts
    logger.ts
```

## Suggested Frontend File Structure

```text
apps/web/app/
  page.tsx
  login/page.tsx
  onboarding/page.tsx
  dashboard/page.tsx
  tokens/page.tsx
  usage/page.tsx
  runs/page.tsx
  settings/page.tsx
  admin/page.tsx

apps/web/components/
  AppShell.tsx
  UsageChart.tsx
  TokenTable.tsx
  CreateTokenDialog.tsx
  CopyCommand.tsx
  RunCard.tsx
```

## MVP API Pseudocode

```ts
app.post('/v1/chat/completions', async (req, reply) => {
  const token = getBearerToken(req.headers.authorization);
  const auth = await authenticateTokenOrAnonymous(token, req.ip);

  await rateLimit(auth);

  const startedAt = Date.now();
  const upstream = await fetch(`${env.PROVIDER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.PROVIDER_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      ...req.body,
      model: env.DEFAULT_MODEL,
      stream: false
    })
  });

  const text = await upstream.text();
  await recordUsage({
    auth,
    statusCode: upstream.status,
    responseText: text,
    latencyMs: Date.now() - startedAt
  });

  reply
    .status(upstream.status)
    .header('content-type', upstream.headers.get('content-type') ?? 'application/json')
    .send(text);
});
```

## What To Build First

Build this order:

1. Render API with `/health`.
2. Render API `/v1/chat/completions` proxy.
3. Point local CLI to Render API with `skillcheck setup`.
4. Add Postgres token table.
5. Add dashboard token creation.
6. Add usage logging.
7. Add rate limits.
8. Add billing/admin later.

Do not start with billing or a polished dashboard. First prove:

```text
user installs CLI -> runs setup -> checks skill -> backend records usage
```

That is the real MVP.
