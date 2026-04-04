// Replaces all inline event handlers and inline <script> code that was
// in index.html so that 'unsafe-inline' can be removed from script-src CSP.
// Loaded last in the script order so all renderer functions are already defined.
(function () {

  // 1. Authority record-picker close button
  var pickerClose = document.getElementById('authority-record-picker-close');
  if (pickerClose) {
    pickerClose.addEventListener('click', function () { _closeAuthorityRecordPicker(); });
  }

  // 2. Authority fill-modal close button
  var fillClose = document.getElementById('authority-fill-modal-close');
  if (fillClose) {
    fillClose.addEventListener('click', function () { _closeAuthorityFillModal(); });
  }

  // 3. External-link anchors using data-ext-href attribute (help page + help modal)
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-ext-href]');
    if (!el) return;
    e.preventDefault();
    var url = el.getAttribute('data-ext-href');
    if (url && window.api && window.api.openExternal) window.api.openExternal(url);
  });

  // 4. Unregister stale service workers (not used in Electron)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (r) { r.unregister(); });
      if (regs.length) console.log('[SW] Unregistered', regs.length, 'stale service worker(s)');
    });
    if ('caches' in window) {
      caches.keys().then(function (names) {
        names.forEach(function (n) { caches.delete(n); });
        if (names.length) console.log('[SW] Cleared', names.length, 'cache(s)');
      });
    }
  }

  // 5. Fallback: if init() never runs (e.g. script error), hide splash after 9s
  setTimeout(function () {
    var s = document.getElementById('splash');
    if (s && s.parentNode) {
      s.classList.add('fade-out');
      setTimeout(function () { s.remove(); }, 600);
    }
  }, 9000);

  // 6. Admin panel toggle: Ctrl+Shift+A
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && e.key === 'A') {
      e.preventDefault();
      var panel = document.getElementById('admin-licence-panel');
      if (panel) {
        var show = panel.style.display !== 'flex';
        panel.style.display = show ? 'flex' : 'none';
      }
    }
  });

})();
