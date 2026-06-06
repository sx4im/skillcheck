// User records + run metering.
//
// Store layout:
//   user:<uid>          JSON { uid, ghId, email, name, plan, apiKey, createdAt }
//   ghid:<ghId>         -> uid                  (find a returning GitHub user)
//   key:<sha256(key)>   -> uid                  (proxy authenticates by this)
//   runsused:<uid>      integer                 (atomic INCR per consumed run)
//   run:<uid>:<runId>   short-lived marker      (dedupes the many calls in one run)

import { randomUUID } from 'node:crypto';
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

export async function getRunsUsed(uid) {
  return Number((await kvGet(`runsused:${uid}`)) || 0);
}

export async function uidForApiKey(key) {
  if (!key) return null;
  return kvGet(`key:${hashApiKey(key)}`);
}

export async function createOrGetUserFromGithub({ ghId, email, name }) {
  const existingUid = await kvGet(`ghid:${ghId}`);
  if (existingUid) {
    const existing = await getUser(existingUid);
    if (existing) return existing;
  }
  const uid = randomUUID();
  const apiKey = generateApiKey();
  const user = {
    uid,
    ghId: String(ghId),
    email: email || '',
    name: name || '',
    plan: 'free',
    apiKey,
    createdAt: new Date().toISOString()
  };
  await saveUser(user);
  await kvSet(`ghid:${ghId}`, uid);
  await kvSet(`key:${hashApiKey(apiKey)}`, uid);
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
// x-skillcheck-run id; only the first call of a new id consumes a slot.
// Returns { allowed, counted, used, limit, reason? }.
export async function consumeRun(uid, runId, plan) {
  const limit = runLimitFor(plan);
  const used = await getRunsUsed(uid);

  if (!runId) {
    // Unmetered request (e.g. the dashboard's in-browser preview): allow, no charge.
    return { allowed: true, counted: false, used, limit };
  }

  const isNewRun = (await kvSet(`run:${uid}:${runId}`, '1', { nx: true, ex: 86400 })) === 'OK';
  if (!isNewRun) {
    return { allowed: true, counted: false, used, limit };
  }

  if (used >= limit) {
    await kvDel(`run:${uid}:${runId}`); // reject without consuming the slot
    return { allowed: false, counted: false, used, limit, reason: 'quota_exceeded' };
  }

  const nowUsed = await kvIncr(`runsused:${uid}`);
  return { allowed: true, counted: true, used: nowUsed, limit };
}
