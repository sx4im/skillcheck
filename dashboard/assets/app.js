// Skillcheck dashboard logic: load account, show key + usage + commands, rotate,
// upgrade, and an in-browser with/without-skill preview.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var apiBase = location.origin + '/api';
  var state = { fullKey: '', revealed: false, plan: 'free' };

  var y = $('year'); if (y) y.textContent = String(new Date().getFullYear());

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
    } else { fallback(text, done); }
  }
  function fallback(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta); if (done) done();
  }
  function flash(btn, label) {
    var prev = btn.textContent; btn.textContent = label || 'Copied';
    setTimeout(function () { btn.textContent = prev; }, 1200);
  }
  function mask(key) {
    return key && key.length > 15 ? key.slice(0, 11) + '…' + key.slice(-4) : key;
  }

  function renderKey() {
    $('apiKey').textContent = state.revealed ? state.fullKey : mask(state.fullKey);
    $('revealBtn').textContent = state.revealed ? 'Hide' : 'Reveal';
  }

  function renderCommands() {
    var text =
      'npm install -g @sx4im/skillcheck\n' +
      'export SKILLCHECK_API_URL=' + apiBase + '\n' +
      'export SKILLCHECK_TOKEN=' + state.fullKey + '\n' +
      'skillcheck check ./SKILL.md';
    $('commandsText').textContent = text;
  }

  function renderUsage(me) {
    var used = me.runsUsed || 0;
    var limit = me.runsLimit; // null => unlimited
    if (limit === null) {
      $('usageCount').textContent = used + ' runs · unlimited';
      $('usageBar').style.width = '12%';
    } else {
      $('usageCount').textContent = used + ' / ' + limit + ' runs';
      var pct = Math.min(100, Math.round((used / limit) * 100));
      var bar = $('usageBar');
      bar.style.width = pct + '%';
      if (used >= limit) bar.classList.add('full');
    }
  }

  function renderPlan(me) {
    state.plan = me.plan;
    var badge = $('planBadge');
    if (me.plan === 'pro') {
      badge.textContent = 'Pro';
      badge.className = 'badge badge-pro';
      $('proRow').style.display = 'block';
      $('upgradeRow').style.display = 'none';
    } else {
      badge.textContent = 'Free';
      badge.className = 'badge badge-outline';
      $('proRow').style.display = 'none';
      if (me.billingEnabled) {
        $('upgradeRow').style.display = 'block';
        if ((me.runsUsed || 0) >= (me.runsLimit || 0)) {
          $('upgradeNote').textContent = 'You are out of free runs.';
        }
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
    renderKey();
    renderCommands();
    renderUsage(me);
    renderPlan(me);
  }

  function loadMe() {
    return fetch(apiBase + '/me', { headers: { accept: 'application/json' } })
      .then(function (r) {
        if (r.status === 401) { location.href = '/'; return null; }
        return r.json();
      })
      .then(function (me) { if (me) render(me); });
  }

  // --- Upgrade confirmation on return from Stripe ---
  function maybeConfirmUpgrade() {
    var params = new URLSearchParams(location.search);
    if (params.get('upgraded') === '1' && params.get('session_id')) {
      return fetch(apiBase + '/billing/confirm?session_id=' + encodeURIComponent(params.get('session_id')), { method: 'POST' })
        .then(function () {})
        .catch(function () {})
        .then(function () { history.replaceState({}, '', '/app.html'); });
    }
    return Promise.resolve();
  }

  // --- Events ---
  $('revealBtn').addEventListener('click', function () { state.revealed = !state.revealed; renderKey(); });
  $('copyKeyBtn').addEventListener('click', function () { copyText(state.fullKey, function () { flash($('copyKeyBtn')); }); });
  $('copyCmd').addEventListener('click', function () { copyText($('commandsText').textContent, function () { flash($('copyCmd')); }); });

  $('rotateBtn').addEventListener('click', function () {
    if (!confirm('Rotate your API key? The current key stops working immediately.')) return;
    fetch(apiBase + '/key/rotate', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.apiKey) { state.fullKey = data.apiKey; state.revealed = true; renderKey(); renderCommands(); }
      });
  });

  $('upgradeBtn').addEventListener('click', function () {
    $('upgradeBtn').disabled = true;
    fetch(apiBase + '/billing/checkout', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.url) location.href = data.url;
        else { $('upgradeBtn').disabled = false; $('upgradeNote').textContent = (data.error && data.error.message) || 'Could not start checkout.'; }
      })
      .catch(function () { $('upgradeBtn').disabled = false; });
  });

  // --- Live preview ---
  function extractContent(data) {
    var m = data && data.choices && data.choices[0] && data.choices[0].message;
    if (!m) return '';
    return m.content || m.reasoning_content || m.refusal || '';
  }
  function callModel(messages) {
    return fetch(apiBase + '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + state.fullKey },
      body: JSON.stringify({ model: 'qwen/qwen3-next-80b-a3b-instruct', messages: messages, temperature: 0.7, max_tokens: 1200, stream: false })
    }).then(function (r) {
      return r.text().then(function (text) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + text.slice(0, 200));
        var data; try { data = JSON.parse(text); } catch (e) { throw new Error('Non-JSON response'); }
        return { content: extractContent(data), usage: data.usage || {} };
      });
    });
  }
  $('runBtn').addEventListener('click', function () {
    var skill = $('skill').value.trim();
    var task = $('task').value.trim();
    var status = $('runStatus');
    if (!skill || !task) { status.className = 'status err'; status.textContent = 'Add both a skill and a task.'; return; }
    var withMessages = [
      { role: 'system', content: 'You are completing an evaluation task. Apply the following skill instructions when relevant.\n\n' + skill },
      { role: 'user', content: task }
    ];
    var noMessages = [{ role: 'user', content: task }];
    $('runBtn').disabled = true;
    status.className = 'status'; status.textContent = 'Running both arms…';
    $('withBody').textContent = ''; $('noBody').textContent = ''; $('overhead').textContent = '';
    Promise.all([callModel(withMessages), callModel(noMessages)])
      .then(function (res) {
        $('withBody').textContent = res[0].content || '(empty)';
        $('noBody').textContent = res[1].content || '(empty)';
        var overhead = (res[0].usage.prompt_tokens || 0) - (res[1].usage.prompt_tokens || 0);
        $('overhead').textContent = 'Token cost of injecting the skill: ' + (overhead > 0 ? '+' + overhead : overhead) + ' prompt tokens.';
        status.className = 'status ok'; status.textContent = 'Done.';
      })
      .catch(function (e) { status.className = 'status err'; status.textContent = e.message; })
      .then(function () { $('runBtn').disabled = false; });
  });

  maybeConfirmUpgrade().then(loadMe);
})();
