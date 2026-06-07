// Skillcheck dashboard logic. Requires a Clerk session: account endpoints are
// called with the Clerk session token; the in-browser preview uses the issued
// chk_ key (the proxy is key-based, not Clerk-based).
import { getClerk, getToken, bindAuthButtons } from './auth.js';

const $ = (id) => document.getElementById(id);
const apiBase = location.origin + '/api';
const state = { fullKey: '', revealed: false, plan: 'free' };

const yearEl = $('year'); if (yearEl) yearEl.textContent = String(new Date().getFullYear());

function withTimeout(promise, ms, code) {
  return Promise.race([
    promise,
    new Promise(function (_, reject) { setTimeout(function () { reject(new Error(code)); }, ms); })
  ]);
}

// --- auth-scoped fetch for the dashboard's own endpoints ---
async function authFetch(path, options = {}) {
  // Minting a Clerk session token requires the browser to reach Clerk's frontend
  // API. With development keys that is a third-party request to *.clerk.accounts.dev,
  // which Brave/Safari/strict-privacy modes can block — leaving getToken() hanging
  // forever. Cap it so we surface an actionable error instead of an endless spinner.
  let token = null;
  try {
    token = await withTimeout(getToken(), 9000, 'SESSION_UNAVAILABLE');
  } catch (e) {
    throw new Error('SESSION_UNAVAILABLE');
  }
  const headers = Object.assign({ accept: 'application/json' }, options.headers || {});
  if (token) headers['authorization'] = 'Bearer ' + token;
  const res = await withTimeout(
    fetch(path, Object.assign({}, options, { headers })),
    20000,
    'REQUEST_TIMEOUT'
  );
  if (res.status === 401) { location.href = '/'; throw new Error('unauthorized'); }
  return res;
}

function copyText(text, done) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
  } else { fallback(text, done); }
}
function fallback(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta); if (done) done();
}
function flash(btn, label) {
  const prev = btn.textContent; btn.textContent = label || 'Copied';
  setTimeout(function () { btn.textContent = prev; }, 1200);
}
function mask(key) { return key && key.length > 15 ? key.slice(0, 11) + '…' + key.slice(-4) : key; }

function renderKey() {
  $('apiKey').textContent = state.revealed ? state.fullKey : mask(state.fullKey);
  $('revealBtn').textContent = state.revealed ? 'Hide' : 'Reveal';
}
function renderCommands() {
  // The hosted URL is baked into the CLI, so users only need their key. Setting
  // SKILLCHECK_TOKEN skips the prompt and goes straight to the file picker.
  $('commandsText').textContent =
    'npm install -g @sx4im/skillcheck\n' +
    'export SKILLCHECK_TOKEN=' + state.fullKey + '\n' +
    'skillcheck';
}
function renderUsage(me) {
  const used = me.runsUsed || 0;
  const limit = me.runsLimit;
  if (limit === null) {
    $('usageCount').textContent = used + ' runs · unlimited';
    $('usageBar').style.width = '12%';
  } else {
    $('usageCount').textContent = used + ' / ' + limit + ' runs';
    const pct = Math.min(100, Math.round((used / limit) * 100));
    $('usageBar').style.width = pct + '%';
    if (used >= limit) $('usageBar').classList.add('full');
  }
}
function renderPlan(me) {
  state.plan = me.plan;
  const badge = $('planBadge');
  if (me.plan === 'pro') {
    badge.textContent = 'Pro'; badge.className = 'badge badge-pro';
    $('proRow').style.display = 'block'; $('upgradeRow').style.display = 'none';
  } else {
    badge.textContent = 'Free'; badge.className = 'badge badge-outline';
    $('proRow').style.display = 'none';
    if (me.billingEnabled) {
      $('upgradeRow').style.display = 'block';
      if ((me.runsUsed || 0) >= (me.runsLimit || 0)) $('upgradeNote').textContent = 'You are out of free runs.';
    } else {
      $('upgradeRow').style.display = 'none';
    }
  }
}
function render(me) {
  $('loading').style.display = 'none';
  $('content').style.display = 'block';
  $('utilEmail').textContent = me.email || 'Skillcheck Cloud';
  state.fullKey = me.apiKey || '';
  renderKey(); renderCommands(); renderUsage(me); renderPlan(me);
}

function showLoadError(message) {
  const loading = $('loading');
  if (loading) {
    loading.style.display = 'block';
    loading.textContent = message;
  }
}

async function loadMe() {
  const res = await authFetch(apiBase + '/me');
  if (!res.ok) {
    let detail = 'HTTP ' + res.status;
    try { const body = await res.json(); if (body && body.error && body.error.message) detail = body.error.message; } catch (e) {}
    showLoadError('Could not load your account: ' + detail + '. Please refresh, or sign out and back in.');
    return;
  }
  const me = await res.json();
  if (!me || !me.apiKey) {
    showLoadError('Your account loaded but no API key was issued. This usually means the server is missing its storage (Upstash) configuration. Please try again shortly.');
    return;
  }
  render(me);
}

async function maybeConfirmUpgrade() {
  const params = new URLSearchParams(location.search);
  if (params.get('upgraded') === '1' && params.get('session_id')) {
    try {
      await authFetch(apiBase + '/billing/confirm?session_id=' + encodeURIComponent(params.get('session_id')), { method: 'POST' });
    } catch (e) { /* ignore */ }
    history.replaceState({}, '', '/app.html');
  }
}

// --- events ---
$('revealBtn').addEventListener('click', function () { state.revealed = !state.revealed; renderKey(); });
$('copyKeyBtn').addEventListener('click', function () { copyText(state.fullKey, function () { flash($('copyKeyBtn')); }); });
$('copyCmd').addEventListener('click', function () { copyText($('commandsText').textContent, function () { flash($('copyCmd')); }); });

$('rotateBtn').addEventListener('click', function () {
  if (!confirm('Rotate your API key? The current key stops working immediately.')) return;
  authFetch(apiBase + '/key/rotate', { method: 'POST' })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.apiKey) { state.fullKey = data.apiKey; state.revealed = true; renderKey(); renderCommands(); }
    });
});

$('upgradeBtn').addEventListener('click', function () {
  $('upgradeBtn').disabled = true;
  authFetch(apiBase + '/billing/checkout', { method: 'POST' })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.url) location.href = data.url;
      else { $('upgradeBtn').disabled = false; $('upgradeNote').textContent = (data.error && data.error.message) || 'Could not start checkout.'; }
    })
    .catch(function () { $('upgradeBtn').disabled = false; });
});

// --- live preview (uses the chk_ key, not the Clerk token) ---
function extractContent(data) {
  const m = data && data.choices && data.choices[0] && data.choices[0].message;
  if (!m) return '';
  return m.content || m.reasoning_content || m.refusal || '';
}
function callModel(messages, runId) {
  const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + state.fullKey };
  // Tag both arms of a preview with the same run id so they meter as ONE run.
  if (runId) headers['x-skillcheck-run'] = runId;
  return fetch(apiBase + '/chat/completions', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ model: 'minimaxai/minimax-m2.7', messages: messages, temperature: 0.7, max_tokens: 1200, stream: false })
  }).then(function (r) {
    return r.text().then(function (text) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + text.slice(0, 200));
      let data; try { data = JSON.parse(text); } catch (e) { throw new Error('Non-JSON response'); }
      return { content: extractContent(data), usage: data.usage || {} };
    });
  });
}
$('runBtn').addEventListener('click', function () {
  const skill = $('skill').value.trim();
  const task = $('task').value.trim();
  const status = $('runStatus');
  if (!skill || !task) { status.className = 'status err'; status.textContent = 'Add both a skill and a task.'; return; }
  const withMessages = [
    { role: 'system', content: 'You are completing an evaluation task. Apply the following skill instructions when relevant.\n\n' + skill },
    { role: 'user', content: task }
  ];
  const noMessages = [{ role: 'user', content: task }];
  $('runBtn').disabled = true;
  status.className = 'status'; status.textContent = 'Running both arms…';
  $('withBody').textContent = ''; $('noBody').textContent = ''; $('overhead').textContent = '';
  const runId = 'preview-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  Promise.all([callModel(withMessages, runId), callModel(noMessages, runId)])
    .then(function (res) {
      $('withBody').textContent = res[0].content || '(empty)';
      $('noBody').textContent = res[1].content || '(empty)';
      const overhead = (res[0].usage.prompt_tokens || 0) - (res[1].usage.prompt_tokens || 0);
      $('overhead').textContent = 'Token cost of injecting the skill: ' + (overhead > 0 ? '+' + overhead : overhead) + ' prompt tokens.';
      status.className = 'status ok'; status.textContent = 'Done.';
    })
    .catch(function (e) { status.className = 'status err'; status.textContent = e.message; })
    .then(function () { $('runBtn').disabled = false; });
});

// Right after a sign-in/sign-up redirect the Clerk handshake can still be
// settling, so clerk.user is briefly null. Wait for it (listener + short poll)
// before deciding the visitor is signed out — otherwise we bounce them to the
// landing page and the key never appears on the first visit.
function waitForUser(clerk, timeoutMs) {
  if (clerk.user) return Promise.resolve(clerk.user);
  return new Promise(function (resolve) {
    let settled = false;
    let unsub = function () {};
    function finish(user) {
      if (settled) return;
      settled = true;
      try { unsub(); } catch (e) {}
      resolve(user || null);
    }
    try { unsub = clerk.addListener(function (res) { if (res && res.user) finish(res.user); }); } catch (e) {}
    const start = Date.now();
    (function tick() {
      if (settled) return;
      if (clerk.user) return finish(clerk.user);
      if (Date.now() - start >= timeoutMs) return finish(null);
      setTimeout(tick, 150);
    })();
  });
}

// --- boot: require a Clerk session, otherwise go back to the landing page ---
(async function () {
  let clerk;
  try { clerk = await getClerk(); } catch (e) { location.href = '/'; return; }
  const user = await waitForUser(clerk, 5000);
  if (!user) { location.href = '/'; return; }
  bindAuthButtons();
  await maybeConfirmUpgrade();
  try {
    await loadMe();
  } catch (e) {
    const code = e && e.message;
    if (code === 'SESSION_UNAVAILABLE') {
      showLoadError(
        'Could not reach the sign-in service to load your session. This usually means a privacy browser is blocking it. ' +
        'In Brave, click the Shields icon and turn Shields OFF for this site (or allow clerk.accounts.dev), then refresh. ' +
        'Chrome and Firefox work without changes.'
      );
    } else if (code === 'REQUEST_TIMEOUT') {
      showLoadError('The request to load your account timed out. Please refresh to try again.');
    } else if (code !== 'unauthorized') {
      showLoadError('Something went wrong loading your account. Please refresh.');
    }
  }
})();
