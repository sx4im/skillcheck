// Zero-dependency smoke test for the dashboard's core logic.
// Runs against the in-memory store (no Upstash/env needed): `node test/smoke.mjs`.

import assert from 'node:assert/strict';
import { generateApiKey, hashApiKey, maskApiKey } from '../api/_lib/keys.js';
import { getOrCreateUser, userForApiKey, consumeRun, getRunsUsed, rollbackRun, setPlan, rotateApiKey } from '../api/_lib/users.js';
import { FREE_RUNS } from '../api/_lib/config.js';
import { kvGet, kvSet, kvIncrWithExpiry } from '../api/_lib/store.js';

let passed = 0;
function ok(label) { passed += 1; console.log('  ✓', label); }

// --- keys ---
const key = generateApiKey();
assert.match(key, /^chk_live_[A-Za-z0-9_-]{20,}$/, 'key format');
assert.equal(hashApiKey(key), hashApiKey(key), 'hash is deterministic');
assert.notEqual(hashApiKey(key), key, 'hash is not the raw key');
assert.ok(maskApiKey(key).includes('…') && maskApiKey(key).startsWith('chk_live_'), 'mask hides middle');
ok('keys: generate / hash / mask');

// --- users keyed by Clerk user id ---
const user = await getOrCreateUser({ userId: 'clerk_user_1', email: 'a@b.com', name: 'A' });
assert.equal(user.uid, 'clerk_user_1', 'uid is the Clerk user id');
assert.ok(user.apiKey.startsWith('chk_live_'), 'issued an api key');
assert.equal((await userForApiKey(hashApiKey(user.apiKey))).uid, user.uid, 'key resolves to uid');
assert.ok(!(await kvGet(`user:${user.uid}`)).includes(user.apiKey), 'account row omits plaintext key');
const again = await getOrCreateUser({ userId: 'clerk_user_1' });
assert.equal(again.uid, user.uid, 'returning user is stable');
assert.equal(again.apiKey, undefined, 'secret is only issued once');
assert.equal(again.apiKeyMasked, user.apiKeyMasked, 'dashboard keeps a masked key');
ok('users: create / lookup / idempotent');

const legacyKey = generateApiKey();
const legacyDigest = hashApiKey(legacyKey);
const legacyUid = 'clerk_legacy_user';
await kvSet(`user:${legacyUid}`, JSON.stringify({ uid: legacyUid, plan: 'free', apiKey: legacyKey }));
await kvSet(`key:${legacyDigest}`, legacyUid);
assert.equal((await userForApiKey(legacyDigest)).uid, legacyUid, 'legacy keys authenticate after migration');
const migrated = JSON.parse(await kvGet(`user:${legacyUid}`));
assert.equal(migrated.apiKey, undefined);
assert.equal(migrated.apiKeyHash, legacyDigest);
assert.equal(migrated.apiKeyMasked, maskApiKey(legacyKey));
ok('users: legacy key migrates without invalidating the saved CLI token');

// 10 distinct runs allowed and counted
for (let i = 1; i <= FREE_RUNS; i += 1) {
  const r = await consumeRun(user.uid, `run-${i}`, 'free');
  assert.equal(r.allowed, true, `run ${i} allowed`);
  assert.equal(r.counted, true, `run ${i} counted`);
}
assert.equal(await getRunsUsed(user.uid), FREE_RUNS, 'used == FREE_RUNS');

// repeating a run id within the same run does not consume another slot
const repeat = await consumeRun(user.uid, 'run-1', 'free');
assert.equal(repeat.allowed, true, 'repeat allowed');
assert.equal(repeat.counted, false, 'repeat not counted');
assert.equal(await getRunsUsed(user.uid), FREE_RUNS, 'used unchanged after repeat');

// the 11th distinct run is blocked on the free plan
const over = await consumeRun(user.uid, 'run-over', 'free');
assert.equal(over.allowed, false, '11th run blocked');
assert.equal(over.reason, 'quota_exceeded', 'blocked reason');
assert.equal(await getRunsUsed(user.uid), FREE_RUNS, 'blocked run did not consume a slot');

// SECURITY: a request without a run id is metered too — it is NOT a bypass.
// The user is already at the free limit, so dropping the run id must still be gated.
const noBypass = await consumeRun(user.uid, '', 'free');
assert.equal(noBypass.allowed, false, 'no run id does not bypass the quota');
assert.equal(noBypass.reason, 'quota_exceeded', 'over-quota no-run-id request blocked');

// And under quota, a no-run-id request consumes a run of its own (cannot dedupe).
const metered = await getOrCreateUser({ userId: 'clerk_user_meter', email: 'm@b.com', name: 'M' });
const firstNoId = await consumeRun(metered.uid, '', 'free');
assert.equal(firstNoId.allowed, true, 'no-run-id allowed under quota');
assert.equal(firstNoId.counted, true, 'no-run-id consumes a run');
assert.equal(await getRunsUsed(metered.uid), 1, 'no-run-id incremented usage');
ok('metering: 10 free runs, dedupe, gate at 11, no run-id bypass');

const concurrent = await getOrCreateUser({ userId: 'clerk_concurrent_runs' });
for (let i = 1; i < FREE_RUNS; i += 1) await consumeRun(concurrent.uid, `warmup-${i}`, 'free');
const sharedRun = await Promise.all([
  consumeRun(concurrent.uid, 'last-slot', 'free'), consumeRun(concurrent.uid, 'last-slot', 'free')
]);
assert.ok(sharedRun.every(entry => entry.allowed), 'concurrent calls share the last quota slot');
assert.equal(sharedRun.filter(entry => entry.counted).length, 1, 'parallel calls charge one run');
await rollbackRun(concurrent.uid, 'last-slot', sharedRun[0].month);
assert.equal(await getRunsUsed(concurrent.uid), FREE_RUNS, 'failure of one call cannot refund a shared run');
ok('metering: concurrent calls share a quota slot and preserve the charge');

// upgrading to pro lifts the cap
await setPlan(user.uid, 'pro');
const pro = await consumeRun(user.uid, 'run-pro', 'pro');
assert.equal(pro.allowed, true, 'pro run allowed past free limit');
assert.equal(pro.counted, true, 'pro run counted');
ok('metering: pro is unlimited');

// rotating the key invalidates the old one
const oldKey = user.apiKey;
const rotated = await rotateApiKey(user.uid);
assert.notEqual(rotated.apiKey, oldKey, 'new key differs');
assert.equal(await userForApiKey(hashApiKey(oldKey)), null, 'old key no longer resolves');
await kvSet(`key:${hashApiKey(oldKey)}`, user.uid);
assert.equal(await userForApiKey(hashApiKey(oldKey)), null, 'a stale index entry cannot reactivate the key');
assert.equal((await userForApiKey(hashApiKey(rotated.apiKey))).uid, user.uid, 'new key resolves');
ok('keys: rotation invalidates the old key');

const contenders = await Promise.all([rotateApiKey(user.uid), rotateApiKey(user.uid)]);
assert.equal(contenders.filter(Boolean).length, 1, 'one concurrent rotation wins');
assert.equal((await userForApiKey(hashApiKey(contenders.find(Boolean).apiKey))).uid, user.uid);
ok('keys: concurrent rotation returns only the winning key');

const originalClock = Date.now;
const now = originalClock();
assert.deepEqual(await Promise.all([kvIncrWithExpiry('rate-window', 60), kvIncrWithExpiry('rate-window', 60)]), [1, 2]);
try {
  Date.now = () => now + 61000;
  assert.equal(await kvIncrWithExpiry('rate-window', 60), 1);
} finally {
  Date.now = originalClock;
}
ok('rate limit counters expire and restart');

console.log(`\nAll smoke checks passed (${passed} groups).`);
