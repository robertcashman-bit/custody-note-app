/**
 * Microsoft Store rating prompt (MSIX / Store build only).
 */
(function (root) {
  'use strict';

  var SETTINGS_NEVER = 'msStoreRatingNeverAsk';
  var SETTINGS_COUNT = 'msStoreRatingPromptCount';
  var SETTINGS_SNOOZE = 'msStoreRatingSnoozeUntil';

  var _visible = false;
  var _bannerEl = null;
  var _openingStore = false;

  function parseCount(raw) {
    var n = parseInt(String(raw == null ? '' : raw).trim(), 10);
    return isFinite(n) && n >= 0 ? n : 0;
  }

  function hideBanner() {
    if (_bannerEl) {
      try { _bannerEl.remove(); } catch (_) {}
      _bannerEl = null;
    }
    _visible = false;
  }

  function persistSettings(patch) {
    if (!window.api || !window.api.setSettings) return Promise.resolve();
    return window.api.setSettings(patch).catch(function (e) {
      console.warn('[ms-store-rating] settings save failed:', e && e.message);
    });
  }

  function readEligibility(moment) {
    if (!window.api || !window.api.msStoreRatingEligibility) {
      return Promise.resolve({ eligible: false, reason: 'no_api' });
    }
    return window.api.msStoreRatingEligibility({ moment: moment || {} });
  }

  function showBanner() {
    if (_visible || _bannerEl) return;
    _visible = true;
    var el = document.createElement('div');
    el.className = 'licence-warning-banner ms-store-rating-banner';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Microsoft Store rating');
    el.innerHTML =
      '<span class="licence-warning-icon" aria-hidden="true">&#9733;</span>' +
      '<span class="ms-store-rating-text">If Custody Note helps at the station, a quick rating on the Microsoft Store helps other reps find it.</span>' +
      '<span class="ms-store-rating-actions">' +
      '<button type="button" class="btn btn-secondary btn-sm ms-store-rating-rate">Rate on Microsoft Store</button>' +
      '<button type="button" class="btn btn-secondary btn-sm ms-store-rating-later">Maybe later</button>' +
      '<button type="button" class="btn btn-secondary btn-sm ms-store-rating-never">No thanks</button>' +
      '</span>';
    var header = document.querySelector('.app-header');
    if (header) header.insertAdjacentElement('afterend', el);
    else document.body.insertBefore(el, document.body.firstChild);
    _bannerEl = el;

    el.querySelector('.ms-store-rating-rate').addEventListener('click', onRate);
    el.querySelector('.ms-store-rating-later').addEventListener('click', onLater);
    el.querySelector('.ms-store-rating-never').addEventListener('click', onNever);
  }

  function onRate() {
    if (_openingStore) return;
    _openingStore = true;
    hideBanner();
    var prev = parseCount(window.__cnMsStoreRatingPromptCount);
    var next = prev + 1;
    window.__cnMsStoreRatingPromptCount = next;
    var patch = {};
    patch[SETTINGS_COUNT] = String(next);
    patch[SETTINGS_NEVER] = 'true';
    persistSettings(patch).then(function () {
      if (window.api && window.api.openExternal) {
        return window.api.openExternal('ms-windows-store://review/?ProductId=9NFSRVT3T45V');
      }
    }).finally(function () {
      _openingStore = false;
    });
  }

  function onLater() {
    hideBanner();
    var prev = parseCount(window.__cnMsStoreRatingPromptCount);
    var next = prev + 1;
    window.__cnMsStoreRatingPromptCount = next;
    var patch = {};
    patch[SETTINGS_COUNT] = String(next);
    if (window.api && window.api.msStoreRatingSnoozeUntil) {
      return window.api.msStoreRatingSnoozeUntil().then(function (iso) {
        patch[SETTINGS_SNOOZE] = iso || '';
        return persistSettings(patch);
      });
    }
    return persistSettings(patch);
  }

  function onNever() {
    hideBanner();
    var patch = {};
    patch[SETTINGS_NEVER] = 'true';
    persistSettings(patch);
  }

  function mergeMoment(override) {
    var base = {
      calmUiMoment: true,
      onRecordsList: false,
      onActiveNoteForm: !!document.body.classList.contains('form-active'),
      saveInProgress: !!window.__cnMsStoreRatingSaveBusy,
      syncInProgress: !!window.__cnMsStoreRatingSyncBusy,
      startupSyncSettling: !!window.__cnMsStoreRatingStartupBusy,
    };
    if (override && typeof override === 'object') {
      Object.keys(override).forEach(function (k) {
        base[k] = override[k];
      });
    }
    return base;
  }

  function maybeShowAfterReturnToList(momentOverride) {
    if (_visible) return;
    setTimeout(function () {
      if (_visible) return;
      var moment = mergeMoment(momentOverride);
      readEligibility(moment).then(function (res) {
        if (res && res.eligible) showBanner();
      }).catch(function () {});
    }, 600);
  }

  root.MsStoreRatingPrompt = {
    maybeShowAfterReturnToList: maybeShowAfterReturnToList,
    hide: hideBanner,
    _test: {
      mergeMoment: mergeMoment,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
