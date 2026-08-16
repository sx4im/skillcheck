// Shared HTTP plumbing for the raw-fetch adapters (Anthropic, Gemini), so the
// two do not carry copy-pasted retry loops: POST with a request timeout and
// retry-on-429/5xx, plus text extraction for chat message content.

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Message content as plain text: strings pass through, structured parts are
// joined on their text fields. Never JSON.stringify content — that would send
// serialized JSON to the model as if it were the answer text.
export function textContent(content: unknown): string | undefined {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if (typeof part === 'object' && part !== null && 'text' in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        }
        return '';
      })
      .join('');
    return parts || undefined;
  }

  return undefined;
}

export interface HttpResult {
  status: number;
  ok: boolean;
  text: string;
}

// POSTs with retries on 429/5xx. Network/timeout errors surface immediately;
// a non-retryable HTTP status is returned to the caller to turn into a
// provider-specific error.
export async function fetchWithRetry(
  url: string,
  options: { headers: Record<string, string>; body: string; timeoutMs: number; maxAttempts: number }
): Promise<HttpResult> {
  for (let attempt = 0; attempt < options.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: options.headers,
        body: options.body,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    const retryable = response.status === 429 || response.status === 500 || response.status === 502 || response.status === 503 || response.status === 504;
    if (response.ok || !retryable || attempt === options.maxAttempts - 1) {
      return { status: response.status, ok: response.ok, text };
    }
    await sleep(1000 * 2 ** attempt);
  }
  throw new Error(`fetchWithRetry exhausted ${options.maxAttempts} attempts for ${url}`);
}
