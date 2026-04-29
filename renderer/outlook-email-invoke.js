/* ═══════════════════════════════════════════════════════════
   Single renderer entry for OWA compose — window.emailAPI.open only.
   No api.openOutlookEmail, no mailto, no window.open for email.
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  var isSending = false;

  /**
   * @param {{ to?: string, cc?: string, bcc?: string, subject?: string, body?: string }} payload
   * @returns {Promise<unknown>}
   */
  function invokeOutlookWebCompose(payload) {
    if (!global.emailAPI || typeof global.emailAPI.open !== 'function') {
      return Promise.reject(new Error('Email unavailable'));
    }
    /* Resolve with a sentinel so callers never treat an empty resolve() as success (would show false "Opening…" toasts). */
    if (isSending) return Promise.resolve({ ok: false, skipped: true, reason: 'busy' });
    isSending = true;
    return global.emailAPI.open(payload).finally(function () {
      isSending = false;
    });
  }

  global.invokeOutlookWebCompose = invokeOutlookWebCompose;
})(typeof window !== 'undefined' ? window : global);
