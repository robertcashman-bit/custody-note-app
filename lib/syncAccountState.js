'use strict';

/**
 * Shared sync-account rules for the main process and the renderer.
 * Dual-export: Node (module.exports) and the window script (window.SyncAccountState).
 *
 * DEVICE_REVOKED and FREE_QUOTA_EXCEEDED must never be treated as a reason
 * to drop queued attendance notes. Synthetic FREE-/TRIAL- keys are local-only.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.SyncAccountState = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global, function () {
  var DEVICE_DEACTIVATED_MESSAGE =
    'This computer was deactivated for sync — re-enter your key or sign in again to restore.';
  var ADMIN_DEVICE_REVOKED_MESSAGE =
    "This computer's sync access was revoked by the administrator";
  var LOCAL_ONLY_CHIP = 'Local only — sign in to sync';
  var FREE_QUOTA_MESSAGE =
    'Free sync limit reached — your notes stay on this computer. Nothing was deleted.';
  var FREE_SYNC_SIGNIN_LABEL = 'Sign in with email to sync your computers';

  function isSyntheticLocalLicenceKey(key) {
    var k = String(key || '').toUpperCase();
    return k.indexOf('FREE-') === 0 || k.indexOf('TRIAL-') === 0;
  }

  function statusCodeOf(err) {
    if (!err) return 0;
    var raw = err.statusCode != null ? err.statusCode : err.status;
    var n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  function bodyOf(err) {
    if (!err || !err.body || typeof err.body !== 'object') return null;
    return err.body;
  }

  function isDeviceRevokedHttpError(err) {
    if (statusCodeOf(err) !== 403) return false;
    var body = bodyOf(err);
    var code = String((err && (err.bodyCode || (body && body.code))) || '').toUpperCase();
    if (code === 'DEVICE_REVOKED') return true;
    var msg = String((err && err.message) || '');
    if (/device_revoked/i.test(msg)) return true;
    if (/this device has been revoked/i.test(msg)) return true;
    if (body && /this device has been revoked/i.test(String(body.error || body.message || ''))) return true;
    return false;
  }

  function isFreeQuotaHttpError(err) {
    var status = statusCodeOf(err);
    if (status !== 409 && status !== 413) return false;
    var body = bodyOf(err);
    var code = String((err && (err.bodyCode || (body && body.code))) || '').toUpperCase();
    if (code === 'FREE_QUOTA_EXCEEDED') return true;
    var msg = String((err && err.message) || '');
    if (/free_quota_exceeded/i.test(msg)) return true;
    if (body && /free_quota_exceeded/i.test(String(body.error || body.message || ''))) return true;
    return false;
  }

  function revokedByAdmin(source) {
    if (!source || typeof source !== 'object') return false;
    var by = source.deviceRevokedBy || (source.body && source.body.deviceRevokedBy) || '';
    by = String(by).toLowerCase();
    return by === 'admin' || by === 'administrator';
  }

  function deviceRevokedUserMessage(source) {
    if (revokedByAdmin(source)) return ADMIN_DEVICE_REVOKED_MESSAGE;
    return DEVICE_DEACTIVATED_MESSAGE;
  }

  function subscriptionIsFreeSync(subscription) {
    if (!subscription || typeof subscription !== 'object') return false;
    var tier = String(subscription.tier || '').toLowerCase();
    var plan = String(subscription.plan || '').toLowerCase();
    return tier === 'free' || plan === 'free_sync';
  }

  /**
   * Magic-link poll: a free_sync account must stay tier "free" so resolveTier
   * does not treat the server key as Pro. Managed cloud backup stays off.
   */
  function applyFreeSyncSubscription(data, subscription) {
    if (!data || !subscriptionIsFreeSync(subscription)) return { applied: false };
    data.tier = 'free';
    data.isFree = true;
    data.isTrial = false;
    data.cloudBackup = false;
    data.entitlements = null;
    return { applied: true };
  }

  return {
    DEVICE_DEACTIVATED_MESSAGE: DEVICE_DEACTIVATED_MESSAGE,
    ADMIN_DEVICE_REVOKED_MESSAGE: ADMIN_DEVICE_REVOKED_MESSAGE,
    LOCAL_ONLY_CHIP: LOCAL_ONLY_CHIP,
    FREE_QUOTA_MESSAGE: FREE_QUOTA_MESSAGE,
    FREE_SYNC_SIGNIN_LABEL: FREE_SYNC_SIGNIN_LABEL,
    isSyntheticLocalLicenceKey: isSyntheticLocalLicenceKey,
    isDeviceRevokedHttpError: isDeviceRevokedHttpError,
    isFreeQuotaHttpError: isFreeQuotaHttpError,
    revokedByAdmin: revokedByAdmin,
    deviceRevokedUserMessage: deviceRevokedUserMessage,
    subscriptionIsFreeSync: subscriptionIsFreeSync,
    applyFreeSyncSubscription: applyFreeSyncSubscription,
  };
});
