// Central environment configuration for the Skillcheck dashboard + proxy.
// Every secret is read here so the rest of the code never touches process.env directly.

/**
 * @param {string | undefined} value
 * @returns {string}
 */
function clean(value) {
  return (value || '').trim();
}

// --- Upstream model provider (the ONE secret that must never reach the browser/CLI) ---
export const NVIDIA_API_KEY = clean(process.env.NVIDIA_API_KEY);
export const NVIDIA_BASE_URL = (clean(process.env.NVIDIA_BASE_URL) || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '');
// Default mirrors the CLI's choice (see packages/cli/src/env.ts): gpt-oss-120b is
// the strongest model in NIM's fast lane with dependable JSON mode. Override with
// the SKILLCHECK_MODEL env var on the deployment.
export const DEFAULT_MODEL =
  clean(process.env.SKILLCHECK_MODEL) || clean(process.env.DEFAULT_MODEL) || 'openai/gpt-oss-120b';

// --- Auth: Clerk (hosted sign-in with Google, GitHub, etc.) ---
// Publishable key is safe to expose to the browser; secret key stays server-side.
export const CLERK_PUBLISHABLE_KEY = clean(process.env.CLERK_PUBLISHABLE_KEY) || clean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
export const CLERK_SECRET_KEY = clean(process.env.CLERK_SECRET_KEY);
export const clerkEnabled = Boolean(CLERK_PUBLISHABLE_KEY && CLERK_SECRET_KEY);

// Pepper used when hashing issued API keys before storing them. No default
// value: an unset pepper in production hashes keys with '' — loud warning
// below rather than silently weakening every issued key.
export const TOKEN_PEPPER = clean(process.env.TOKEN_PEPPER) || CLERK_SECRET_KEY;
if (!TOKEN_PEPPER && (process.env.VERCEL || process.env.NODE_ENV === 'production')) {
  console.warn(
    '[skillcheck] WARNING: TOKEN_PEPPER (or CLERK_SECRET_KEY) is not set. ' +
      'Issued API keys will be hashed with an empty pepper.'
  );
}

// --- Quota ---
export const FREE_RUNS = Number(process.env.FREE_RUNS || 10);
// 0 = unlimited for paid users.
export const PRO_RUN_LIMIT = Number(process.env.PRO_RUN_LIMIT || 0);

// --- Billing (optional; upgrade is hidden when STRIPE_SECRET_KEY is unset) ---
export const STRIPE_SECRET_KEY = clean(process.env.STRIPE_SECRET_KEY);
export const STRIPE_PRICE_ID = clean(process.env.STRIPE_PRICE_ID);
export const STRIPE_MODE = clean(process.env.STRIPE_MODE) || 'payment'; // 'payment' (one-time) or 'subscription'

// --- Storage ---
export const UPSTASH_URL = clean(process.env.UPSTASH_REDIS_REST_URL);
export const UPSTASH_TOKEN = clean(process.env.UPSTASH_REDIS_REST_TOKEN);

// Optional explicit public app URL (otherwise derived from request headers).
export const APP_URL = clean(process.env.APP_URL).replace(/\/+$/, '');

export const billingEnabled = Boolean(STRIPE_SECRET_KEY && STRIPE_PRICE_ID);

/**
 * @param {import('http').IncomingMessage} req
 * @returns {string}
 */
export function appUrl(req) {
  if (APP_URL) return APP_URL;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
}
