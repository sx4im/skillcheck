// fetch with a hard timeout. Every outbound call the API makes (Upstash,
// NVIDIA, Clerk, Stripe) must bound its own latency — Vercel kills the
// function at maxDuration and an unbounded fetch turns into an opaque 500.

/**
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {number} [timeoutMs]
 * @returns {Promise<Response>}
 */
export function fetchWithTimeout(url, init = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}
