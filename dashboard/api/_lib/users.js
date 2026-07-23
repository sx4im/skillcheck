// User records + run metering. The uid is the Clerk user id.
//
// Store layout:
//   user:<uid>          JSON { uid, email, name, plan, apiKey, createdAt }
//   key:<sha256(key)>   -> uid                  (proxy authenticates by this)
//   runsused:<uid>      integer                 (atomic INCR per consumed run)
//   run:<uid>:<runId>   short-lived marker      (dedupes the many calls in one run)

import { kvGet, kvSet, kvDel, kvIncr } from './store.js';
import { generateApiKey, hashApiKey } from './keys.js';
import { FREE_RUNS, PRO_RUN_LIMIT } from './config.js';

export async function getUser(uid) {
  const raw = await kvGet(`user:${uid}`);
  return raw ? JSON.parse(raw) : null;
}

async function saveUser(user) {
  await kvSet(`user:${user.uid}`, JSON.stringify(user));
  return user;
}

function currentMonthTag() {
  return new Date().toISOString().slice(0, 7);
}

export async function getRunsUsed(uid) {
  const month = currentMonthTag();
  return Number((await kvGet(`runsused:${uid}:${month}`)) || 0);
}

export async function uidForApiKey(key) {
  if (!key) return null;
  return kvGet(`key:${hashApiKey(key)}`);
}

export async function getOrCreateUser({ userId, email, name }) {
  const existing = await getUser(userId);
  if (existing) return existing;
  const apiKey = generateApiKey();
  const user = {
    uid: userId,
    email: email || '',
    name: name || '',
    plan: 'free',
    apiKey,
    createdAt: new Date().toISOString()
  };
  await saveUser(user);
  await kvSet(`key:${hashApiKey(apiKey)}`, userId);
  return user;
}

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

export async function setPlan(uid, plan) {
  const user = await getUser(uid);
  if (!user) return null;
  user.plan = plan;
  return saveUser(user);
}

export function runLimitFor(plan) {
  if (plan === 'pro') return PRO_RUN_LIMIT > 0 ? PRO_RUN_LIMIT : Infinity;
  return FREE_RUNS;
}

// Meter one inbound request against the user's run quota.
// A "run" is one `skillcheck check`, which fires many model calls sharing one
// x-skillcheck-run id; only the first call of a new id consumes a slot, so the
// dozens of calls in a single run are charged once.
//
// SECURITY: the quota is ALWAYS enforced. A request that omits the run id is not
// a free pass — it simply cannot be deduped, so it is charged as its own run.
// (Previously a missing id was treated as "unmetered/allow", which let anyone
// with a free key make unlimited model calls by dropping the header.)
// Returns { allowed, counted, used, limit, reason? }.
// Quotas automatically reset to 0 at the start of every calendar month.
export async function consumeRun(uid, runId, plan) {
  const limit = runLimitFor(plan);
  const used = await getRunsUsed(uid);

  if (runId) {
    const isNewRun = (await kvSet(`run:${uid}:${runId}`, '1', { nx: true, ex: 86400 })) === 'OK';
    if (!isNewRun) {
      // A later call of an already-counted run: let it through without re-charging.
      return { allowed: true, counted: false, used, limit };
    }
  }

  if (used >= limit) {
    if (runId) await kvDel(`run:${uid}:${runId}`); // reject without consuming the slot
    return { allowed: false, counted: false, used, limit, reason: 'quota_exceeded' };
  }

  const month = currentMonthTag();
  const nowUsed = await kvIncr(`runsused:${uid}:${month}`);
  return { allowed: true, counted: true, used: nowUsed, limit };
}
