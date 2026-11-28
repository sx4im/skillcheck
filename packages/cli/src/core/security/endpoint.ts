import { isIP } from 'node:net';
import { ConfigError } from '../../errors.js';

export function isLoopback(address: string): boolean {
  return address === '::1' || (isIP(address) === 4 && address.startsWith('127.'));
}

export function isBlockedAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(ip) === 4) {
    return ip.startsWith('169.254.') || ip.startsWith('0.') || ip === '100.100.100.200';
  }
  if (isIP(ip) !== 6) return false;
  const canonical = new URL('http://[' + ip + ']').hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
  if (mapped) {
    const left = Number.parseInt(mapped[1]!, 16);
    const right = Number.parseInt(mapped[2]!, 16);
    return isBlockedAddress([left >> 8, left & 255, right >> 8, right & 255].join('.'));
  }
  return canonical === '::' || canonical === 'fd00:ec2::254' || /^fe[89ab][0-9a-f]:/.test(canonical);
}

export function validateEndpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError('Provider endpoint must be an absolute HTTPS URL.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const local = host === 'localhost' || isLoopback(host);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new ConfigError('Provider URL requires https://. HTTP is allowed for loopback only.');
  }
  if (isBlockedAddress(host) || host === 'metadata.google.internal' || host === 'metadata') {
    throw new ConfigError('Provider URL points to a blocked network address.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ConfigError('Provider URL must omit user info, query parameters and fragments.');
  }
  return url;
}

export function baseUrl(value: string): string {
  return validateEndpoint(value).href.replace(/\/+$/, '');
}
