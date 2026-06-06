// Public, browser-safe configuration for the static frontend. The Clerk
// publishable key is designed to be exposed; secrets are never returned here.

import { sendJson, methodNotAllowed } from './_lib/http.js';
import { CLERK_PUBLISHABLE_KEY, clerkEnabled, billingEnabled } from './_lib/config.js';

export default function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
  sendJson(res, 200, {
    clerkPublishableKey: CLERK_PUBLISHABLE_KEY || null,
    clerkEnabled,
    billingEnabled
  });
}
