// Small helpers shared by every serverless function.

/**
 * @param {import('http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/**
 * @param {import('http').ServerResponse} res
 * @param {string} allow
 */
export function methodNotAllowed(res, allow) {
  res.setHeader('allow', allow);
  sendJson(res, 405, { error: { message: `Method not allowed. Use ${allow}.` } });
}

// Permissive CORS for the proxy endpoint only. Safe because auth is by Bearer
// API key, not by cookie, so '*' cannot be abused with ambient credentials.
/**
 * @param {import('http').ServerResponse} res
 */
export function proxyCors(res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization, content-type, x-skillcheck-run');
  res.setHeader('access-control-allow-methods', 'POST, GET, OPTIONS');
}

/**
 * @param {import('http').IncomingMessage} req
 * @returns {string}
 */
export function bearerToken(req) {
  const header = req.headers['authorization'] || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

// Vercel parses JSON bodies into req.body; locally (node http) it may be a stream.
/**
 * @param {import('http').IncomingMessage & { body?: unknown }} req
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return /** @type {Record<string, unknown>} */ (req.body);
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

