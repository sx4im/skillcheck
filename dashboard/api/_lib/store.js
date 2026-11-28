// Key/value store. Uses Upstash Redis over its REST API in production, and an
// in-process Map for local dev / tests when Upstash is not configured.
//
// NOTE: the in-memory fallback only persists within a single warm process, so it
// is fine for `vercel dev` and unit tests but NOT for real multi-instance prod.
// Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN for production.

import { createHash } from 'node:crypto';
import { UPSTASH_URL, UPSTASH_TOKEN } from './config.js';
import { fetchWithTimeout } from './fetch-timeout.js';

const usingRedis = Boolean(UPSTASH_URL && UPSTASH_TOKEN);
const deployed = Boolean((process.env.VERCEL && process.env.VERCEL_ENV !== 'development') || process.env.NODE_ENV === 'production');

// Serverless instances need shared keys, quota, and rate counters.
export const storeDurable = usingRedis;
if (!usingRedis && deployed) {
  console.warn('[skillcheck] Configure Upstash Redis for shared storage and rate limiting.');
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
    redirect: 'error',
    headers: { authorization: `Bearer ${UPSTASH_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(command)
  });
  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error(`store error: bad response (${response.status})`);
  }
  if (!response.ok || !data || data.error || !Object.hasOwn(data, 'result')) throw new Error('Storage command failed.');
  return data.result;
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
  if (deployed) throw new Error('Durable storage is unavailable.');
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
  if (deployed) throw new Error('Durable storage is unavailable.');
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
  if (deployed) throw new Error('Durable storage is unavailable.');
  mem.kv.delete(key);
  mem.exp.delete(key);
  return 1;
}

/**
 * @param {string} key
 * @param {string} expected
 * @param {string} value
 * @returns {Promise<boolean>}
 */
export async function kvCompareAndSet(key, expected, value) {
  if (usingRedis) {
    // A checksum identifies the previous record without resending a legacy key in plaintext.
    const checksum = createHash('sha1').update(expected).digest('hex');
    const script = "local old = redis.call('GET', KEYS[1]) if not old or redis.sha1hex(old) ~= ARGV[1] then return 0 end redis.call('SET', KEYS[1], ARGV[2]) return 1";
    const result = await upstash(['EVAL', script, 1, key, checksum, value]);
    if (result !== 0 && result !== 1) throw new Error('Invalid storage update result.');
    return result === 1;
  }
  if (deployed) throw new Error('Durable storage is unavailable.');
  if (!memLive(key) || mem.kv.get(key) !== expected) return false;
  mem.kv.set(key, value);
  return true;
}

/**
 * @param {string} key
 * @param {number} seconds
 * @returns {Promise<number>}
 */
export async function kvIncrWithExpiry(key, seconds) {
  if (usingRedis) {
    const script = "local count = redis.call('INCR', KEYS[1]) if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return count";
    const result = await upstash(['EVAL', script, 1, key, seconds]);
    if (!Number.isSafeInteger(result) || result < 1) throw new Error('Invalid rate counter result.');
    return result;
  }
  if (deployed) throw new Error('Durable storage is unavailable.');
  const next = Number(memLive(key) ? mem.kv.get(key) : 0) + 1;
  mem.kv.set(key, String(next));
  if (next === 1) {
    mem.exp.set(key, Date.now() + seconds * 1000);
    const cleanup = setTimeout(() => memLive(key), seconds * 1000 + 1);
    cleanup.unref();
  }
  return next;
}

// Redis executes the quota update and run marker together so parallel calls
// with the same run ID can share the last remaining quota slot.
const CLAIM_RUN = `
  local used = tonumber(redis.call('GET', KEYS[1]) or '0')
  if #KEYS == 2 and redis.call('EXISTS', KEYS[2]) == 1 then
    local calls = redis.call('INCR', KEYS[2])
    if calls > tonumber(ARGV[2]) then return {'run_call_limit', used} end
    return {'existing', used}
  end
  local limit = tonumber(ARGV[1])
  if limit >= 0 and used >= limit then return {'quota_exceeded', used} end
  used = redis.call('INCR', KEYS[1])
  if #KEYS == 2 then redis.call('SET', KEYS[2], '1', 'EX', ARGV[3]) end
  return {'counted', used}
`;
const RUN_TTL_SECONDS = 86400;

/**
 * @param {string} usageKey
 * @param {string} runKey
 * @param {number} limit
 * @param {number} maxCalls
 * @returns {Promise<['existing' | 'counted' | 'quota_exceeded' | 'run_call_limit', number]>}
 */
export async function claimRun(usageKey, runKey, limit, maxCalls) {
  if (usingRedis) {
    const keys = runKey ? [usageKey, runKey] : [usageKey];
    return upstash(['EVAL', CLAIM_RUN, keys.length, ...keys, Number.isFinite(limit) ? limit : -1, maxCalls, RUN_TTL_SECONDS]);
  }
  if (deployed) throw new Error('Durable storage is unavailable.');
  const used = Number(memLive(usageKey) ? mem.kv.get(usageKey) : 0);
  if (runKey && memLive(runKey)) {
    const calls = Number(mem.kv.get(runKey)) + 1;
    mem.kv.set(runKey, String(calls));
    return [calls > maxCalls ? 'run_call_limit' : 'existing', used];
  }
  if (used >= limit) return ['quota_exceeded', used];
  mem.kv.set(usageKey, String(used + 1));
  if (runKey) {
    mem.kv.set(runKey, '1');
    mem.exp.set(runKey, Date.now() + RUN_TTL_SECONDS * 1000);
  }
  return ['counted', used + 1];
}

/** @param {string} usageKey @param {string} runKey */
export async function refundRun(usageKey, runKey) {
  if (usingRedis) {
    const script = `
      if #KEYS == 2 then
        if redis.call('GET', KEYS[2]) ~= '1' then return end
        redis.call('DEL', KEYS[2])
      end
      if tonumber(redis.call('GET', KEYS[1]) or '0') > 0 then redis.call('DECR', KEYS[1]) end
    `;
    const keys = runKey ? [usageKey, runKey] : [usageKey];
    await upstash(['EVAL', script, keys.length, ...keys]);
    return;
  }
  if (deployed) throw new Error('Durable storage is unavailable.');
  if (runKey) {
    if (!memLive(runKey) || mem.kv.get(runKey) !== '1') return;
    mem.kv.delete(runKey);
    mem.exp.delete(runKey);
  }
  const used = Number(memLive(usageKey) ? mem.kv.get(usageKey) : 0);
  if (used > 0) mem.kv.set(usageKey, String(used - 1));
}
