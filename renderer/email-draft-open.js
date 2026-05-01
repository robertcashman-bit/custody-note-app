/* ═══════════════════════════════════════════════════════════
   Renderer glue for lib/emailComposeDraft.js (exposed as
   window.CustodyEmailCompose from preload). Defines globals used by
   officerEmails.js and email-modal.js.

   Tests without preload: assign window.CustodyEmailCompose from
   require('lib/emailComposeDraft') before loading this file.
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  function ec() {
    var x = global.CustodyEmailCompose;
    if (!x) {
      console.error('[email-draft-open] CustodyEmailCompose unavailable (preload must expose lib/emailComposeDraft)');
    }
    return x;
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

  global.buildMailtoLink = function (d) {
    var lib = ec();
    return lib ? lib.buildMailtoLink(d) : '';
  };

  global.buildOutlookWebComposeLink = function (d) {
    var lib = ec();
    return lib ? lib.buildOutlookWebComposeLink(d) : '';
  };

  global.buildOutlookWebLink = global.buildOutlookWebComposeLink;

  /**
   * @param {object} draft
   * @param {'mailto'|'outlook-web'} [mode]
   */
  global.openEmailDraft = function (draft, mode, envOpt) {
    var lib = ec();
    if (!lib) return false;
    var env = envOpt || { window: global };
    if (typeof mode === 'undefined' && draft && draft.mode) {
      mode = draft.mode;
    }
    return lib.openEmailDraft(draft, mode, env);
  };

  global.resumePendingEmailDraft = function (mode, envOpt) {
    var lib = ec();
    if (!lib) return false;
    var env = envOpt || { window: global };
    return lib.resumePendingEmailDraft(mode, storage(), env);
  };
})(typeof window !== 'undefined' ? window : globalThis);
