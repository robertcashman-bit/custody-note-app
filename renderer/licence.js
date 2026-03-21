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
    var renewSec = document.getElementById('licence-renew-section');
    if (title) title.textContent = opts.title || 'Sign in to Custody Note';
    if (msg) msg.textContent = opts.message || 'Enter your email to get started.';
    if (err) { err.style.display = 'none'; err.textContent = ''; }
    if (renewSec) renewSec.style.display = opts.showRenew ? '' : 'none';
    var emailForm = document.getElementById('licence-signin-form');
    var codeForm = document.getElementById('licence-code-form');
    var keyForm = document.getElementById('licence-form');
    if (emailForm) emailForm.style.display = '';
    if (codeForm) codeForm.style.display = 'none';
    if (keyForm) keyForm.style.display = 'none';
    _pendingEmail = '';
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
  var _pendingEmail = '';
  var _resendCooldown = null;

  function initLicenceUI() {
    if (_licenceUIInited) return;
    _licenceUIInited = true;

    var tabSignin = document.getElementById('licence-tab-signin');
    var tabKey = document.getElementById('licence-tab-key');
    var emailForm = document.getElementById('licence-signin-form');
    var codeForm = document.getElementById('licence-code-form');
    var keyForm = document.getElementById('licence-form');

    function switchTab(tab) {
      if (tab === 'signin') {
        if (tabSignin) { tabSignin.style.color = '#fff'; tabSignin.style.borderBottomColor = '#3b82f6'; }
        if (tabKey) { tabKey.style.color = 'rgba(255,255,255,0.5)'; tabKey.style.borderBottomColor = 'transparent'; }
        if (emailForm && !_pendingEmail) emailForm.style.display = '';
        if (codeForm) codeForm.style.display = _pendingEmail ? '' : 'none';
        if (keyForm) keyForm.style.display = 'none';
      } else {
        if (tabKey) { tabKey.style.color = '#fff'; tabKey.style.borderBottomColor = '#3b82f6'; }
        if (tabSignin) { tabSignin.style.color = 'rgba(255,255,255,0.5)'; tabSignin.style.borderBottomColor = 'transparent'; }
        if (emailForm) emailForm.style.display = 'none';
        if (codeForm) codeForm.style.display = 'none';
        if (keyForm) keyForm.style.display = '';
      }
    }

    if (tabSignin) tabSignin.addEventListener('click', function () { switchTab('signin'); });
    if (tabKey) tabKey.addEventListener('click', function () { switchTab('key'); });

    function showStep2(email) {
      _pendingEmail = email;
      if (emailForm) emailForm.style.display = 'none';
      if (codeForm) codeForm.style.display = '';
      var sentEl = document.getElementById('code-sent-email');
      if (sentEl) sentEl.textContent = email;
      var codeInput = document.getElementById('verify-code-input');
      if (codeInput) { codeInput.value = ''; codeInput.focus(); }
      var codeErr = document.getElementById('verify-code-error');
      if (codeErr) codeErr.style.display = 'none';
      startResendCooldown();
    }

    function showStep1() {
      _pendingEmail = '';
      if (codeForm) codeForm.style.display = 'none';
      if (emailForm) emailForm.style.display = '';
      var emailInput = document.getElementById('signin-email');
      if (emailInput) emailInput.focus();
    }

    function startResendCooldown() {
      var resendBtn = document.getElementById('resend-code-btn');
      if (!resendBtn) return;
      resendBtn.disabled = true;
      var remaining = 60;
      resendBtn.textContent = 'Send again (' + remaining + 's)';
      if (_resendCooldown) clearInterval(_resendCooldown);
      _resendCooldown = setInterval(function () {
        remaining--;
        if (remaining <= 0) {
          clearInterval(_resendCooldown);
          _resendCooldown = null;
          resendBtn.disabled = false;
          resendBtn.textContent = 'Send again';
        } else {
          resendBtn.textContent = 'Send again (' + remaining + 's)';
        }
      }, 1000);
    }

    // ── Send code handler ──
    var sendCodeBtn = document.getElementById('send-code-btn');
    var signinErr = document.getElementById('signin-error');

    if (sendCodeBtn) {
      sendCodeBtn.addEventListener('click', function () {
        var email = (document.getElementById('signin-email')?.value || '').trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          if (signinErr) { signinErr.textContent = 'Enter a valid email address.'; signinErr.style.display = ''; }
          return;
        }
        sendCodeBtn.disabled = true;
        sendCodeBtn.textContent = 'Sending\u2026';
        if (signinErr) signinErr.style.display = 'none';
        window.api.authSendCode({ email: email }).then(function (r) {
          sendCodeBtn.disabled = false;
          sendCodeBtn.textContent = 'Send Code';
          if (r && r.ok) {
            showStep2(email);
          } else {
            if (signinErr) { signinErr.textContent = r?.error || 'Failed to send code.'; signinErr.style.display = ''; }
          }
        }).catch(function (e) {
          sendCodeBtn.disabled = false;
          sendCodeBtn.textContent = 'Send Code';
          if (signinErr) { signinErr.textContent = e?.message || 'Failed to send code.'; signinErr.style.display = ''; }
        });
      });
      var emailInput = document.getElementById('signin-email');
      if (emailInput) emailInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); sendCodeBtn.click(); } });
    }

    // ── Verify code handler ──
    var verifyBtn = document.getElementById('verify-code-btn');
    var codeErr = document.getElementById('verify-code-error');

    if (verifyBtn) {
      verifyBtn.addEventListener('click', function () {
        var code = (document.getElementById('verify-code-input')?.value || '').trim();
        if (!code || !/^\d{6}$/.test(code)) {
          if (codeErr) { codeErr.textContent = 'Enter the 6-digit code from your email.'; codeErr.style.display = ''; }
          return;
        }
        verifyBtn.disabled = true;
        verifyBtn.textContent = 'Verifying\u2026';
        if (codeErr) codeErr.style.display = 'none';
        window.api.authVerifyCode({ email: _pendingEmail, code: code }).then(function (r) {
          verifyBtn.disabled = false;
          verifyBtn.textContent = 'Verify';
          if (r && r.success) {
            hideOverlay();
            if (_warningBanner) _warningBanner.remove();
            markReady();
            startRevalidation();
            document.dispatchEvent(new CustomEvent('licence-activated'));
          } else {
            if (codeErr) { codeErr.textContent = r?.error || 'Verification failed.'; codeErr.style.display = ''; }
          }
        }).catch(function (e) {
          verifyBtn.disabled = false;
          verifyBtn.textContent = 'Verify';
          if (codeErr) { codeErr.textContent = e?.message || 'Verification error.'; codeErr.style.display = ''; }
        });
      });
      var codeInput = document.getElementById('verify-code-input');
      if (codeInput) codeInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); verifyBtn.click(); } });
    }

    // ── Resend code ──
    var resendBtn = document.getElementById('resend-code-btn');
    if (resendBtn) {
      resendBtn.addEventListener('click', function () {
        if (!_pendingEmail) return;
        resendBtn.disabled = true;
        window.api.authSendCode({ email: _pendingEmail }).then(function (r) {
          if (r && r.ok) {
            startResendCooldown();
            if (codeErr) { codeErr.textContent = 'New code sent.'; codeErr.style.display = ''; codeErr.style.color = '#4ade80'; }
            setTimeout(function () { if (codeErr) { codeErr.style.display = 'none'; codeErr.style.color = ''; } }, 3000);
          } else {
            resendBtn.disabled = false;
            if (codeErr) { codeErr.textContent = r?.error || 'Failed to resend.'; codeErr.style.display = ''; }
          }
        }).catch(function () {
          resendBtn.disabled = false;
        });
      });
    }

    // ── Change email ──
    var changeEmailBtn = document.getElementById('change-email-btn');
    if (changeEmailBtn) {
      changeEmailBtn.addEventListener('click', function () { showStep1(); });
    }

    // ── Licence key handler ──
    var activateBtn = document.getElementById('licence-activate-btn');
    if (activateBtn) {
      activateBtn.addEventListener('click', function () {
        var keyEl = document.getElementById('licence-key-input');
        var emailEl = document.getElementById('licence-email-input');
        var rawKey = keyEl ? keyEl.value : '';
        var key = (typeof rawKey === 'string' ? rawKey : '').replace(/\s/g, '').trim().toUpperCase();
        var email = (emailEl ? emailEl.value : '').trim();
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
      var licKeyInput = document.getElementById('licence-key-input');
      if (licKeyInput) {
        licKeyInput.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); activateBtn.click(); }
        });
      }
    }
  }
  window.initLicenceUI = initLicenceUI;
  window.showLicenceOverlay = showOverlay;

  window.openLicenceOverlaySignIn = function () {
    showOverlay({
      title: 'Sign in to Custody Note',
      message: 'Enter your email to get started, or use the Licence Key tab.',
    });
    var tab = document.getElementById('licence-tab-signin');
    if (tab) tab.click();
    initLicenceUI();
  };

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
            ? 'Your ' + (status.trialDays || 30) + '-day free trial has ended. Sign in with your email to continue.'
            : (status.message || 'Your subscription has expired. Sign in or renew to continue.'),
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
