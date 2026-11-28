import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { TOKEN_PEPPER } from './config.js';
import { sendJson } from './http.js';
import { kvIncrWithExpiry } from './store.js';

const WINDOW_SECONDS = 60;
const LIMITS = { chat: { ip: 300, key: 120 }, verify: { ip: 60, key: 20 } };

/** @param {import('node:http').IncomingMessage} req */
function requestIp(req) {
  // Vercel replaces x-forwarded-for at its ingress. A self-hosted local server
  // trusts the socket and ignores caller-provided forwarding headers.
  const deployed = process.env.VERCEL && process.env.VERCEL_ENV !== 'development';
  const ip = deployed ? req.headers['x-forwarded-for'] : req.socket?.remoteAddress;
  if (typeof ip !== 'string' || ip.includes('%')) return 'unknown';
  const version = isIP(ip);
  if (version === 6) return new URL(`http://[${ip}]/`).hostname;
  return version === 4 ? ip : 'unknown';
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {'chat' | 'verify'} scope
 */
export async function limitIp(req, scope) {
  const digest = createHmac('sha256', TOKEN_PEPPER).update(requestIp(req)).digest('hex');
  return (await kvIncrWithExpiry(`rate:${scope}:ip:${digest}`, WINDOW_SECONDS)) > LIMITS[scope].ip;
}

/** @param {string} digest @param {'chat' | 'verify'} scope */
export async function limitKey(digest, scope) {
  return (await kvIncrWithExpiry(`rate:${scope}:key:${digest}`, WINDOW_SECONDS)) > LIMITS[scope].key;
}

/** @param {import('node:http').ServerResponse} res */
export function rateLimitExceeded(res) {
  res.setHeader('retry-after', String(WINDOW_SECONDS));
  sendJson(res, 429, { error: { message: 'Too many requests. Try again in a minute.', type: 'rate_limit_exceeded' } });
}
