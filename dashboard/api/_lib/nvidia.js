// Forwards an OpenAI-compatible chat-completion to the upstream provider using
// the server-side NVIDIA key. The hosted tier pins the model for cost control.

import { NVIDIA_API_KEY, NVIDIA_BASE_URL, DEFAULT_MODEL } from './config.js';
import { fetchWithTimeout } from './fetch-timeout.js';

// Hard caps so a single metered run cannot be turned into an arbitrarily
// expensive request. The CLI generator legitimately asks for up to 8000 output
// tokens, so the ceiling sits comfortably above that.
const MAX_OUTPUT_TOKENS = 16000;
const DEFAULT_OUTPUT_TOKENS = 1024;
// Small floor so a tiny budget never truncates a direct answer.
const MIN_OUTPUT_TOKENS = 512;

// Python-SDK-only conveniences that NVIDIA NIM rejects ("Unsupported parameter(s)").
const INVALID_UPSTREAM_FIELDS = ['extra_body', 'extra_headers', 'extra_query'];

/**
 * @param {unknown} value
 * @returns {number}
 */
function clampMaxTokens(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_OUTPUT_TOKENS;
  return Math.min(Math.max(Math.floor(n), MIN_OUTPUT_TOKENS), MAX_OUTPUT_TOKENS);
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function clampTemperature(value) {
  if (value === undefined || value === null) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(2, Math.max(0, n));
}

/**
 * @param {Record<string, unknown>} body
 * @returns {Promise<{ status: number, contentType: string, text: string }>}
 */
export async function forwardChatCompletion(body) {
  // Start from the caller's body so CLI fields (response_format,
  // chat_template_kwargs) still pass through, then neutralise the fields a caller
  // could abuse to amplify cost: the model is pinned, streaming is off, only one
  // completion is generated, and output length is bounded.
  const safe = body && typeof body === 'object' ? { ...body } : {};
  const temperature = clampTemperature(safe.temperature);
  const payload = /** @type {Record<string, unknown>} */ ({
    ...safe,
    model: DEFAULT_MODEL,
    stream: false,
    n: 1,
    max_tokens: clampMaxTokens(safe.max_tokens),
    // The hosted tier pins reasoning OFF for speed + cost (the model thinks by
    // default). Forced after the merge so a caller cannot re-enable it.
    chat_template_kwargs: { ...(safe.chat_template_kwargs || {}), enable_thinking: false }
  });
  // Drop fields NVIDIA NIM rejects, so older CLIs that still send extra_body work.
  for (const field of INVALID_UPSTREAM_FIELDS) delete payload[field];
  if (temperature === undefined) delete payload.temperature;
  else payload.temperature = temperature;
  // Stay under the 60s serverless maxDuration so we can return a 502 instead
  // of letting the platform cut the connection.
  const upstream = await fetchWithTimeout(
    `${NVIDIA_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${NVIDIA_API_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    },
    55000
  );
  const text = await upstream.text();
  return {
    status: upstream.status,
    contentType: upstream.headers.get('content-type') || 'application/json',
    text
  };
}
