'use strict';

/**
 * Derive autosave header/footer copy for the open note from local durability +
 * per-record central acknowledgement (sync_dirty + outbox), without conflating
 * with global footer sync chips.
 *
 * Dual-export: Node tests (module.exports) and renderer <script> (window).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.OpenNoteCentralSyncIndicator = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {

  /**
   * @param {{
   *   dirty?: boolean,
   *   durable?: boolean,
   *   syncDirty?: boolean,
   *   queuePending?: boolean,
   *   savedSyncVersion?: number|null,
   *   currentSyncVersion?: number|null,
   * }} input
   * @returns {{ centralConfirmed: boolean, pendingSync: boolean }}
   */
  function deriveOpenNoteCentralSyncState(input) {
    if (input && input.dirty) {
      return { centralConfirmed: false, pendingSync: false };
    }
    if (!input || input.durable === false) {
      return { centralConfirmed: false, pendingSync: false };
    }

    const syncDirty = !!(input.syncDirty);
    const queuePending = !!(input.queuePending);
    const savedVer = input.savedSyncVersion != null ? Number(input.savedSyncVersion) : null;
    const curVer = input.currentSyncVersion != null ? Number(input.currentSyncVersion) : null;

    // Stale ack guard: only treat central as confirmed when the DB row version
    // matches the revision we last durably saved in this editor session.
    if (savedVer != null && curVer != null && savedVer !== curVer) {
      return { centralConfirmed: false, pendingSync: true };
    }

    const centralConfirmed = !syncDirty && !queuePending;
    const pendingSync = !centralConfirmed && (syncDirty || queuePending);
    return { centralConfirmed, pendingSync };
  }

  return {
    deriveOpenNoteCentralSyncState,
  };
});
