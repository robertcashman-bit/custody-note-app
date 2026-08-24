'use strict';

/**
 * Decide whether the credential-free OS lock blanker may offer a dismiss
 * control. Dismiss is only allowed when no real client/case content is
 * (or may be) visible on screen.
 *
 * Conservative: any open attendance, meaningful form data, records list,
 * quick capture client fields, home surfaces with client/case content,
 * open scratchpad text, or officer-email compose fields blocks dismiss.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.SessionBlankerPolicy = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  /**
   * @param {object} state
   * @param {boolean} [state.formViewActive]
   * @param {boolean} [state.hasOpenAttendance]
   * @param {boolean} [state.hasMeaningfulFormData]
   * @param {boolean} [state.formContextBarHasText]
   * @param {boolean} [state.listViewActive]
   * @param {boolean} [state.listHasRows]
   * @param {boolean} [state.quickCaptureViewActive]
   * @param {boolean} [state.quickCaptureHasClientData]
   * @param {boolean} [state.homeViewActive]
   * @param {boolean} [state.homeHasActiveMatters]
   * @param {boolean} [state.homeHasRecentCases]
   * @param {boolean} [state.homeFocusHasClientText]
   * @param {boolean} [state.scratchpadOpenWithText]
   * @param {boolean} [state.officerEmailsViewActive]
   * @param {boolean} [state.officerEmailsHasClientData]
   * @returns {boolean}
   */
  function mayDismissCredentialFreeBlanker(state) {
    var s = state && typeof state === 'object' ? state : {};
    /* Floating scratchpad sits above every view. */
    if (s.scratchpadOpenWithText) return false;
    if (s.formViewActive) {
      if (s.hasOpenAttendance) return false;
      if (s.hasMeaningfulFormData) return false;
      if (s.formContextBarHasText) return false;
    }
    if (s.listViewActive && s.listHasRows) return false;
    if (s.quickCaptureViewActive && s.quickCaptureHasClientData) return false;
    if (s.officerEmailsViewActive && s.officerEmailsHasClientData) return false;
    if (s.homeViewActive) {
      if (s.homeHasActiveMatters) return false;
      if (s.homeHasRecentCases) return false;
      if (s.homeFocusHasClientText) return false;
    }
    return true;
  }

  return {
    mayDismissCredentialFreeBlanker: mayDismissCredentialFreeBlanker,
  };
});
