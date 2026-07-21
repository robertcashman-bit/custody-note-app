/**
 * Compute local licence status from stored licence.dat fields.
 * Shared by main process IPC and unit tests.
 *
 * Tiers:
 * - free: core forever (FREE-* keys, or migrated expired trials)
 * - pro: paid Lemon / CN-* subscription
 * - trial: legacy TRIAL-* (migrated to free on expiry)
 */
const DEFAULT_GRACE_DAYS = 60;
const DEFAULT_TRIAL_DAYS = 30;

function isFreeKey(key) {
  const k = String(key || '').toUpperCase();
  return k.startsWith('FREE-');
}

function isTrialKey(key) {
  const k = String(key || '').toUpperCase();
  return k.startsWith('TRIAL-');
}

function resolveTier(data) {
  if (!data || !data.key) return 'none';
  if (data.tier === 'free' || data.tier === 'pro') return data.tier;
  if (isFreeKey(data.key)) return 'free';
  if (data.isTrial || isTrialKey(data.key)) return 'trial';
  return 'pro';
}

function computeLicenceStatus(data, options) {
  const opts = options || {};
  const graceDays = opts.graceDays != null ? opts.graceDays : DEFAULT_GRACE_DAYS;
  const trialDays = opts.trialDays != null ? opts.trialDays : DEFAULT_TRIAL_DAYS;
  const adminEmails = Array.isArray(opts.adminEmails) ? opts.adminEmails : [];

  const noAddons = { quickfile: false, emailAddon: false };
  if (!data || !data.key) return { status: 'none', message: 'No licence activated', addons: noAddons, tier: 'none' };

  const isAdmin = data.email && adminEmails.includes(String(data.email).toLowerCase());
  const isAddonValid = (exp) => exp && new Date(exp).getTime() > Date.now();
  const addons = {
    quickfile: isAdmin || isAddonValid(data.entitlements?.quickfile?.expiresAt),
    emailAddon: isAdmin || isAddonValid(data.entitlements?.emailAddon?.expiresAt),
  };

  const tier = resolveTier(data);

  if (data.status === 'revoked' || data.status === 'invalid') {
    return { status: 'revoked', message: 'Licence has been revoked. Please enter a new licence key or contact support.', key: data.key, email: data.email, addons, entitlements: data.entitlements || null, tier };
  }
  if (data.status === 'already_used') {
    return {
      status: 'already_used',
      message: data.message || 'Licence is already in use on the maximum number of devices. Deactivate a device in Settings on an activated PC, then try again.',
      key: data.key,
      email: data.email,
      addons,
      entitlements: data.entitlements || null,
      tier,
    };
  }

  const now = Date.now();

  // Free forever: never treat as expired for core use (no expiresAt or ignore expiry).
  if (tier === 'free') {
    const freeResult = {
      status: 'active',
      key: data.key,
      email: data.email || '',
      expiresAt: null,
      activatedAt: data.activatedAt,
      lastValidated: data.lastValidated,
      isTrial: false,
      tier: 'free',
      addons,
      entitlements: data.entitlements || null,
      graceDays,
    };
    return freeResult;
  }

  if (data.expiresAt) {
    const expiryMs = new Date(data.expiresAt).getTime();
    const daysRemaining = Math.ceil((expiryMs - now) / (24 * 60 * 60 * 1000));
    if (expiryMs < now) {
      // Legacy trial expiry → caller should migrate to Free; report expired+isTrial
      // so main.js can convert. Paid Pro expiry still blocks Pro extras.
      return {
        status: 'expired',
        message: tier === 'trial'
          ? 'Your free trial has ended. You can continue on Free forever, or upgrade to Pro for cloud backup.'
          : 'Your Pro subscription expired on ' + new Date(data.expiresAt).toLocaleDateString('en-GB') + '. Renew Pro for cloud backup, or continue on Free forever for core notes.',
        key: data.key,
        email: data.email,
        daysRemaining: 0,
        isTrial: !!data.isTrial || tier === 'trial',
        trialDays,
        addons,
        entitlements: data.entitlements || null,
        tier,
      };
    }
    if (daysRemaining <= 7) {
      return {
        status: 'expiring_soon',
        message: 'Your ' + (tier === 'trial' ? 'trial' : 'Pro subscription') + ' expires in ' + daysRemaining + ' day' + (daysRemaining !== 1 ? 's' : '') + '. ' + (tier === 'trial' ? 'You will keep Free forever access.' : 'Renew Pro to keep cloud backup.'),
        key: data.key,
        email: data.email || '',
        expiresAt: data.expiresAt,
        activatedAt: data.activatedAt,
        lastValidated: data.lastValidated,
        daysRemaining,
        isTrial: !!data.isTrial || tier === 'trial',
        trialDays,
        addons,
        entitlements: data.entitlements || null,
        tier,
        graceDays,
      };
    }
  }

  if (data.lastValidated && tier === 'pro') {
    const sinceLast = now - new Date(data.lastValidated).getTime();
    const graceMs = graceDays * 24 * 60 * 60 * 1000;
    if (sinceLast > graceMs) {
      return {
        status: 'grace_expired',
        message: 'Licence could not be verified for ' + graceDays + ' days. Connect to the internet to verify your subscription — your licence is still active.',
        key: data.key,
        email: data.email,
        graceDays,
        addons,
        entitlements: data.entitlements || null,
        expiresAt: data.expiresAt || null,
        lastValidated: data.lastValidated,
        isTrial: !!data.isTrial,
        tier,
      };
    }
  }

  const result = {
    status: 'active',
    key: data.key,
    email: data.email || '',
    expiresAt: data.expiresAt || null,
    activatedAt: data.activatedAt,
    lastValidated: data.lastValidated,
    isTrial: !!data.isTrial || tier === 'trial',
    trialDays: (tier === 'trial' || data.isTrial) ? trialDays : undefined,
    tier,
    addons,
    entitlements: data.entitlements || null,
    graceDays,
  };
  if (data.expiresAt) {
    result.daysRemaining = Math.ceil((new Date(data.expiresAt).getTime() - now) / (24 * 60 * 60 * 1000));
  }
  return result;
}

module.exports = {
  computeLicenceStatus,
  DEFAULT_GRACE_DAYS,
  DEFAULT_TRIAL_DAYS,
  resolveTier,
  isFreeKey,
  isTrialKey,
};
