/* Minimal globals for Officer Emails dev diagnostics (pending-draft storage only).
   Template merge uses window.CustodyEmailCompose from preload. v1.6.21: Outlook /
   mailto launch paths were removed; openEmailDraft / OWA URL builders are not
   exposed on window. */
(function (global) {
  'use strict';

  function ec() {
    return global.CustodyEmailCompose;
  }

  function storage() {
    try {
      return global.localStorage;
    } catch (e) {
      return null;
    }
  }

  global.savePendingEmailDraft = function (draft) {
    var lib = ec();
    if (!lib) return;
    return lib.savePendingEmailDraft(draft, storage());
  };

  global.getPendingEmailDraft = function () {
    var lib = ec();
    if (!lib) return null;
    return lib.getPendingEmailDraft(storage());
  };

  global.clearPendingEmailDraft = function () {
    var lib = ec();
    if (!lib) return;
    return lib.clearPendingEmailDraft(storage());
  };
})(typeof window !== 'undefined' ? window : globalThis);
