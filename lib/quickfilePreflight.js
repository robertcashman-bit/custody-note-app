'use strict';

/**
 * Pre-flight checks before Send Bill to QuickFile (pure, testable).
 */

function runQuickFileSendPreflight(ctx) {
  const c = ctx || {};
  const errors = [];

  if (c.settingsMissing && c.settingsMissing.length) {
    errors.push('QuickFile is not configured — missing: ' + c.settingsMissing.join(', ') + '.');
  }
  if (c.settingsPullFailed) {
    errors.push('Could not refresh QuickFile settings from your account. Check internet and try again.');
  }
  if (c.pingRequired && !c.pingOk) {
    errors.push(c.pingError || 'QuickFile connection check failed. Use Settings → Test connection.');
  }
  const firm = String(c.firmName || '').trim();
  if (!firm) {
    errors.push('Select the instructing firm on this record before sending.');
  }
  const total = Number(c.billableTotal);
  /* Linking an existing invoice has no local total to check. */
  if (!c.skipTotalCheck && (!Number.isFinite(total) || total <= 0)) {
    errors.push('Invoice total must be greater than zero before sending.');
  }
  if (c.lineItemCount != null && Number(c.lineItemCount) < 1) {
    errors.push('Add at least one billable line before sending.');
  }
  if (c.vatRate != null) {
    const vr = Number(c.vatRate);
    if (!Number.isFinite(vr) || vr < 0 || vr > 1) {
      errors.push('VAT rate must be between 0% and 100% (enter as a decimal, e.g. 0.2 for 20%).');
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

module.exports = {
  runQuickFileSendPreflight,
};
