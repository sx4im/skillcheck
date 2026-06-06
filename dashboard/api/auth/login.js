import { randomBytes } from 'node:crypto';
import { redirect, setCookie, sendJson } from '../_lib/http.js';
import { GITHUB_ID, appUrl } from '../_lib/config.js';

export default function handler(req, res) {
  if (!GITHUB_ID) {
    return sendJson(res, 500, { error: { message: 'GitHub sign-in is not configured (set AUTH_GITHUB_ID).' } });
  }
  const state = randomBytes(16).toString('hex');
  setCookie(res, 'sc_oauth_state', state, { maxAge: 600, httpOnly: true, sameSite: 'Lax', secure: true });

  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', GITHUB_ID);
  authorize.searchParams.set('redirect_uri', `${appUrl(req)}/api/auth/callback`);
  authorize.searchParams.set('scope', 'read:user user:email');
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('allow_signup', 'true');
  redirect(res, authorize.toString());
}
