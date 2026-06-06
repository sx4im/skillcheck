// Zero-dependency smoke test for the dashboard's core logic.
// Runs against the in-memory store (no Upstash/env needed): `node test/smoke.mjs`.

import assert from 'node:assert/strict';
import { generateApiKey, hashApiKey, maskApiKey } from '../api/_lib/keys.js';
import { getOrCreateUser, uidForApiKey, consumeRun, getRunsUsed, setPlan, rotateApiKey } from '../api/_lib/users.js';
import { FREE_RUNS } from '../api/_lib/config.js';

let passed = 0;
function ok(label) { passed += 1; console.log('  ✓', label); }

// --- keys ---
const key = generateApiKey();
assert.match(key, /^sk_live_[A-Za-z0-9_-]{20,}$/, 'key format');
assert.equal(hashApiKey(key), hashApiKey(key), 'hash is deterministic');
assert.notEqual(hashApiKey(key), key, 'hash is not the raw key');
assert.ok(maskApiKey(key).includes('…') && maskApiKey(key).startsWith('sk_live_'), 'mask hides middle');
ok('keys: generate / hash / mask');

// --- users keyed by Clerk user id ---
const user = await getOrCreateUser({ userId: 'clerk_user_1', email: 'a@b.com', name: 'A' });
assert.equal(user.uid, 'clerk_user_1', 'uid is the Clerk user id');
assert.ok(user.apiKey.startsWith('sk_live_'), 'issued an api key');
assert.equal(await uidForApiKey(user.apiKey), user.uid, 'key resolves to uid');
const again = await getOrCreateUser({ userId: 'clerk_user_1' });
assert.equal(again.uid, user.uid, 'returning user is stable');
assert.equal(again.apiKey, user.apiKey, 'key is preserved across sign-ins');
ok('users: create / lookup / idempotent');

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

// requests without a run id are allowed and uncounted (dashboard preview)
const preview = await consumeRun(user.uid, '', 'free');
assert.equal(preview.allowed, true, 'preview allowed');
assert.equal(preview.counted, false, 'preview not counted');
ok('metering: 10 free runs, dedupe, gate at 11, uncounted preview');

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
assert.equal(await uidForApiKey(oldKey), null, 'old key no longer resolves');
assert.equal(await uidForApiKey(rotated.apiKey), user.uid, 'new key resolves');
ok('keys: rotation invalidates the old key');

console.log(`\nAll smoke checks passed (${passed} groups).`);
