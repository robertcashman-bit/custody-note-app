/*
 * QuickFile connection state — single source of truth for how the app describes
 * the QuickFile link to the user.
 *
 * Important reality (do not "fix" with OAuth/cookies/localStorage): QuickFile is
 * authenticated per request with Account Number + API Key + Application ID,
 * hashed (MD5) into each call. There is NO OAuth token, refresh token, cookie or
 * redirect URI. Those credentials are stored in the app's LOCAL SQLite settings
 * table, which lives on the individual computer. That is why a correctly
 * configured account can look "not connected" on a different machine: the second
 * machine simply has not had the three credentials entered yet. This module makes
 * that explicit instead of showing a bare "not connected".
 *
 * Pure + dual-export: required by Node tests and loaded as a renderer <script>.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.QuickFileConnectionState = api;
})(this, function () {
  'use strict';

  /**
   * Derive a clear, user-facing connection state from the DB-backed facts.
   * Never returns "not connected" purely from fragile renderer state — it is
   * based on the configured credentials (presence) and the last real API health
   * check result, both of which are persisted server-side (main process / DB).
   *
   * @param {object} facts
   * @param {string[]} [facts.missing]    Names of missing credential fields.
   * @param {object}   [facts.lengths]    { account, apiKey, applicationId } char counts.
   * @param {string}   [facts.lastOkAt]   ISO timestamp of last successful test.
   * @param {string}   [facts.lastError]  Message from the last failed test.
   * @param {string}   [facts.lastCheckedAt] ISO timestamp of last test attempt (ok or fail).
   * @returns {{state:string, ok:boolean, configured:boolean, headline:string, detail:string, instructions:string[], tone:string}}
   */
  function deriveQuickFileConnectionState(facts) {
    var f = facts || {};
    var missing = Array.isArray(f.missing) ? f.missing : [];
    var configured = missing.length === 0;
    var lastOkAt = f.lastOkAt ? String(f.lastOkAt) : '';
    var lastError = f.lastError ? String(f.lastError) : '';
    var lastCheckedAt = f.lastCheckedAt ? String(f.lastCheckedAt) : '';

    var perMachineNote =
      'QuickFile credentials are saved to your Custody Note account and loaded automatically when you bill. ' +
      'Update them here if your QuickFile API details change.';

    // 1. Not configured on this machine.
    if (!configured) {
      return {
        state: 'not_configured',
        ok: false,
        configured: false,
        tone: 'warn',
        headline: 'QuickFile not set up yet',
        detail: 'Missing: ' + missing.join(', ') + '.',
        instructions: [
          'Open QuickFile (quickfile.co.uk) \u2192 Account Settings \u2192 3rd Party Integration \u2192 API.',
          'Copy your Account Number, create/seed an API key, and copy the Application ID.',
          'Paste all three below and click "Save and test QuickFile".',
          perMachineNote,
        ],
      };
    }

    // 2. Configured, last test failed.
    if (lastError) {
      return {
        state: 'error',
        ok: false,
        configured: true,
        tone: 'error',
        headline: 'Last connection test failed',
        detail: lastError + (lastCheckedAt ? ' (checked ' + formatWhen(lastCheckedAt) + ')' : ''),
        instructions: [
          'Double-check the Account Number, API key and Application ID are copied exactly (no spaces).',
          'In QuickFile, confirm the API key is active and the Application ID matches it.',
          'Then click "Test QuickFile connection" again.',
          perMachineNote,
        ],
      };
    }

    // 3. Configured and verified.
    if (lastOkAt) {
      return {
        state: 'connected',
        ok: true,
        configured: true,
        tone: 'ok',
        headline: 'Connected',
        detail: 'Last verified ' + formatWhen(lastOkAt) + '.',
        instructions: [],
      };
    }

    // 4. Configured but never tested.
    return {
      state: 'configured_untested',
      ok: false,
      configured: true,
      tone: 'info',
      headline: 'Credentials saved \u2014 not yet verified',
      detail: 'Click "Test QuickFile connection" to confirm these details work.',
      instructions: [perMachineNote],
    };
  }

  function formatWhen(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    try {
      return d.toLocaleString('en-GB');
    } catch (_) {
      return d.toISOString();
    }
  }

  return {
    deriveQuickFileConnectionState: deriveQuickFileConnectionState,
    formatWhen: formatWhen,
  };
});
