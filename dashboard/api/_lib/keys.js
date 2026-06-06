// Skillcheck API key helpers. Keys look like `sk_live_<random>` and are what the
// user pastes into the CLI as SKILLCHECK_TOKEN. The proxy authenticates a request
// by hashing the presented key and looking the hash up in the store.

import { createHash, randomBytes } from 'node:crypto';
import { TOKEN_PEPPER } from './config.js';

export function generateApiKey(live = true) {
  const random = randomBytes(24).toString('base64url');
  return `sk_${live ? 'live' : 'test'}_${random}`;
}

export function hashApiKey(key) {
  return createHash('sha256').update(`${key}.${TOKEN_PEPPER}`).digest('hex');
}

export function maskApiKey(key) {
  if (!key || key.length < 16) return key || '';
  return `${key.slice(0, 11)}…${key.slice(-4)}`;
}
