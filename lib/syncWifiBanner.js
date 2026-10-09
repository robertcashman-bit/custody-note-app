'use strict';

/**
 * "Police station Wi-Fi" sync warning: a slim amber bar under the top bar,
 * plus the Save & Sync tooltip while sync is pending.
 *
 * Shown only when sync has been pending for longer than PENDING_THRESHOLD_MS,
 * or a sync attempt failed with a network error. Never shown for licence/auth
 * failures, revoked devices, the free quota, rate limiting, or local-only
 * (FREE-/TRIAL-) keys that never sync. Hidden again as soon as sync succeeds.
 *
 * Dual-export: Node tests (module.exports) and renderer <script> (window.SyncWifiBanner).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.SyncWifiBanner = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global, function () {
  var BOLD = 'Saved on this computer.';
  var BODY = "Police station Wi-Fi often blocks sync. Your notes will sync once you're on your own Wi-Fi or a phone hotspot.";
  var TEXT = BOLD + ' ' + BODY;
  var PENDING_THRESHOLD_MS = 60000;
  var DISMISS_STORAGE_KEY = 'cn_wifi_sync_banner_dismissed';

  var NETWORK_ERROR_RE = /network|timed? ?out|etimedout|econnrefused|econnreset|enotfound|eai_again|enetunreach|ehostunreach|socket hang up|fetch failed|getaddrinfo|unreachable|offline|aborted|certificate|self[- ]signed|unable to verify|ssl|tls|proxy|err_internet|err_name_not_resolved|err_connection/i;
  var LICENCE_ERROR_RE = /invalid licen[cs]e|licen[cs]e key is required|device_not_activated|device_revoked|free_quota_exceeded/i;

  function isSyntheticLocalKey(key) {
    var k = String(key || '').toUpperCase();
    return k.indexOf('FREE-') === 0 || k.indexOf('TRIAL-') === 0;
  }

  function skipReason(st) {
    return String((st && st.lastSyncSkipReason) || '').toLowerCase();
  }

  /**
   * True when this computer is not meant to sync right now for a reason that is
   * NOT the network (so the Wi-Fi advice would be wrong).
   */
  function isSyncBlockedForNonNetworkReason(st, licence) {
    if (licence) {
      if (isSyntheticLocalKey(licence.key)) return true;
      if (licence.deviceRevoked) return true;
    }
    if (!st) return false;
    if (st.enabled === false) return true;
    if (isSyntheticLocalKey(st.key)) return true;
    var reason = skipReason(st);
    var status = String(st.status || '').toLowerCase();
    var conn = String(st.connectivity || '').toLowerCase();
    if (st.localOnly || conn === 'local_only' || reason === 'local_only' || status === 'local_only') return true;
    if (st.authRequired || conn === 'auth_required' || reason === 'auth_required' || st.syncPhase === 'auth_required') return true;
    if (st.deviceRevoked || conn === 'device_revoked' || reason === 'device_revoked' || status === 'device_revoked') return true;
    if (reason === 'device_not_activated' || status === 'device_not_activated') return true;
    if (st.freeQuotaExceeded || reason === 'free_quota_exceeded' || status === 'free_quota_exceeded') return true;
    if (st.rateLimited || reason === 'rate_limited' || status === 'rate_limited') return true;
    if (LICENCE_ERROR_RE.test(String(st.lastError || ''))) return true;
    return false;
  }

  /** A sync attempt failed because the network/API could not be reached. */
  function isNetworkSyncFailure(st) {
    if (!st) return false;
    if (isSyncBlockedForNonNetworkReason(st, null)) return false;
    var reason = skipReason(st);
    if (reason === 'offline' || reason === 'api_unreachable') return true;
    if (String(st.connectivity || '').toLowerCase() === 'offline') return true;
    if (st.status !== 'error') return false;
    if (reason === 'in_progress' || reason.indexOf('heal') === 0) return false;
    return NETWORK_ERROR_RE.test(String(st.lastError || ''));
  }

  /** A sync-status event that means the cloud round trip actually succeeded. */
  function isSyncSuccessEvent(st) {
    if (!st || st.status !== 'synced') return false;
    var reason = skipReason(st);
    return !reason || reason.indexOf('ok') === 0;
  }

  function pendingCountOf(st) {
    if (!st) return 0;
    if (st.pendingCaseCount != null) return Number(st.pendingCaseCount) || 0;
    if (st.health && st.health.pendingCaseCount != null) return Number(st.health.pendingCaseCount) || 0;
    return Math.max(Number(st.pendingChanges) || 0, Number(st.dirtyPushCount) || 0);
  }

  /**
   * Small state machine with an injectable clock so the show/hide rules are testable.
   * @param {{ now?: function(): number, dismissed?: boolean, thresholdMs?: number }} [opts]
   */
  function createController(opts) {
    opts = opts || {};
    var now = typeof opts.now === 'function' ? opts.now : function () { return Date.now(); };
    var threshold = opts.thresholdMs != null ? Number(opts.thresholdMs) : PENDING_THRESHOLD_MS;
    var s = {
      notePending: false,
      accountPending: false,
      pendingSince: null,
      networkFailure: false,
      account: null,
      licence: null,
      dismissed: !!opts.dismissed,
    };

    function touchPending() {
      var pending = s.notePending || s.accountPending;
      if (pending && s.pendingSince == null) s.pendingSince = now();
      if (!pending) s.pendingSince = null;
    }

    function blocked() {
      return isSyncBlockedForNonNetworkReason(s.account, s.licence);
    }

    return {
      /** Open note's Save & Sync state is "pending". */
      setNotePending: function (b) { s.notePending = !!b; touchPending(); },
      /** Full sync snapshot (counts + connectivity). */
      setAccountSnapshot: function (st) {
        s.account = st || null;
        s.accountPending = pendingCountOf(st) > 0;
        if (st && isNetworkSyncFailure(st)) s.networkFailure = true;
        touchPending();
      },
      setLicence: function (lic) { s.licence = lic || null; },
      /** Incremental sync-status-changed event from the sync worker. */
      noteSyncEvent: function (ev) {
        if (!ev) return;
        if (isSyncSuccessEvent(ev)) {
          s.networkFailure = false;
          s.notePending = false;
          s.accountPending = false;
          touchPending();
          return;
        }
        if (isNetworkSyncFailure(ev)) s.networkFailure = true;
        if (isSyncBlockedForNonNetworkReason(ev, null)) {
          s.account = Object.assign({}, s.account || {}, ev);
          s.networkFailure = false;
        }
      },
      setDismissed: function (b) { s.dismissed = !!b; },
      isDismissed: function () { return s.dismissed; },
      /** @returns {{ show: boolean, reason: string|null, msUntilShow: number|null }} */
      evaluate: function () {
        if (blocked()) return { show: false, reason: 'blocked', msUntilShow: null };
        var visibleReason = null;
        if (s.networkFailure) visibleReason = 'network';
        else if (s.pendingSince != null && now() - s.pendingSince >= threshold) visibleReason = 'pending';
        if (visibleReason) {
          if (s.dismissed) return { show: false, reason: 'dismissed', msUntilShow: null };
          return { show: true, reason: visibleReason, msUntilShow: null };
        }
        var wait = s.pendingSince != null ? Math.max(0, threshold - (now() - s.pendingSince)) : null;
        return { show: false, reason: null, msUntilShow: s.dismissed ? null : wait };
      },
      _state: function () { return Object.assign({}, s); },
    };
  }

  return {
    BOLD: BOLD,
    BODY: BODY,
    TEXT: TEXT,
    PENDING_THRESHOLD_MS: PENDING_THRESHOLD_MS,
    DISMISS_STORAGE_KEY: DISMISS_STORAGE_KEY,
    isSyntheticLocalKey: isSyntheticLocalKey,
    isSyncBlockedForNonNetworkReason: isSyncBlockedForNonNetworkReason,
    isNetworkSyncFailure: isNetworkSyncFailure,
    isSyncSuccessEvent: isSyncSuccessEvent,
    pendingCountOf: pendingCountOf,
    createController: createController,
  };
});
