// Small helpers shared by every serverless function.

/**
 * @param {import('http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
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
  const header = req.headers.authorization;
  if (typeof header !== 'string' || header.length > 8192) return '';
  return /^Bearer +([^\s,]+)$/i.exec(header)?.[1] || '';
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {import('http').IncomingMessage & { body?: unknown }} req
 * @param {number} maxBytes
 * @returns {Promise<{ value: unknown } | { status: number, message: string }>}
 */
export async function readJsonBody(req, maxBytes) {
  const tooLarge = { status: 413, message: `Request body exceeds ${maxBytes} bytes.` };
  if (Number(req.headers['content-length']) > maxBytes) return tooLarge;
  const isJson = /^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '');
  const unsupported = { status: 415, message: 'Content-Type must be application/json.' };
  try {
    // Read the Node request stream before Vercel's lazy JSON parser so chunked
    // bodies are subject to the same wire-byte limit as Content-Length bodies.
    if (typeof req.iterator === 'function') {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > maxBytes || !isJson) {
          req.resume();
          return bytes > maxBytes ? tooLarge : unsupported;
        }
        chunks.push(buffer);
      }
      if (bytes === 0) return { value: undefined };
      const json = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      return { value: JSON.parse(json) };
    }

    const body = req.body;
    if (body === undefined) return { value: undefined };
    if (!isJson) return unsupported;
    const json = typeof body === 'string' ? body : JSON.stringify(body);
    if (Buffer.byteLength(json) > maxBytes) return tooLarge;
    return { value: JSON.parse(json) };
  } catch {
    return { status: 400, message: 'Malformed JSON request body.' };
  }
}

