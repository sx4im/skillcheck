// User records + run metering. The uid is the Clerk user id.
//
// Store layout:
//   user:<uid>                JSON { uid, email, name, plan, apiKeyHash, apiKeyMasked, createdAt }
//   key:<sha256(key)>         -> uid                  (proxy authenticates by this)
//   runsused:<uid>:<YYYY-MM>  integer                 (atomic INCR per consumed run; resets monthly)
//   run:<uid>:<runId>         call counter, 24h TTL   (dedupes the many calls in one run; caps replay)

import { timingSafeEqual } from 'node:crypto';
import { kvGet, kvSet, kvDel, kvCompareAndSet, claimRun, refundRun } from './store.js';
import { generateApiKey, hashApiKey, maskApiKey } from './keys.js';
import { fetchClerkProfile } from './clerk.js';
import { FREE_RUNS, PRO_RUN_LIMIT } from './config.js';

/**
 * @typedef {Object} User
 * @property {string} uid
 * @property {string} email
 * @property {string} name
 * @property {'free' | 'pro'} plan
 * @property {string} apiKeyHash
 * @property {string} apiKeyMasked
 * @property {string} createdAt
 */

/** @typedef {User & { apiKey?: string }} Account */

/**
 * @typedef {Object} MeterResult
 * @property {boolean} allowed
 * @property {boolean} counted
 * @property {number} used
 * @property {number} limit
 * @property {string} month
 * @property {string} [reason]
 */

/**
 * @param {string} uid
 * @returns {Promise<{ raw: string, user: User, legacy: boolean } | null>}
 */
async function readUser(uid) {
  const raw = await kvGet(`user:${uid}`);
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || parsed.uid !== uid || (parsed.plan !== 'free' && parsed.plan !== 'pro')) {
    return null;
  }
  const { apiKey, ...user } = parsed;
  const legacy = typeof apiKey === 'string' && apiKey.length > 0;
  if (legacy) {
    user.apiKeyHash = hashApiKey(apiKey);
    user.apiKeyMasked = maskApiKey(apiKey);
  }
  return { raw, user, legacy };
}

/** @param {string} uid @returns {Promise<User | null>} */
export async function getUser(uid) {
  for (let snapshot = await readUser(uid); snapshot; snapshot = await readUser(uid)) {
    const { raw, user, legacy } = snapshot;
    if (!legacy || await kvCompareAndSet(`user:${uid}`, raw, JSON.stringify(user))) return user;
  }
  return null;
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
 * @param {string} digest
 * @returns {Promise<User | null>}
 */
export async function userForApiKey(digest) {
  if (!/^[a-f0-9]{64}$/.test(digest)) return null;
  const uid = await kvGet(`key:${digest}`);
  const user = uid ? await getUser(uid) : null;
  if (!user || !/^[a-f0-9]{64}$/.test(user.apiKeyHash)) return null;
  // The account digest is authoritative even if an obsolete index entry survives a rotation.
  return timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(user.apiKeyHash, 'hex')) ? user : null;
}

/**
 * Creates the account on first sight and issues its API key. Concurrent first
 * calls race: the user record is written with NX so exactly one writer wins,
 * and the loser re-reads instead of orphaning a second key mapping.
 * @param {{ userId: string, email?: string, name?: string }} profile
 * @returns {Promise<Account>}
 */
export async function getOrCreateUser({ userId, email, name }) {
  const existing = await getUser(userId);
  if (existing) return existing;
  const apiKey = generateApiKey();
  const apiKeyHash = hashApiKey(apiKey);
  /** @type {User} */
  const user = {
    uid: userId,
    email: email || '',
    name: name || '',
    plan: 'free',
    apiKeyHash,
    apiKeyMasked: maskApiKey(apiKey),
    createdAt: new Date().toISOString()
  };
  await kvSet(`key:${apiKeyHash}`, userId);
  const created = await kvSet(`user:${userId}`, JSON.stringify(user), { nx: true });
  if (created === 'OK') return { ...user, apiKey };
  await kvDel(`key:${apiKeyHash}`).catch(() => {});
  const winner = await getUser(userId);
  if (!winner) throw new Error('Could not read the newly created account.');
  return winner;
}

/**
 * Fetches the Clerk profile and ensures the account exists — shared by /api/me
 * and /api/key/rotate.
 * @param {string} userId
 * @returns {Promise<Account>}
 */
export async function ensureUser(userId) {
  const existing = await getUser(userId);
  if (existing) return existing;
  const profile = await fetchClerkProfile(userId);
  return getOrCreateUser({ userId, email: profile.email, name: profile.name });
}

/**
 * @param {string} uid
 * @returns {Promise<Account | null>}
 */
export async function rotateApiKey(uid) {
  const snapshot = await readUser(uid);
  if (!snapshot) return null;
  const { raw, user } = snapshot;
  const apiKey = generateApiKey();
  const apiKeyHash = hashApiKey(apiKey);
  const updated = { ...user, apiKeyHash, apiKeyMasked: maskApiKey(apiKey) };
  await kvSet(`key:${apiKeyHash}`, uid);
  if (!await kvCompareAndSet(`user:${uid}`, raw, JSON.stringify(updated))) {
    await kvDel(`key:${apiKeyHash}`).catch(() => {});
    return null;
  }
  if (user.apiKeyHash) await kvDel(`key:${user.apiKeyHash}`).catch(() => {});
  return { ...updated, apiKey };
}

/**
 * @param {string} uid
 * @param {'free' | 'pro'} plan
 * @returns {Promise<User | null>}
 */
export async function setPlan(uid, plan) {
  for (let snapshot = await readUser(uid); snapshot; snapshot = await readUser(uid)) {
    const updated = { ...snapshot.user, plan };
    if (await kvCompareAndSet(`user:${uid}`, snapshot.raw, JSON.stringify(updated))) return updated;
  }
  return null;
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

// A run groups up to 200 accepted calls under the CLI's x-skillcheck-run ID.
// Without a run ID, every call needs a separate quota slot.
const MAX_CALLS_PER_RUN = 200;

/**
 * @param {string} uid
 * @param {string} runId
 * @param {string} plan
 * @returns {Promise<MeterResult>}
 */
export async function consumeRun(uid, runId, plan) {
  const limit = runLimitFor(plan);
  const month = currentMonthTag();
  const runKey = runId ? `run:${uid}:${runId}` : '';
  const [state, used] = await claimRun(`runsused:${uid}:${month}`, runKey, limit, MAX_CALLS_PER_RUN);
  const allowed = state === 'counted' || state === 'existing';
  return { allowed, counted: state === 'counted', used, limit, month, reason: allowed ? undefined : state };
}

/**
 * Refund only a failed call that reserved a run without any other calls sharing it.
 * @param {string} uid
 * @param {string} runId
 * @param {string} month
 */
export async function rollbackRun(uid, runId, month) {
  await refundRun(`runsused:${uid}:${month}`, runId ? `run:${uid}:${runId}` : '');
}
