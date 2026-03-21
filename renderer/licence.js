/* ═══════════════════════════════════════════════
   LICENCE / SUBSCRIPTION GATE
   Single licence-key activation with persistent
   device token. Non-blocking banner for expiry.
   ═══════════════════════════════════════════════ */
(function () {
  'use strict';

  var REVALIDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
  var _licenceChecked = false;
  var _revalidateTimer = null;
  var _warningBanner = null;

  window.__licenceReady = false;
  window.__licenceCallbacks = [];

  function onLicenceReady(cb) {
    if (window.__licenceReady) cb();
    else window.__licenceCallbacks.push(cb);
  }
  window.onLicenceReady = onLicenceReady;

  function markReady() {
    window.__licenceReady = true;
    window.__licenceCallbacks.forEach(function (cb) { try { cb(); } catch (_) {} });
    window.__licenceCallbacks = [];
  }

  function showOverlay(opts) {
    var overlay = document.getElementById('licence-overlay');
    if (!overlay) return;
    overlay.style.display = '';
    var title = document.getElementById('licence-title');
    var msg = document.getElementById('licence-message');
    var err = document.getElementById('licence-error');
    var renewSec = document.getElementById('licence-renew-section');
    if (title) title.textContent = opts.title || 'Activate Custody Note';
    if (msg) msg.textContent = opts.message || 'Paste the licence key from your purchase email.';
    if (err) { err.style.display = 'none'; err.textContent = ''; }
    if (renewSec) renewSec.style.display = opts.showRenew ? '' : 'none';
    var keyInput = document.getElementById('licence-key-input');
    if (keyInput) keyInput.focus();
  }

  function hideOverlay() {
    var overlay = document.getElementById('licence-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  function showError(text) {
    var err = document.getElementById('licence-error');
    if (err) { err.textContent = text; err.style.display = ''; }
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function showWarningBanner(message, daysRemaining) {
    if (_warningBanner) { try { _warningBanner.remove(); } catch (_) {} }
    _warningBanner = document.createElement('div');
    _warningBanner.className = 'licence-warning-banner';
    if (daysRemaining <= 2) _warningBanner.classList.add('licence-warning-critical');
    _warningBanner.innerHTML = '<span class="licence-warning-icon">&#9888;</span> <span>' + esc(message) + '</span> <button type="button" class="licence-warning-dismiss" title="Dismiss">&times;</button>';
    _warningBanner.querySelector('.licence-warning-dismiss').addEventListener('click', function () {
      _warningBanner.style.display = 'none';
    });
    var header = document.querySelector('.app-header');
    if (header) header.insertAdjacentElement('afterend', _warningBanner);
  }

  function showExpiryBanner(message) {
    if (_warningBanner) { try { _warningBanner.remove(); } catch (_) {} }
    _warningBanner = document.createElement('div');
    _warningBanner.className = 'licence-warning-banner licence-warning-critical';
    _warningBanner.innerHTML =
      '<span class="licence-warning-icon">&#9888;</span> <span>' + esc(message) + '</span> ' +
      '<a href="https://www.custodynote.com/pricing" target="_blank" rel="noopener" style="color:#fbbf24;text-decoration:underline;margin-left:0.5rem;font-weight:600;">Renew</a>' +
      ' <button type="button" class="licence-warning-dismiss" title="Dismiss" style="margin-left:0.5rem;">&times;</button>';
    _warningBanner.querySelector('.licence-warning-dismiss').addEventListener('click', function () {
      _warningBanner.style.display = 'none';
    });
    var header = document.querySelector('.app-header');
    if (header) header.insertAdjacentElement('afterend', _warningBanner);
  }

  var _licenceUIInited = false;

  function initLicenceUI() {
    if (_licenceUIInited) return;
    _licenceUIInited = true;

    /* ── Licence key activation ── */
    var activateBtn = document.getElementById('licence-activate-btn');
    if (activateBtn) {
      activateBtn.addEventListener('click', function () {
        var keyEl = document.getElementById('licence-key-input');
        var rawKey = keyEl ? keyEl.value : '';
        var key = (typeof rawKey === 'string' ? rawKey : '').replace(/\s/g, '').trim().toUpperCase();
        if (!key) { showError('Please paste your licence key.'); return; }
        activateBtn.disabled = true;
        activateBtn.textContent = 'Activating\u2026';
        window.api.licenceActivate({ key: key }).then(function (result) {
          activateBtn.disabled = false;
          activateBtn.textContent = 'Activate';
          if (result && result.success) {
            hideOverlay();
            if (_warningBanner) _warningBanner.remove();
            markReady();
            startRevalidation();
            document.dispatchEvent(new CustomEvent('licence-activated'));
          } else {
            showError(result && result.message ? result.message : 'Activation failed. Check your key and try again.');
          }
        }).catch(function (e) {
          activateBtn.disabled = false;
          activateBtn.textContent = 'Activate';
          showError('Error: ' + (e && e.message ? e.message : 'Unknown error'));
        });
      });
      var licKeyInput = document.getElementById('licence-key-input');
      if (licKeyInput) {
        licKeyInput.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); activateBtn.click(); }
        });
      }
    }

    /* ── Email my key fallback ── */
    var emailKeyBtn = document.getElementById('email-key-btn');
    if (emailKeyBtn) {
      emailKeyBtn.addEventListener('click', function () {
        var emailInput = document.getElementById('email-key-email');
        var email = (emailInput ? emailInput.value : '').trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          var statusEl = document.getElementById('email-key-status');
          if (statusEl) { statusEl.textContent = 'Enter a valid email address.'; statusEl.style.color = '#f87171'; statusEl.style.display = ''; }
          return;
        }
        emailKeyBtn.disabled = true;
        emailKeyBtn.textContent = 'Sending\u2026';
        window.api.licenceEmailKey({ email: email }).then(function (r) {
          emailKeyBtn.disabled = false;
          emailKeyBtn.textContent = 'Email my key';
          var statusEl = document.getElementById('email-key-status');
          if (statusEl) {
            statusEl.textContent = r && r.message ? r.message : 'If an account exists, we\'ve sent your key.';
            statusEl.style.color = '#4ade80';
            statusEl.style.display = '';
          }
        }).catch(function () {
          emailKeyBtn.disabled = false;
          emailKeyBtn.textContent = 'Email my key';
        });
      });
    }
  }
  window.initLicenceUI = initLicenceUI;
  window.showLicenceOverlay = showOverlay;

  window.openLicenceOverlaySignIn = function () {
    showOverlay({
      title: 'Activate Custody Note',
      message: 'Paste the licence key from your purchase email.',
    });
    initLicenceUI();
  };

  function startRevalidation() {
    if (_revalidateTimer) clearInterval(_revalidateTimer);
    _revalidateTimer = setInterval(function () {
      if (!window.api || !window.api.licenceValidate) return;
      window.api.licenceValidate().then(function (result) {
        if (result && result.valid === false) {
          var st = result.status || {};
          if (st.status === 'revoked') {
            showOverlay({
              title: 'Licence Revoked',
              message: st.message || 'Your licence has been revoked. Contact support.',
              showRenew: true,
            });
          } else {
            showExpiryBanner(st.message || 'Your subscription has expired. Renew to continue creating new records.');
          }
        }
      }).catch(function () {});
    }, REVALIDATE_INTERVAL_MS);
  }

  function checkLicence() {
    if (_licenceChecked) return;
    _licenceChecked = true;
    if (!window.api || !window.api.licenceStatus) {
      markReady();
      return;
    }
    window.api.licenceStatus().then(function (status) {
      if (!status) { markReady(); return; }

      if (status.status === 'revoked') {
        showOverlay({
          title: 'Licence Revoked',
          message: status.message || 'Your licence has been revoked.',
          showRenew: true,
        });
        initLicenceUI();
        return;
      }

      if (status.status === 'expired' || status.status === 'grace_expired') {
        hideOverlay();
        markReady();
        startRevalidation();
        var isTrial = status.isTrial;
        var msg = isTrial
          ? 'Your ' + (status.trialDays || 30) + '-day free trial has ended. Activate with your licence key to continue.'
          : (status.message || 'Your subscription has expired. Renew to keep creating new records.');
        showExpiryBanner(msg);
        window.__licenceExpired = true;
        return;
      }

      if (status.status === 'expiring_soon') {
        hideOverlay();
        markReady();
        startRevalidation();
        showWarningBanner(status.message, status.daysRemaining || 7);
        return;
      }

      hideOverlay();
      markReady();
      if (status.status === 'active') {
        startRevalidation();
        if (status.isTrial && status.daysRemaining != null) {
          var msg = 'Free trial: ' + status.daysRemaining + ' day' + (status.daysRemaining !== 1 ? 's' : '') + ' remaining';
          showWarningBanner(msg, status.daysRemaining);
        }
        if (window.api.licenceValidate) window.api.licenceValidate().catch(function () {});
      }
    }).catch(function () {
      markReady();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkLicence);
  } else {
    checkLicence();
  }
})();
