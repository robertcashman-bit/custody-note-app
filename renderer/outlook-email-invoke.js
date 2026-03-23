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
    if (isSending) return Promise.resolve();
    isSending = true;
    return global.emailAPI.open(payload).finally(function () {
      isSending = false;
    });
  }

  global.invokeOutlookWebCompose = invokeOutlookWebCompose;
})(typeof window !== 'undefined' ? window : global);
