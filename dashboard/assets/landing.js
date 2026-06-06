// Landing-page helpers: copy buttons + footer year.
(function () {
  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
    } else {
      fallback(text, done);
    }
  }
  function fallback(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta); if (done) done();
  }

  document.querySelectorAll('.copy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var host = document.getElementById(btn.getAttribute('data-copy'));
      if (!host) return;
      var text = host.childNodes[0] ? host.childNodes[0].textContent : host.textContent;
      copyText(text.trim(), function () {
        var prev = btn.textContent; btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = prev; }, 1200);
      });
    });
  });
})();
