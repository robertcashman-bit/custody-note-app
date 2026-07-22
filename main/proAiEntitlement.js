/**
 * Pro AI entitlement helpers (scaffold).
 * Real provider calls must never run without explicit user action + Pro tier.
 */
function isProAiEntitled(licenceStatus) {
  if (!licenceStatus) return false;
  if (licenceStatus.tier === 'pro' && licenceStatus.status === 'active') return true;
  if (licenceStatus.tier === 'pro' && licenceStatus.status === 'expiring_soon') return true;
  if (licenceStatus.tier === 'pro' && licenceStatus.status === 'grace_expired') return true;
  return false;
}

function describeProAiGate(licenceStatus) {
  if (isProAiEntitled(licenceStatus)) {
    return {
      allowed: true,
      reason: 'PRO_AI_ENTITLED',
      message: 'Pro AI drafts are available. Nothing is sent until you explicitly request a draft.',
    };
  }
  return {
    allowed: false,
    reason: 'PRO_AI_NOT_ENTITLED',
    message: 'AI summary drafts are a Pro feature. Upgrade at custodynote.com/pricing.',
  };
}

module.exports = { isProAiEntitled, describeProAiGate };
