// Liveness + readiness. `ok` stays true so uptime checks pass, but `ready`
// reflects whether the deployment is actually configured to issue working keys:
// a durable store (Upstash), an upstream model key, and auth. Secrets are never
// returned — only booleans.

import { sendJson, methodNotAllowed } from './_lib/http.js';
import { storeDurable } from './_lib/store.js';
import { NVIDIA_API_KEY, clerkEnabled, billingEnabled, DEFAULT_MODEL } from './_lib/config.js';

export default function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');

  const checks = {
    durableStore: storeDurable,
    modelProvider: Boolean(NVIDIA_API_KEY),
    auth: clerkEnabled,
    billing: billingEnabled
  };
  const ready = checks.durableStore && checks.modelProvider && checks.auth;

  sendJson(res, 200, {
    ok: true,
    service: 'skillcheck',
    ready,
    model: DEFAULT_MODEL,
    checks,
    time: new Date().toISOString()
  });
}
