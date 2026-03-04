/* ═══════════════════════════════════════════════
   LICENCE / SUBSCRIPTION GATE
   Checks licence status on startup and blocks the
   app behind an activation overlay if invalid.
   Auto-starts a free trial for new installs.
   Shows a warning banner 7 days before expiry.
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
    var form = document.getElementById('licence-form');
    var renewSec = document.getElementById('licence-renew-section');
    if (title) title.textContent = opts.title || 'Activate Custody Note';
    if (msg) msg.textContent = opts.message || 'Enter your licence key to activate the application.';
    if (err) { err.style.display = 'none'; err.textContent = ''; }
    if (form) form.style.display = '';
    if (renewSec) renewSec.style.display = opts.showRenew ? '' : 'none';
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
    var urgency = daysRemaining <= 2 ? ' licence-warning-critical' : '';
    if (urgency) _warningBanner.classList.add('licence-warning-critical');
    _warningBanner.innerHTML = '<span class="licence-warning-icon">&#9888;</span> <span>' + esc(message) + '</span> <button type="button" class="licence-warning-dismiss" title="Dismiss">&times;</button>';
    _warningBanner.querySelector('.licence-warning-dismiss').addEventListener('click', function () {
      _warningBanner.style.display = 'none';
    });
    var header = document.querySelector('.app-header');
    if (header) header.insertAdjacentElement('afterend', _warningBanner);
  }

  var _licenceUIInited = false;
  function initLicenceUI() {
    var activateBtn = document.getElementById('licence-activate-btn');
    if (!activateBtn) return;
    if (_licenceUIInited) return;
    _licenceUIInited = true;
    activateBtn.addEventListener('click', function () {
      var keyInput = document.getElementById('licence-key-input');
      var emailInput = document.getElementById('licence-email-input');
      var key = (keyInput ? keyInput.value : '').trim();
      var email = (emailInput ? emailInput.value : '').trim();
      if (!key) { showError('Please enter a licence key.'); return; }
      activateBtn.disabled = true;
      activateBtn.textContent = 'Activating...';
      window.api.licenceActivate({ key: key, email: email }).then(function (result) {
        activateBtn.disabled = false;
        activateBtn.textContent = 'Activate';
        if (result && result.success) {
          hideOverlay();
          if (_warningBanner) _warningBanner.remove();
          markReady();
          startRevalidation();
        } else {
          showError(result && result.message ? result.message : 'Activation failed. Check your key and try again.');
        }
      }).catch(function (e) {
        activateBtn.disabled = false;
        activateBtn.textContent = 'Activate';
        showError('Error: ' + (e && e.message ? e.message : 'Unknown error'));
      });
    });
    var keyInput = document.getElementById('licence-key-input');
    if (keyInput) {
      keyInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          activateBtn.click();
        }
      });
    }
  }
  window.initLicenceUI = initLicenceUI;
  window.showLicenceOverlay = showOverlay;

  function startRevalidation() {
    if (_revalidateTimer) clearInterval(_revalidateTimer);
    _revalidateTimer = setInterval(function () {
      if (!window.api || !window.api.licenceValidate) return;
      window.api.licenceValidate().then(function (result) {
        if (result && result.valid === false) {
          var st = result.status || {};
          showOverlay({
            title: st.status === 'revoked' ? 'Licence Revoked' : 'Subscription Expired',
            message: st.message || 'Your subscription is no longer valid.',
            showRenew: true,
          });
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

      if (status.status === 'expired' || status.status === 'grace_expired' || status.status === 'revoked') {
        var isTrial = status.isTrial;
        showOverlay({
          title: isTrial ? 'Free Trial Ended' : (status.status === 'revoked' ? 'Licence Revoked' : 'Subscription Expired'),
          message: isTrial
            ? 'Your ' + (status.trialDays || 30) + '-day free trial has ended. Enter a licence key to continue using Custody Note.'
            : (status.message || 'Your subscription has expired. Please renew or enter a new key.'),
          showRenew: true,
        });
        initLicenceUI();
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
