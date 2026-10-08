'use strict';

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.HomeOnboarding = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global, function () {
  function isFreeBetaLicence(st) {
    if (!st || !st.key) return false;
    if (st.tier === 'free' || st.isFree) return true;
    return String(st.key).toUpperCase().indexOf('FREE-') === 0;
  }

  function isSignedInFreeSyncAccount(st) {
    if (!st || !st.signInWithAccount || !st.key) return false;
    if (!(st.tier === 'free' || st.isFree)) return false;
    var keyStr = String(st.key || '').toUpperCase();
    if (!keyStr || keyStr.indexOf('FREE-') === 0 || keyStr.indexOf('TRIAL-') === 0 || keyStr.indexOf('ACCOUNT-') === 0) {
      return false;
    }
    if (st.status === 'revoked' || st.status === 'expired' || st.status === 'error') return false;
    return true;
  }

  function hasValidatedCloudLicence(st) {
    if (!st || !st.key) return false;
    // Signed-in free sync is cloud-capable (real server key) but not Pro.
    if (isSignedInFreeSyncAccount(st)) return true;
    var keyStr = String(st.key || '');
    if (keyStr.indexOf('TRIAL-') === 0 || keyStr.indexOf('FREE-') === 0 || keyStr.indexOf('ACCOUNT-') === 0) {
      return false;
    }
    if (st.isTrial || st.tier === 'trial' || st.tier === 'free' || st.isFree) return false;
    if (st.status === 'revoked' || st.status === 'expired' || st.status === 'error') return false;
    return st.status === 'active' || st.status === 'expiring_soon' || st.status === 'grace_expired';
  }

  function shouldShowFreeSyncSignInPrompt(st, dismissed) {
    if (dismissed) return false;
    if (!isFreeBetaLicence(st)) return false;
    if (st.signInWithAccount || isSignedInFreeSyncAccount(st)) return false;
    return true;
  }

  function shouldShowFreeBetaHomeCard(packaged, st) {
    return !!packaged && isFreeBetaLicence(st);
  }

  function shouldShowLicenceActivationHomeCard(packaged, st) {
    if (!packaged || !st) return false;
    if (isFreeBetaLicence(st)) return false;
    return !hasValidatedCloudLicence(st);
  }

  function shouldAutoShowWelcomeWizard(settings) {
    var s = settings && typeof settings === 'object' ? settings : {};
    if (s.welcomeWizardDoneAt) return false;
    if (s.feeEarnerNameDefault) return false;
    return true;
  }

  function shouldShowHomeInviteCard(state) {
    var st = state && typeof state === 'object' ? state : {};
    if (st.dismissed) return false;
    return !!st.milestone;
  }

  function buildReferralInviteUrl(code, baseUrl) {
    var base = baseUrl || 'https://custodynote.com';
    var c = String(code || '').trim();
    if (!c) return base.replace(/\/$/, '') + '/download';
    return base.replace(/\/$/, '') + '/r/' + encodeURIComponent(c);
  }

  return {
    isFreeBetaLicence,
    isSignedInFreeSyncAccount,
    hasValidatedCloudLicence,
    shouldShowFreeSyncSignInPrompt,
    shouldShowFreeBetaHomeCard,
    shouldShowLicenceActivationHomeCard,
    shouldAutoShowWelcomeWizard,
    shouldShowHomeInviteCard,
    buildReferralInviteUrl,
  };
});
