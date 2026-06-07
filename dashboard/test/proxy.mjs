// In-process integration test for the metered proxy handler.
// Stubs the upstream provider (global fetch) so it runs offline.
//   node test/proxy.mjs

import assert from 'node:assert/strict';

process.env.NVIDIA_API_KEY = 'test-upstream-key';
process.env.NVIDIA_BASE_URL = 'http://upstream.local/v1';
process.env.FREE_RUNS = '10';
// (no UPSTASH_* → in-memory store; no AUTH_SECRET → dev session secret)

// Stub the upstream model call.
let upstreamCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('upstream.local')) {
    upstreamCalls += 1;
    return {
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } })
    };
  }
  return realFetch(url, init);
};

const { getOrCreateUser } = await import('../api/_lib/users.js');
const handler = (await import('../api/chat/completions.js')).default;

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
async function call(key, runId) {
  const req = {
    method: 'POST',
    headers: {
      host: 'app.local',
      'x-forwarded-proto': 'https',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(runId ? { 'x-skillcheck-run': runId } : {})
    },
    body: { messages: [{ role: 'user', content: 'hi' }] }
  };
  const res = mockRes();
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch {}
  return { status: res.statusCode, json, headers: res.headers };
}

const user = await getOrCreateUser({ userId: 'clerk_proxy_1', email: 'p@x.com', name: 'P' });

// 1. Missing key → 401
assert.equal((await call('', 'r1')).status, 401, 'missing key rejected');

// 2. Invalid key → 401
assert.equal((await call('chk_live_nope', 'r1')).status, 401, 'invalid key rejected');

// 3. Ten valid runs forward and succeed
for (let i = 1; i <= 10; i += 1) {
  const r = await call(user.apiKey, `run-${i}`);
  assert.equal(r.status, 200, `run ${i} forwarded`);
  assert.equal(r.headers['x-skillcheck-runs-used'], String(i), `run ${i} usage header`);
}

// 4. Many calls within one run id only count once
const before = upstreamCalls;
for (let i = 0; i < 3; i += 1) await call(user.apiKey, 'run-3'); // existing run id
assert.equal(upstreamCalls, before + 3, 'mid-run calls still forward');

// 5. 11th distinct run → 402 quota
const over = await call(user.apiKey, 'run-11');
assert.equal(over.status, 402, '11th run blocked');
assert.equal(over.json.error.type, 'quota_exceeded', '402 type');
assert.match(over.json.error.upgrade_url, /\/app\.html$/, 'upgrade url present');

// 6. SECURITY: dropping the run-id header is NOT a way around the quota.
//    The user is over quota, so a no-run-id call must still be blocked.
const bypass = await call(user.apiKey, '');
assert.equal(bypass.status, 402, 'no run id does not bypass the quota');

// 7. A no-run-id call from a fresh user forwards and consumes a single run.
const user2 = await getOrCreateUser({ userId: 'clerk_proxy_2', email: 'q@x.com', name: 'Q' });
const fresh = await call(user2.apiKey, '');
assert.equal(fresh.status, 200, 'no-run-id call forwards when under quota');
assert.equal(fresh.headers['x-skillcheck-runs-used'], '1', 'no-run-id call consumes a run');

console.log('Proxy integration checks passed (upstream calls:', upstreamCalls + ').');
