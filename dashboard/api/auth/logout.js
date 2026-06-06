import { redirect } from '../_lib/http.js';
import { clearSession } from '../_lib/session.js';

export default function handler(req, res) {
  clearSession(res);
  redirect(res, '/');
}
