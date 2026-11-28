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
async function call(key, method = 'POST', ip = '192.0.2.1', forwarded = '', body = undefined) {
  const req = {
    method,
    headers: {
      'content-type': 'application/json', 'x-forwarded-for': forwarded,
      ...(key ? { authorization: `Bearer ${key}` } : {})
    },
    socket: { remoteAddress: ip },
    body
  };
  const res = mockRes();
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch {}
  return { status: res.statusCode, json, headers: res.headers };
}

const user = await getOrCreateUser({ userId: 'verify_user', email: 'v@x.com', name: 'V' });

// 1. A valid key verifies and reports plan + quota.
const ok = await call(user.apiKey, 'POST', '192.0.2.1', '', '{}');
assert.equal(ok.status, 200, 'valid key → 200');
assert.equal(ok.json.valid, true, 'valid:true');
assert.equal(ok.json.plan, 'free', 'plan reported');
assert.equal(ok.json.runsLimit, 10, 'runsLimit reported');
assert.equal(ok.json.runsUsed, 0, 'runsUsed reported');
assert.equal(ok.headers['cache-control'], 'no-store');
assert.equal((await call(user.apiKey, 'POST', '192.0.2.1', '', '{"token":"ignored"}')).status, 400);

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

const limitedUser = await getOrCreateUser({ userId: 'verify_limited' });
for (let i = 1; i <= 20; i += 1) {
  assert.equal((await call(limitedUser.apiKey, 'POST', `198.51.100.${i}`)).status, 200);
}
const perKey = await call(limitedUser.apiKey, 'POST', '198.51.100.21');
assert.equal(perKey.status, 429);
assert.equal(perKey.headers['retry-after'], '60');

for (let i = 1; i <= 60; i += 1) {
  assert.equal((await call('', 'POST', '192.0.2.50', `198.51.100.${i}`)).status, 401);
}
assert.equal((await call(user.apiKey, 'GET', '192.0.2.50', '198.51.100.61')).status, 429);
assert.equal((await call(user.apiKey, 'GET', '192.0.2.51')).status, 200);

console.log('Key-verify checks passed (no runs consumed).');
