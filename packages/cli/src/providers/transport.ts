import { lookup } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Agent } from 'undici';
import { isBlockedAddress, isLoopback, validateEndpoint } from '../core/security/endpoint.js';
import { ConfigError, ProviderResponseError } from '../errors.js';

const safeLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, []);
    const loopback = hostname.toLowerCase().replace(/\.$/, '') === 'localhost';
    if (addresses.some(({ address }) => isBlockedAddress(address) || (loopback && !isLoopback(address)))) {
      return callback(new ConfigError('Provider name resolved to a blocked network address.'), []);
    }
    if (options.all) return callback(null, addresses);
    const first = addresses[0];
    if (!first) return callback(new ConfigError('Provider name did not resolve to an address.'), []);
    callback(null, first.address, first.family);
  });
};

const dispatcher = new Agent({ connect: { lookup: safeLookup } });

export async function providerFetch(input: string, init: RequestInit): Promise<Response> {
  const destination = new URL(input);
  // Query parameters constructed by an adapter can carry its API credential.
  // Only base URLs are user-controlled and subject to the query restriction.
  destination.search = '';
  validateEndpoint(destination.href);
  const options = { ...init, redirect: 'manual' as const, dispatcher };
  const response = await fetch(input, options).catch((error: unknown) => {
    if (error instanceof Error && error.cause instanceof ConfigError) throw error.cause;
    throw error;
  });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => {});
    throw new ConfigError('Provider URL returned a redirect. Configure the final endpoint.');
  }
  return response;
}

export async function readProviderBody(response: Response, maxBytes = 2 * 1024 * 1024): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new ProviderResponseError('Provider response exceeded the size limit.');
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new ProviderResponseError('Provider response exceeded the size limit.');
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

export function decodeProviderJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new ProviderResponseError(label + ' did not return valid JSON.', { cause });
  }
}

export async function readProviderJson(response: Response, label: string): Promise<unknown> {
  return decodeProviderJson(await readProviderBody(response), label);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
