# Skillcheck Cloud setup

Use this when you want users to install the CLI and run checks without configuring model-provider secrets locally.

## Architecture

```text
skillcheck CLI
  -> Skillcheck Cloud API
  -> model provider

Dashboard
  -> user signs up
  -> user creates a Skillcheck token
  -> token is stored hashed in your database
```

The CLI only needs:

```bash
skillcheck setup
```

The setup wizard asks for:

```bash
https://api.yourdomain.com/v1
```

For token-gated private beta, users can additionally set:

```bash
export SKILLCHECK_TOKEN=sk_live_...
```

If you want public free trials, the proxy can allow anonymous requests with strict rate limits and no token.

## API contract

The CLI expects an OpenAI-compatible endpoint:

```http
POST /v1/chat/completions
Authorization: Bearer <skillcheck-token>
Content-Type: application/json
```

Response should match OpenAI chat completions enough for the `openai` Node SDK:

```json
{
  "id": "chatcmpl_...",
  "object": "chat.completion",
  "created": 1780000000,
  "model": "your-model",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 1,
    "completion_tokens": 1,
    "total_tokens": 2
  }
}
```

## Minimal proxy

The repo includes a tiny Node proxy in `examples/nvidia-proxy/`. It is useful for testing the `SKILLCHECK_API_URL` flow before building the dashboard.

Run it on a server:

```bash
export NVIDIA_API_KEY=...
export SKILLCHECK_PROXY_TOKEN=dev-token
node examples/nvidia-proxy/server.mjs
```

Point the CLI at it:

```bash
export SKILLCHECK_API_URL=https://your-proxy.example.com/v1
export SKILLCHECK_TOKEN=dev-token
skillcheck check path/to/SKILL.md
```

## Dashboard requirements

- `users`: id, email, password/session provider, created_at.
- `tokens`: id, user_id, token_hash, prefix, created_at, last_used_at, revoked_at.
- `usage_events`: user_id, token_id, request_id, model, prompt_tokens, completion_tokens, created_at.
- Rate limit by token and IP.
- Store model-provider secrets only on the server.
- Never expose upstream provider secrets to the browser or CLI.

## First production path

1. Deploy the proxy API at `https://api.yourdomain.com/v1`.
2. Add dashboard auth with GitHub or email login.
3. Add “Create token” in the dashboard and show the token once.
4. Hash tokens before storing them.
5. Verify `Authorization: Bearer <token>` in the proxy.
6. Add rate limits and usage logging.
7. Ship the CLI with docs telling users to set `SKILLCHECK_API_URL` and `SKILLCHECK_TOKEN`.
