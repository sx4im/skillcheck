import { redirect, parseCookies, clearCookie } from '../_lib/http.js';
import { GITHUB_ID, GITHUB_SECRET, appUrl } from '../_lib/config.js';
import { setSession } from '../_lib/session.js';
import { createOrGetUserFromGithub } from '../_lib/users.js';

export default async function handler(req, res) {
  try {
    const base = appUrl(req);
    const url = new URL(req.url, base);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const expectedState = parseCookies(req)['sc_oauth_state'];

    if (!code || !state || !expectedState || state !== expectedState) {
      return redirect(res, '/?error=oauth_state');
    }
    clearCookie(res, 'sc_oauth_state');

    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_ID,
        client_secret: GITHUB_SECRET,
        code,
        redirect_uri: `${base}/api/auth/callback`
      })
    });
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) return redirect(res, '/?error=oauth_token');

    const ghHeaders = {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'skillcheck-dashboard'
    };
    const gh = await (await fetch('https://api.github.com/user', { headers: ghHeaders })).json();

    let email = gh.email;
    if (!email) {
      const emailsResponse = await fetch('https://api.github.com/user/emails', { headers: ghHeaders });
      if (emailsResponse.ok) {
        const emails = await emailsResponse.json();
        const primary = Array.isArray(emails)
          ? emails.find((entry) => entry.primary && entry.verified) || emails.find((entry) => entry.verified)
          : null;
        email = primary ? primary.email : undefined;
      }
    }
    email = email || `${gh.login}@users.noreply.github.com`;

    const user = await createOrGetUserFromGithub({ ghId: gh.id, email, name: gh.name || gh.login });
    setSession(res, { uid: user.uid });
    redirect(res, '/app.html');
  } catch {
    redirect(res, '/?error=oauth');
  }
}
