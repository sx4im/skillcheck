import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { providerFetch, readProviderBody } from '../src/providers/transport.js';

vi.mock('node:dns', async (original) => {
  const dns = await original<typeof import('node:dns')>();
  return {
    ...dns,
    lookup: (host: string, options: import('node:dns').LookupAllOptions, callback: (error: NodeJS.ErrnoException | null, addrs: import('node:dns').LookupAddress[]) => void) => {
      if (host === 'blocked.example.test') callback(null, [{ address: '169.254.169.254', family: 4 }]);
      else dns.lookup(host, options, callback);
    }
  };
});

describe('provider transport', () => {
  it('rejects an unsafe resolved address before making an outbound connection', async () => {
    await expect(providerFetch('https://blocked.example.test/v1', { signal: AbortSignal.timeout(500) }))
      .rejects.toThrow(/resolved to a blocked/);
  });

  it('rejects a loopback redirect without requesting the destination', async () => {
    let calls = 0;
    const server = createServer((_request, response) => {
      calls += 1;
      response.writeHead(302, { location: '/destination' }).end();
    });
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected a loopback port.');
      await expect(providerFetch('http://127.0.0.1:' + address.port + '/start', { signal: AbortSignal.timeout(1000) }))
        .rejects.toThrow(/redirect/);
      expect(calls).toBe(1);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it('stops reading a provider response once it exceeds the byte limit', async () => {
    await expect(readProviderBody(new Response('😀😀'), 7)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
    expect(await readProviderBody(new Response('😀😀'), 8)).toBe('😀😀');
  });
});
