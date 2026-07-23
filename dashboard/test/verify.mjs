// In-process test for the key-verification endpoint the CLI uses at setup.
// Crucially, verifying a key must NOT consume a metered run.  `node test/verify.mjs`

import assert from 'node:assert/strict';

process.env.FREE_RUNS = '10';

const { getOrCreateUser, getRunsUsed } = await import('../api/_lib/users.js');
const handler = (await import('../api/key/verify.js')).default;

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    getHeader(name) { return this.headers[name.toLowerCase()]; },
    end(chunk) { if (chunk) this.body += chunk; this.ended = true; }
  };
}
async function call(key, method = 'POST') {
  const req = { method, headers: { host: 'app.local', ...(key ? { authorization: `Bearer ${key}` } : {}) } };
  const res = mockRes();
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch {}
  return { status: res.statusCode, json };
}

const user = await getOrCreateUser({ userId: 'verify_user', email: 'v@x.com', name: 'V' });

// 1. A valid key verifies and reports plan + quota.
const ok = await call(user.apiKey);
assert.equal(ok.status, 200, 'valid key → 200');
assert.equal(ok.json.valid, true, 'valid:true');
assert.equal(ok.json.plan, 'free', 'plan reported');
assert.equal(ok.json.runsLimit, 10, 'runsLimit reported');
assert.equal(ok.json.runsUsed, 0, 'runsUsed reported');

// 2. Verifying does NOT consume a run, no matter how many times it is called.
await call(user.apiKey); await call(user.apiKey); await call(user.apiKey);
assert.equal(await getRunsUsed(user.uid), 0, 'verify never consumes a run');

// 3. Missing key → 401, invalid key → 401.
assert.equal((await call('')).status, 401, 'missing key → 401');
const bad = await call('chk_live_nope');
assert.equal(bad.status, 401, 'invalid key → 401');
assert.equal(bad.json.valid, false, 'invalid:false');

// 4. OPTIONS preflight → 204 (CORS so the CLI/browser can call it cross-origin).
const pre = await call(user.apiKey, 'OPTIONS');
assert.equal(pre.status, 204, 'OPTIONS preflight → 204');

console.log('Key-verify checks passed (no runs consumed).');
