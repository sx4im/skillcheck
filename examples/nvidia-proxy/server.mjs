#!/usr/bin/env node
import { createServer } from 'node:http';

const port = Number(process.env.PORT || 8787);
const nvidiaApiKey = process.env.NVIDIA_API_KEY?.trim();
const nvidiaBaseUrl = process.env.NVIDIA_BASE_URL?.trim() || 'https://integrate.api.nvidia.com/v1';
const proxyToken = process.env.SKILLCHECK_PROXY_TOKEN?.trim();
const maxBodyBytes = Number(process.env.MAX_BODY_BYTES || 5_000_000);

if (!nvidiaApiKey) {
  throw new Error('Missing NVIDIA_API_KEY. Set it on the server, never inside the npm CLI.');
}

function writeJson(res, status, body) {
  res.writeHead(status, {
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-origin': '*',
    'content-type': 'application/json'
  });
  res.end(`${JSON.stringify(body)}\n`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(new Error('Request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function isAuthorized(req) {
  if (!proxyToken) {
    return true;
  }
  return req.headers.authorization === `Bearer ${proxyToken}`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    writeJson(res, 204, {});
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    writeJson(res, 200, { ok: true });
    return;
  }

  if (req.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
    writeJson(res, 404, { error: 'Not found' });
    return;
  }

  if (!isAuthorized(req)) {
    writeJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  try {
    const body = await readBody(req);
    const upstream = await fetch(`${nvidiaBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${nvidiaApiKey}`,
        'content-type': 'application/json'
      },
      body
    });

    res.writeHead(upstream.status, {
      'access-control-allow-origin': '*',
      'content-type': upstream.headers.get('content-type') || 'application/json'
    });
    res.end(await upstream.text());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeJson(res, 500, { error: message });
  }
});

server.listen(port, () => {
  console.log(`skillcheck NVIDIA proxy listening on http://localhost:${port}`);
});
