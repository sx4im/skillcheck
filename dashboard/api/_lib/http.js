// Small helpers shared by every serverless function.

export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function methodNotAllowed(res, allow) {
  res.setHeader('allow', allow);
  sendJson(res, 405, { error: { message: `Method not allowed. Use ${allow}.` } });
}

// Permissive CORS for the proxy endpoint only. Safe because auth is by Bearer
// API key, not by cookie, so '*' cannot be abused with ambient credentials.
export function proxyCors(res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization, content-type, x-skillcheck-run');
  res.setHeader('access-control-allow-methods', 'POST, GET, OPTIONS');
}

export function bearerToken(req) {
  const header = req.headers['authorization'] || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

export function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('location', location);
  res.end();
}

// Vercel parses JSON bodies into req.body; locally (node http) it may be a stream.
export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

export function parseCookies(req) {
  const out = {};
  const raw = req.headers['cookie'];
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function setCookie(res, name, value, options = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  segments.push(`Path=${options.path || '/'}`);
  if (options.maxAge != null) segments.push(`Max-Age=${options.maxAge}`);
  segments.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (options.httpOnly !== false) segments.push('HttpOnly');
  if (options.secure !== false) segments.push('Secure');
  appendHeader(res, 'Set-Cookie', segments.join('; '));
}

export function clearCookie(res, name) {
  appendHeader(res, 'Set-Cookie', `${name}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly; Secure`);
}

function appendHeader(res, name, value) {
  const existing = res.getHeader(name);
  if (!existing) res.setHeader(name, value);
  else res.setHeader(name, Array.isArray(existing) ? [...existing, value] : [existing, value]);
}
