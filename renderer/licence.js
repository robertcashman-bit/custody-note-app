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
    if (_licenceUIInited) return;
    _licenceUIInited = true;

    // ── Tab switching ──
    var tabSignin = document.getElementById('licence-tab-signin');
    var tabKey = document.getElementById('licence-tab-key');
    var signinForm = document.getElementById('licence-signin-form');
    var registerForm = document.getElementById('licence-register-form');
    var keyForm = document.getElementById('licence-form');
    var forgotSection = document.getElementById('licence-forgot-section');

    function switchTab(tab) {
      if (tab === 'signin') {
        if (tabSignin) { tabSignin.style.color = '#fff'; tabSignin.style.borderBottomColor = '#3b82f6'; }
        if (tabKey) { tabKey.style.color = 'rgba(255,255,255,0.5)'; tabKey.style.borderBottomColor = 'transparent'; }
        if (signinForm) signinForm.style.display = '';
        if (registerForm) registerForm.style.display = 'none';
        if (keyForm) keyForm.style.display = 'none';
        if (forgotSection) forgotSection.style.display = 'none';
      } else {
        if (tabKey) { tabKey.style.color = '#fff'; tabKey.style.borderBottomColor = '#3b82f6'; }
        if (tabSignin) { tabSignin.style.color = 'rgba(255,255,255,0.5)'; tabSignin.style.borderBottomColor = 'transparent'; }
        if (signinForm) signinForm.style.display = 'none';
        if (registerForm) registerForm.style.display = 'none';
        if (keyForm) keyForm.style.display = '';
        if (forgotSection) forgotSection.style.display = '';
      }
    }

    if (tabSignin) tabSignin.addEventListener('click', function () { switchTab('signin'); });
    if (tabKey) tabKey.addEventListener('click', function () { switchTab('key'); });

    // ── Sign-in / register toggle ──
    var toggleRegister = document.getElementById('signin-toggle-register');
    var toggleSignin = document.getElementById('register-toggle-signin');
    if (toggleRegister) toggleRegister.addEventListener('click', function () {
      if (signinForm) signinForm.style.display = 'none';
      if (registerForm) registerForm.style.display = '';
    });
    if (toggleSignin) toggleSignin.addEventListener('click', function () {
      if (registerForm) registerForm.style.display = 'none';
      if (signinForm) signinForm.style.display = '';
    });

    // ── Sign-in handler ──
    var signinBtn = document.getElementById('signin-btn');
    var signinErr = document.getElementById('signin-error');
    if (signinBtn) {
      signinBtn.addEventListener('click', function () {
        var email = (document.getElementById('signin-email')?.value || '').trim();
        var password = document.getElementById('signin-password')?.value || '';
        if (!email || !password) { if (signinErr) { signinErr.textContent = 'Enter email and password.'; signinErr.style.display = ''; } return; }
        signinBtn.disabled = true;
        signinBtn.textContent = 'Signing in\u2026';
        if (signinErr) signinErr.style.display = 'none';
        window.api.authLogin({ email: email, password: password }).then(function (r) {
          signinBtn.disabled = false;
          signinBtn.textContent = 'Sign In';
          if (r && r.success) {
            hideOverlay();
            if (_warningBanner) _warningBanner.remove();
            markReady();
            startRevalidation();
            document.dispatchEvent(new CustomEvent('licence-activated'));
          } else {
            if (signinErr) { signinErr.textContent = r?.error || 'Login failed.'; signinErr.style.display = ''; }
          }
        }).catch(function (e) {
          signinBtn.disabled = false;
          signinBtn.textContent = 'Sign In';
          if (signinErr) { signinErr.textContent = e?.message || 'Login error.'; signinErr.style.display = ''; }
        });
      });
      var signinPw = document.getElementById('signin-password');
      if (signinPw) signinPw.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); signinBtn.click(); } });
    }

    // ── Register handler ──
    var registerBtn = document.getElementById('register-btn');
    var registerErr = document.getElementById('register-error');
    if (registerBtn) {
      registerBtn.addEventListener('click', function () {
        var name = (document.getElementById('register-name')?.value || '').trim();
        var email = (document.getElementById('register-email')?.value || '').trim();
        var password = document.getElementById('register-password')?.value || '';
        if (!email || !password) { if (registerErr) { registerErr.textContent = 'Enter email and password.'; registerErr.style.display = ''; } return; }
        registerBtn.disabled = true;
        registerBtn.textContent = 'Creating account\u2026';
        if (registerErr) registerErr.style.display = 'none';
        window.api.authRegister({ email: email, password: password, name: name }).then(function (r) {
          registerBtn.disabled = false;
          registerBtn.textContent = 'Create Account';
          if (r && r.success) {
            hideOverlay();
            if (_warningBanner) _warningBanner.remove();
            markReady();
            startRevalidation();
            document.dispatchEvent(new CustomEvent('licence-activated'));
          } else {
            if (registerErr) { registerErr.textContent = r?.error || 'Registration failed.'; registerErr.style.display = ''; }
          }
        }).catch(function (e) {
          registerBtn.disabled = false;
          registerBtn.textContent = 'Create Account';
          if (registerErr) { registerErr.textContent = e?.message || 'Registration error.'; registerErr.style.display = ''; }
        });
      });
      var registerPw = document.getElementById('register-password');
      if (registerPw) registerPw.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); registerBtn.click(); } });
    }

    // ── Legacy licence key handler ──
    var activateBtn = document.getElementById('licence-activate-btn');
    if (activateBtn) {
      activateBtn.addEventListener('click', function () {
        var keyInput = document.getElementById('licence-key-input');
        var emailInput = document.getElementById('licence-email-input');
        var rawKey = keyInput ? keyInput.value : '';
        var key = (typeof rawKey === 'string' ? rawKey : '').replace(/\s/g, '').trim().toUpperCase();
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
      var keyInput = document.getElementById('licence-key-input');
      if (keyInput) {
        keyInput.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); activateBtn.click(); }
        });
      }
    }
  }
  window.initLicenceUI = initLicenceUI;
  window.showLicenceOverlay = showOverlay;

  (function initForgotKeyOverlay() {
    var btn = document.getElementById('licence-overlay-forgot-btn');
    var emailInput = document.getElementById('licence-overlay-forgot-email');
    var msgEl = document.getElementById('licence-overlay-forgot-msg');
    if (!btn || !emailInput) return;
    btn.addEventListener('click', function () {
      var email = (emailInput.value || '').trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (msgEl) { msgEl.textContent = 'Please enter a valid email address.'; msgEl.style.color = '#f87171'; }
        return;
      }
      btn.disabled = true;
      if (msgEl) { msgEl.textContent = 'Sending\u2026'; msgEl.style.color = 'rgba(255,255,255,0.6)'; }
      var api = window.custodyNote || {};
      if (!api.requestLicenceEmail) {
        if (msgEl) { msgEl.textContent = 'Not available in this version.'; msgEl.style.color = '#f87171'; }
        btn.disabled = false;
        return;
      }
      api.requestLicenceEmail(email).then(function (res) {
        btn.disabled = false;
        if (msgEl) {
          msgEl.textContent = (res && res.message) ? res.message : 'If that email is on file, your key has been sent.';
          msgEl.style.color = '#4ade80';
        }
      }).catch(function () {
        btn.disabled = false;
        if (msgEl) { msgEl.textContent = 'Something went wrong. Try again later.'; msgEl.style.color = '#f87171'; }
      });
    });
  })();

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
