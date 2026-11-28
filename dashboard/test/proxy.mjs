// In-process integration test for the metered proxy handler.
// Stubs the upstream provider (global fetch) so it runs offline.
//   node test/proxy.mjs

import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.NVIDIA_API_KEY = 'test-upstream-key';
process.env.NVIDIA_BASE_URL = 'http://upstream.local/v1';
process.env.FREE_RUNS = '10';
// (no UPSTASH_* → in-memory store; no AUTH_SECRET → dev session secret)

// Stub the upstream model call.
let upstreamCalls = 0;
let upstreamStatus = 200;
let forwarded;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('upstream.local')) {
    upstreamCalls += 1;
    forwarded = JSON.parse(init.body);
    const body = upstreamStatus === 200
      ? { choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } }
      : { error: { message: process.env.NVIDIA_API_KEY } };
    return Response.json(body, { status: upstreamStatus });
  }
  throw new Error(`Unexpected outbound request to ${url}`);
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
const validBody = { model: 'openai/gpt-oss-120b', messages: [{ role: 'user', content: 'hi' }] };

async function call(key, runId, body = validBody, ip = '192.0.2.1') {
  const req = body instanceof Readable ? body : { body };
  Object.assign(req, {
    method: 'POST',
    headers: {
      host: 'app.local',
      'content-type': 'application/json',
      'x-forwarded-proto': 'https',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(runId ? { 'x-skillcheck-run': runId } : {})
    },
    socket: { remoteAddress: ip }
  });
  const res = mockRes();
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch {}
  return { status: res.statusCode, json, headers: res.headers };
}

const user = await getOrCreateUser({ userId: 'clerk_proxy_1', email: 'p@x.com', name: 'P' });

for (const invalid of [
  { ...validBody, model: 'unsupported/model' },
  { ...validBody, max_tokens: 16001 },
  { ...validBody, max_tokens: '1000' },
  { ...validBody, messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
  { ...validBody, tools: [] },
  { ...validBody, stream: true },
  '{bad JSON',
  '[]'
]) {
  assert.equal((await call(user.apiKey, 'invalid', invalid)).status, 400);
}
assert.equal((await call(user.apiKey, 'large', { ...validBody, messages: [{ role: 'user', content: 'é'.repeat(300000) }] })).status, 413);
assert.equal((await call(user.apiKey, 'large-stream', Readable.from([Buffer.alloc(300000), Buffer.alloc(300000)]))).status, 413);
assert.equal((await call(user.apiKey, 'invalid-stream', Readable.from([Buffer.from([0xff])]))).status, 400);
assert.equal((await call(user.apiKey, 'invalid/run')).status, 400);
assert.equal(upstreamCalls, 0, 'invalid requests never reach the provider');

upstreamStatus = 503;
const failed = await call(user.apiKey, 'failed', validBody);
assert.equal(failed.status, 502);
assert.ok(!JSON.stringify(failed.json).includes(process.env.NVIDIA_API_KEY));
assert.equal(failed.headers['cache-control'], 'no-store');
upstreamStatus = 200;

// 1. Missing key → 401
assert.equal((await call('', 'r1')).status, 401, 'missing key rejected');

// 2. Invalid key → 401
assert.equal((await call('chk_live_nope', 'r1')).status, 401, 'invalid key rejected');

// 3. Ten valid runs forward and succeed
for (let i = 1; i <= 10; i += 1) {
  const r = await call(user.apiKey, `run-${i}`, {
    ...validBody, max_tokens: 8000, temperature: 0.7,
    response_format: { type: 'json_object' }, stream: false, chat_template_kwargs: { enable_thinking: false }, extra_body: {}
  });
  assert.equal(r.status, 200, `run ${i} forwarded`);
  assert.equal(r.headers['x-skillcheck-runs-used'], String(i), `run ${i} usage header`);
}
assert.deepEqual(forwarded, {
  ...validBody, stream: false, n: 1, max_tokens: 8000, temperature: 0.7,
  response_format: { type: 'json_object' }, chat_template_kwargs: { enable_thinking: false }
});

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

const streamed = Readable.from([Buffer.from(JSON.stringify(validBody))]);
Object.defineProperty(streamed, 'body', { get() { throw new Error('Lazy body parser should not run.'); } });
assert.equal((await call(user2.apiKey, 'stream-input', streamed)).status, 200, 'bounded Node request stream reaches the provider');

console.log('Proxy integration checks passed (upstream calls:', upstreamCalls + ').');
