import { AuthError, ConfigError, ProviderHttpError, ProviderRateLimitError, ProviderResponseError, ProviderTimeoutError } from '../errors.js';
import { registerSecret, sanitizeTerminal } from '../core/security/output.js';
import { decodeProviderJson, providerFetch, readProviderBody, sleep } from './transport.js';

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

interface RequestPolicy {
  timeoutMs?: number;
  maxAttempts?: number;
  requestDelayMs?: number;
  maxRetryDelayMs?: number;
}

export interface HttpResult {
  status: number;
  ok: boolean;
  text: string;
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || (status >= 500 && status < 600);
}

function retryAfter(headers: Headers | undefined): number | undefined {
  const value = headers?.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : undefined;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/** Pace starts while allowing multiple requests to be in flight. */
export class ProviderRequests {
  private nextStart = 0;
  private denied = false;

  constructor(private readonly policy: RequestPolicy = {}) {}

  async post(url: string, headers: Record<string, string>, body: string): Promise<HttpResult> {
    const maxAttempts = this.policy.maxAttempts ?? 5;
    if (maxAttempts < 1) throw new ConfigError('Request retry budget exhausted 0 attempts.');
    for (let attempt = 0; ; attempt += 1) {
      const start = Math.max(Date.now(), this.nextStart);
      this.nextStart = start + (this.policy.requestDelayMs ?? 0);
      const wait = start - Date.now();
      if (wait > 0 && !this.denied) await sleep(wait);
      if (this.denied) throw new AuthError();

      const signal = AbortSignal.timeout(this.policy.timeoutMs ?? 120_000);
      let pause: number | undefined;
      try {
        const response = await providerFetch(url, { method: 'POST', headers, body, signal });
        if (response.status === 401 || response.status === 403) {
          this.denied = true;
          await response.body?.cancel().catch(() => {});
          throw new AuthError('Provider rejected the configured credentials (HTTP ' + response.status + ').');
        }
        if (retryableStatus(response.status) && attempt + 1 < maxAttempts) {
          const advertised = retryAfter(response.headers);
          if (advertised === undefined || advertised <= 5 * 60_000) {
            const ceiling = Math.min(this.policy.maxRetryDelayMs ?? 60_000, (response.status === 429 ? 5_000 : 500) * 2 ** attempt);
            pause = advertised ?? Math.floor(Math.random() * (ceiling + 1));
          }
        }
        if (pause !== undefined) {
          await response.body?.cancel().catch(() => {});
        } else if (response.status === 429) {
          await response.body?.cancel().catch(() => {});
          throw new ProviderRateLimitError();
        } else {
          return { status: response.status, ok: response.ok, text: await readProviderBody(response) };
        }
      } catch (cause) {
        if (signal.aborted) throw new ProviderTimeoutError({ cause });
        if (!(cause instanceof TypeError)) throw cause;
        if (attempt + 1 >= maxAttempts) throw new ProviderHttpError('Could not reach the model provider.', undefined, true, { cause });
        const ceiling = Math.min(this.policy.maxRetryDelayMs ?? 60_000, 500 * 2 ** attempt);
        pause = Math.floor(Math.random() * (ceiling + 1));
      }
      if (pause && pause > 0) await sleep(pause);
    }
  }
}

export function fetchWithRetry(
  url: string, options: RequestPolicy & { headers: Record<string, string>; body: string }
): Promise<HttpResult> {
  return new ProviderRequests(options).post(url, options.headers, options.body);
}

export function responseObject(result: HttpResult, provider: string, apiKey: string): Record<string, unknown> {
  registerSecret(apiKey);
  if (!result.ok) {
    const detail = sanitizeTerminal(result.text).slice(0, 240);
    throw new ProviderHttpError(provider + ' API error (' + result.status + ')' + (detail ? ': ' + detail : ''), result.status, retryableStatus(result.status));
  }
  return record(decodeProviderJson(result.text, provider), provider + ' response');
}

export function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderResponseError(label + ' must be an object.');
  }
  return value as Record<string, unknown>;
}

export function optionalTokens(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ProviderResponseError('Provider token counters must be non-negative integers.');
  }
  return value;
}
