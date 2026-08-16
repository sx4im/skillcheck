// Key/value store. Uses Upstash Redis over its REST API in production, and an
// in-process Map for local dev / tests when Upstash is not configured.
//
// NOTE: the in-memory fallback only persists within a single warm process, so it
// is fine for `vercel dev` and unit tests but NOT for real multi-instance prod.
// Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN for production.

import { UPSTASH_URL, UPSTASH_TOKEN } from './config.js';
import { fetchWithTimeout } from './fetch-timeout.js';

export const usingRedis = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

// On Vercel each function invocation can run in a different (and short-lived)
// instance, so the in-memory fallback below does NOT persist: an API key minted
// by /api/me in one instance won't be found by the proxy in another, and the key
// looks "invalid". This is the #1 cause of issued keys not working in prod. Warn
// loudly once so the misconfiguration is visible in the logs.
export const storeDurable = usingRedis;
if (!usingRedis && (process.env.VERCEL || process.env.NODE_ENV === 'production')) {
  console.warn(
    '[skillcheck] WARNING: UPSTASH_REDIS_REST_URL/TOKEN are not set. ' +
      'Running on an ephemeral in-memory store — issued API keys will NOT persist ' +
      'across serverless invocations and will appear invalid. Configure Upstash Redis.'
  );
}

const g = /** @type {any} */ (globalThis);
const mem = g.__skillcheckMem || (g.__skillcheckMem = { kv: new Map(), exp: new Map() });

/**
 * @param {unknown[]} command
 * @returns {Promise<any>}
 */
async function upstash(command) {
  const response = await fetchWithTimeout(UPSTASH_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${UPSTASH_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(command)
  });
  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error(`store error: bad response (${response.status})`);
  }
  if (data && data.error) throw new Error(`store error: ${data.error}`);
  return data ? data.result : null;
}

/** @param {string} key @returns {boolean} */
function memLive(key) {
  const expiry = mem.exp.get(key);
  if (expiry !== undefined && expiry < Date.now()) {
    mem.kv.delete(key);
    mem.exp.delete(key);
    return false;
  }
  return mem.kv.has(key);
}

/**
 * @param {string} key
 * @returns {Promise<string | null>}
 */
export async function kvGet(key) {
  if (usingRedis) return upstash(['GET', key]);
  return memLive(key) ? mem.kv.get(key) : null;
}

/**
 * @param {string} key
 * @param {string} value
 * @param {{ ex?: number, nx?: boolean }} [options]
 * @returns {Promise<string | null>}
 */
// Returns 'OK' on write, null when nx skipped.
export async function kvSet(key, value, options = {}) {
  if (usingRedis) {
    const command = ['SET', key, value];
    if (options.ex) command.push('EX', String(options.ex));
    if (options.nx) command.push('NX');
    return upstash(command);
  }
  if (options.nx && memLive(key)) return null;
  mem.kv.set(key, value);
  if (options.ex) mem.exp.set(key, Date.now() + options.ex * 1000);
  else mem.exp.delete(key);
  return 'OK';
}

/**
 * @param {string} key
 * @returns {Promise<number>}
 */
export async function kvDel(key) {
  if (usingRedis) return upstash(['DEL', key]);
  mem.kv.delete(key);
  mem.exp.delete(key);
  return 1;
}

/**
 * @param {string} key
 * @returns {Promise<number>}
 */
export async function kvIncr(key) {
  if (usingRedis) return upstash(['INCR', key]);
  const next = Number(memLive(key) ? mem.kv.get(key) : 0) + 1;
  mem.kv.set(key, String(next));
  return next;
}

/**
 * @param {string} key
 * @returns {Promise<number>}
 */
export async function kvDecr(key) {
  if (usingRedis) return upstash(['DECR', key]);
  const next = Number(memLive(key) ? mem.kv.get(key) : 0) - 1;
  mem.kv.set(key, String(next));
  return next;
}
