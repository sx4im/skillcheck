import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';

process.env.APP_URL = 'https://skillcheck.example';
process.env.CLERK_SECRET_KEY = 'test-clerk-key';
process.env.STRIPE_SECRET_KEY = 'test-stripe-key';
process.env.STRIPE_PRICE_ID = 'price_skillcheck';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-jwk', alg: 'RS256' };
const accountId = 'user_billing_test';
const sessionId = 'cs_test_example';
let calls = 0;
let jwksCalls = 0;
let checkout = {
  id: sessionId, mode: 'payment', status: 'complete', payment_status: 'unpaid',
  client_reference_id: accountId, line_items: { data: [{ price: { id: process.env.STRIPE_PRICE_ID }, quantity: 1 }] }
};

function token(azp = process.env.APP_URL) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const data = `${encode({ typ: 'JWT', alg: 'RS256', kid: jwk.kid })}.${encode({
    azp, iss: 'https://clerk.skillcheck.example', sub: accountId, sid: 'sess_test', iat: now, nbf: now, exp: now + 60
  })}`;
  return `${data}.${sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url')}`;
}

globalThis.fetch = async (value, init) => {
  const url = new URL(value);
  assert.ok(init.signal);
  if (url.href === 'https://api.clerk.com/v1/jwks') {
    jwksCalls += 1;
    return Response.json({ keys: [jwk] });
  }
  if (url.host !== 'api.stripe.com') throw new Error(`Unexpected outbound request to ${url}`);
  calls += 1;
  if (init.method === 'POST') {
    const values = new URLSearchParams(init.body);
    assert.match(values.get('success_url'), /^https:\/\/skillcheck\.example\/app\.html/);
    assert.equal(values.get('client_reference_id'), accountId);
    return Response.json({ url: 'https://checkout.stripe.com/example-session' });
  }
  assert.equal(url.searchParams.get('expand[]'), 'line_items');
  return Response.json(checkout);
};

const { getOrCreateUser, getUser } = await import('../api/_lib/users.js');
const confirm = (await import('../api/billing/confirm.js')).default;
const start = (await import('../api/billing/checkout.js')).default;
const me = (await import('../api/me.js')).default;

async function call(handler, { auth = token(), method = 'POST', session = sessionId } = {}) {
  const req = {
    method,
    headers: { authorization: `Bearer ${auth}`, 'x-forwarded-host': 'untrusted.invalid' },
    url: `/api/billing/confirm?session_id=${session}`
  };
  let body;
  const res = { setHeader() {}, end(value) { body = JSON.parse(value); } };
  await handler(req, res);
  return { status: res.statusCode, body };
}

const user = await getOrCreateUser({ userId: accountId });
assert.ok(user.apiKey);
const account = await call(me, { method: 'GET' });
assert.equal(account.status, 200);
assert.equal(account.body.apiKey, undefined);
assert.equal(account.body.apiKeyMasked, user.apiKeyMasked);
assert.equal((await call(start, { auth: token('https://untrusted.invalid') })).status, 401);
assert.equal(calls, 0);
assert.equal((await call(start)).body.url, 'https://checkout.stripe.com/example-session');
assert.equal((await call(confirm, { session: 'malformed' })).status, 400);
assert.equal((await call(confirm)).body.plan, 'free', 'completed checkout waiting for payment leaves plan unchanged');
checkout = { ...checkout, payment_status: 'paid', client_reference_id: 'user_other' };
assert.equal((await call(confirm)).body.plan, 'free', 'paid checkout must belong to the Clerk session');
checkout = { ...checkout, client_reference_id: accountId, line_items: { data: [{ price: { id: 'price_other' }, quantity: 1 }] } };
assert.equal((await call(confirm)).body.plan, 'free', 'payment must include the configured price');
checkout = { ...checkout, error: { message: process.env.STRIPE_SECRET_KEY } };
const failure = await call(confirm);
assert.equal(failure.status, 502);
assert.ok(!JSON.stringify(failure.body).includes(process.env.STRIPE_SECRET_KEY));
delete checkout.error;
checkout.line_items.data[0].price.id = process.env.STRIPE_PRICE_ID;
assert.equal((await call(confirm)).body.plan, 'pro');
assert.equal((await getUser(accountId)).plan, 'pro');
assert.equal(jwksCalls, 1, 'the bounded JWKS fetch is shared across requests');

console.log('Clerk authentication and Stripe payment checks passed.');
