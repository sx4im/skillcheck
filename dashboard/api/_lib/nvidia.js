// Forwards an OpenAI-compatible chat-completion to the upstream provider using
// the server-side NVIDIA key. The hosted tier pins the model for cost control.

import { NVIDIA_API_KEY, NVIDIA_BASE_URL, DEFAULT_MODEL } from './config.js';

// Hard caps so a single metered run cannot be turned into an arbitrarily
// expensive request. The CLI generator legitimately asks for up to 8000 output
// tokens, so the ceiling sits comfortably above that.
const MAX_OUTPUT_TOKENS = 16000;
const DEFAULT_OUTPUT_TOKENS = 1024;

function clampMaxTokens(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_OUTPUT_TOKENS;
  return Math.min(Math.floor(n), MAX_OUTPUT_TOKENS);
}

function clampTemperature(value) {
  if (value === undefined || value === null) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(2, Math.max(0, n));
}

export async function forwardChatCompletion(body) {
  // Start from the caller's body so CLI-only fields (response_format,
  // chat_template_kwargs, extra_body) still pass through, then neutralise the
  // fields a caller could abuse to amplify cost: the model is pinned, streaming
  // is off, only one completion is generated, and output length is capped.
  const safe = body && typeof body === 'object' ? { ...body } : {};
  const temperature = clampTemperature(safe.temperature);
  const payload = {
    ...safe,
    model: DEFAULT_MODEL,
    stream: false,
    n: 1,
    max_tokens: clampMaxTokens(safe.max_tokens)
  };
  if (temperature === undefined) delete payload.temperature;
  else payload.temperature = temperature;
  const upstream = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${NVIDIA_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const text = await upstream.text();
  return {
    status: upstream.status,
    contentType: upstream.headers.get('content-type') || 'application/json',
    text
  };
}
