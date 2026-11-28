import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const read = file => readFile(new URL(file, import.meta.url), 'utf8');
const config = JSON.parse(await read('../vercel.json'));
const headers = new Map(config.headers.find(rule => rule.source === '/(.*)').headers.map(({ key, value }) => [key, value]));
for (const name of ['Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) {
  assert.ok(headers.has(name), `${name} applies to dashboard routes`);
}
const policy = headers.get('Content-Security-Policy');
const scripts = policy.split('; ').find(directive => directive.startsWith('script-src '));
assert.doesNotMatch(scripts, /unsafe-inline|unsafe-eval/);
assert.match(policy, /frame-ancestors 'none'/);
for (const file of ['../index.html', '../app.html', '../sso-callback.html']) {
  for (const [, body] of (await read(file)).matchAll(/<script(?: [^>]*)?>([\s\S]+?)<\/script>/g)) {
    const digest = createHash('sha256').update(body).digest('base64');
    assert.ok(scripts.includes(`'sha256-${digest}'`), `CSP authorizes the inline script in ${file}`);
  }
}

console.log('Vercel browser security headers and CSP script hashes passed.');
