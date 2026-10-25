'use strict';

/**
 * Detect when custodynote.com account sync routes are not deployed yet (404/HTML
 * error pages). Used for graceful degradation — local secrets must never be
 * cleared when the server simply lacks the route.
 */

function isAccountSyncEndpointMissingError(errOrMessage) {
  const msg = String(
    (errOrMessage && errOrMessage.message) ? errOrMessage.message : (errOrMessage || '')
  ).trim();
  if (!msg) return false;
  return (
    /\b404\b/.test(msg)
    || /not found/i.test(msg)
    || /cannot (post|get) /i.test(msg)
    || /unexpected token/i.test(msg)
    || /endpoint.*not.*available/i.test(msg)
  );
}

const OPENAI_SYNC_NOT_LIVE_USER_MESSAGE =
  'Cross-computer OpenAI key sync is not available on the server yet. '
  + 'Enter your key on this computer — it stays on this device until custodynote.com is updated, '
  + 'then it will sync to your other signed-in machines.';

const QUICKFILE_CRED_SYNC_NOT_LIVE_USER_MESSAGE =
  'Cross-computer QuickFile credential sync is not available on the server yet. '
  + 'Enter QuickFile details on this computer — they stay here until custodynote.com is updated.';

module.exports = {
  isAccountSyncEndpointMissingError,
  OPENAI_SYNC_NOT_LIVE_USER_MESSAGE,
  QUICKFILE_CRED_SYNC_NOT_LIVE_USER_MESSAGE,
};
