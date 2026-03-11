/* ═══════════════════════════════════════════════════════════
   TOAST / MODAL SYSTEM  –  replaces all alert() / confirm()
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Toast ── */
  var _toastEl = null;
  var _toastTimer = null;

  function getToastEl() {
    if (!_toastEl) {
      _toastEl = document.createElement('div');
      _toastEl.id = 'cn-toast';
      _toastEl.className = 'cn-toast';
      document.body.appendChild(_toastEl);
    }
    return _toastEl;
  }

  function showToast(message, type, duration) {
    var el = getToastEl();
    el.textContent = message;
    el.className = 'cn-toast cn-toast-visible cn-toast-' + (type || 'info');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () {
      el.className = 'cn-toast';
    }, duration || 3500);
  }

  /* ── Confirm modal ── */
  function showConfirm(message, title) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'cn-confirm-overlay';

      var box = document.createElement('div');
      box.className = 'cn-confirm-box';

      if (title) {
        var h = document.createElement('h3');
        h.className = 'cn-confirm-title';
        h.textContent = title;
        box.appendChild(h);
      }

      var p = document.createElement('p');
      p.className = 'cn-confirm-msg';
      p.style.whiteSpace = 'pre-line';
      p.textContent = message;
      box.appendChild(p);

      var btns = document.createElement('div');
      btns.className = 'cn-confirm-btns';

      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-secondary';
      cancelBtn.textContent = 'Cancel';

      var okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'btn btn-primary';
      okBtn.textContent = 'OK';

      btns.appendChild(cancelBtn);
      btns.appendChild(okBtn);
      box.appendChild(btns);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      function done(result) {
        document.body.removeChild(overlay);
        resolve(result);
      }

      okBtn.addEventListener('click', function () { done(true); });
      cancelBtn.addEventListener('click', function () { done(false); });
      overlay.addEventListener('click', function (e) { if (e.target === overlay) done(false); });
      document.addEventListener('keydown', function esc(e) {
        if (e.key === 'Escape') { document.removeEventListener('keydown', esc); done(false); }
      });
      okBtn.focus();
    });
  }

  /* ── Generic modal ── */
  function showModal(title, html) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'cn-confirm-overlay';

      var box = document.createElement('div');
      box.className = 'cn-confirm-box cn-modal-box';

      var h = document.createElement('h3');
      h.className = 'cn-confirm-title';
      h.textContent = title;
      box.appendChild(h);

      var body = document.createElement('div');
      body.className = 'cn-modal-body';
      body.innerHTML = html;
      box.appendChild(body);

      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'btn btn-secondary';
      closeBtn.textContent = 'Close';
      closeBtn.style.marginTop = '1rem';
      closeBtn.style.width = '100%';
      box.appendChild(closeBtn);

      overlay.appendChild(box);
      document.body.appendChild(overlay);

      function done() {
        document.body.removeChild(overlay);
        resolve();
      }

      closeBtn.addEventListener('click', done);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) done(); });
      document.addEventListener('keydown', function esc(e) {
        if (e.key === 'Escape') { document.removeEventListener('keydown', esc); done(); }
      });
    });
  }

  /* Export to global scope */
  window.showToast = showToast;
  window.showConfirm = showConfirm;
  window.showModal = showModal;
})();
