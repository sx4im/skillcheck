// User records + run metering. The uid is the Clerk user id.
//
// Store layout:
//   user:<uid>                JSON { uid, email, name, plan, apiKey, createdAt }
//   key:<sha256(key)>         -> uid                  (proxy authenticates by this)
//   runsused:<uid>:<YYYY-MM>  integer                 (atomic INCR per consumed run; resets monthly)
//   run:<uid>:<runId>         call counter, 24h TTL   (dedupes the many calls in one run; caps replay)

import { kvGet, kvSet, kvDel, kvIncr, kvDecr } from './store.js';
import { generateApiKey, hashApiKey } from './keys.js';
import { fetchClerkProfile } from './clerk.js';
import { FREE_RUNS, PRO_RUN_LIMIT } from './config.js';

/**
 * @typedef {Object} User
 * @property {string} uid
 * @property {string} email
 * @property {string} name
 * @property {'free' | 'pro'} plan
 * @property {string} apiKey
 * @property {string} createdAt
 */

/**
 * @typedef {Object} MeterResult
 * @property {boolean} allowed
 * @property {boolean} counted
 * @property {number} used
 * @property {number} limit
 * @property {string} [reason]
 */

/**
 * @param {string} uid
 * @returns {Promise<User | null>}
 */
export async function getUser(uid) {
  const raw = await kvGet(`user:${uid}`);
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  // Persisted record must at least be a user-shaped object; anything else is
  // corruption, not a user.
  if (typeof parsed !== 'object' || parsed === null || typeof parsed.uid !== 'string') {
    return null;
  }
  return parsed;
}

/**
 * @param {User} user
 * @returns {Promise<User>}
 */
async function saveUser(user) {
  await kvSet(`user:${user.uid}`, JSON.stringify(user));
  return user;
}

function currentMonthTag() {
  return new Date().toISOString().slice(0, 7);
}

/**
 * @param {string} uid
 * @returns {Promise<number>}
 */
export async function getRunsUsed(uid) {
  const month = currentMonthTag();
  return Number((await kvGet(`runsused:${uid}:${month}`)) || 0);
}

/**
 * @param {string} key
 * @returns {Promise<string | null>}
 */
export async function uidForApiKey(key) {
  if (!key) return null;
  return kvGet(`key:${hashApiKey(key)}`);
}

/**
 * Creates the account on first sight and issues its API key. Concurrent first
 * calls race: the user record is written with NX so exactly one writer wins,
 * and the loser re-reads instead of orphaning a second key mapping.
 * @param {{ userId: string, email?: string, name?: string }} profile
 * @returns {Promise<User>}
 */
export async function getOrCreateUser({ userId, email, name }) {
  const existing = await getUser(userId);
  if (existing) return existing;
  const apiKey = generateApiKey();
  /** @type {User} */
  const user = {
    uid: userId,
    email: email || '',
    name: name || '',
    plan: 'free',
    apiKey,
    createdAt: new Date().toISOString()
  };
  const created = (await kvSet(`user:${user.uid}`, JSON.stringify(user), { nx: true })) === 'OK';
  if (!created) {
    const winner = await getUser(userId);
    if (winner) return winner;
  }
  await kvSet(`key:${hashApiKey(user.apiKey)}`, userId);
  return user;
}

/**
 * Fetches the Clerk profile and ensures the account exists — shared by /api/me
 * and /api/key/rotate.
 * @param {string} userId
 * @returns {Promise<User>}
 */
export async function ensureUser(userId) {
  const existing = await getUser(userId);
  if (existing) return existing;
  const profile = await fetchClerkProfile(userId);
  return getOrCreateUser({ userId, email: profile.email, name: profile.name });
}

/**
 * @param {string} uid
 * @returns {Promise<User | null>}
 */
export async function rotateApiKey(uid) {
  const user = await getUser(uid);
  if (!user) return null;
  if (user.apiKey) await kvDel(`key:${hashApiKey(user.apiKey)}`);
  const apiKey = generateApiKey();
  user.apiKey = apiKey;
  await saveUser(user);
  await kvSet(`key:${hashApiKey(apiKey)}`, uid);
  return user;
}

/**
 * @param {string} uid
 * @param {'free' | 'pro'} plan
 * @returns {Promise<User | null>}
 */
export async function setPlan(uid, plan) {
  const user = await getUser(uid);
  if (!user) return null;
  user.plan = plan;
  return saveUser(user);
}

/**
 * @param {string} plan
 * @returns {number}
 */
export function runLimitFor(plan) {
  if (plan === 'pro') return PRO_RUN_LIMIT > 0 ? PRO_RUN_LIMIT : Infinity;
  return FREE_RUNS;
}

/**
 * Usage view shared by /api/me and /api/key/verify.
 * @param {string} uid
 * @param {string} plan
 * @returns {Promise<{ runsUsed: number, runsLimit: number | null }>}
 */
export async function usageFor(uid, plan) {
  const limit = runLimitFor(plan);
  return { runsUsed: await getRunsUsed(uid), runsLimit: Number.isFinite(limit) ? limit : null };
}

// Meter one inbound request against the user's run quota.
// A "run" is one `skillcheck check`, which fires many model calls sharing one
// x-skillcheck-run id; only the first call of a new id consumes a slot, so the
// dozens of calls in a single run are charged once. The marker doubles as a
// call counter with a cap: without it, a hostile client could replay one run
// id for effectively unlimited metered-free calls until the marker expires.
//
// SECURITY: Quota enforcement is strictly mandatory for every request. An omitted
// run ID cannot be deduplicated and is metered individually as a distinct run.
// The count itself is atomic: INCR first, and a count over the limit is rolled
// back with DECR — two concurrent new runs at the boundary cannot both slip in.
// Quotas automatically reset to 0 at the start of every calendar month.
//
const MAX_CALLS_PER_RUN = 200;

/**
 * @param {string} uid
 * @param {string} runId
 * @param {string} plan
 * @returns {Promise<MeterResult>}
 */
export async function consumeRun(uid, runId, plan) {
  const limit = runLimitFor(plan);

  if (runId) {
    const isNewRun = (await kvSet(`run:${uid}:${runId}`, '1', { nx: true, ex: 86400 })) === 'OK';
    const calls = isNewRun ? 1 : await kvIncr(`run:${uid}:${runId}`);
    if (calls > MAX_CALLS_PER_RUN) {
      return { allowed: false, counted: false, used: await getRunsUsed(uid), limit, reason: 'run_call_limit' };
    }
    if (!isNewRun) {
      // A later call of an already-counted run: let it through without re-charging.
      return { allowed: true, counted: false, used: await getRunsUsed(uid), limit };
    }
  }

  const month = currentMonthTag();
  const nowUsed = await kvIncr(`runsused:${uid}:${month}`);
  if (nowUsed > limit) {
    await kvDecr(`runsused:${uid}:${month}`); // roll back — a rejected request consumes nothing
    if (runId) await kvDel(`run:${uid}:${runId}`);
    return { allowed: false, counted: false, used: nowUsed - 1, limit, reason: 'quota_exceeded' };
  }
  return { allowed: true, counted: true, used: nowUsed, limit };
}
