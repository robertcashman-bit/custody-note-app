'use strict';

/**
 * Auto-resolve open sync_conflicts using field-merge rules (no user prompt).
 * Runs on startup and after successful pulls — not gated on stale catch-up triggers.
 */

const { listOpenConflicts } = require('./syncConflicts');
const {
  autoAcceptRemoteNewerConflicts,
  getSetting,
  setSetting,
} = require('./staleSyncCatchUpRunner');

const SETTINGS_LEGACY_OPEN_CONFLICTS_MIGRATED = 'legacyOpenConflictsAutoMergeV1';

/**
 * @param {object} ctx  same shape as stale catch-up (dbGet, dbRun, dbAll, afterResolve?, saveDb?)
 * @param {object} [opts]  { source?: string }
 */
function resolveOpenSyncConflictsIfAny(ctx, opts) {
  const options = opts || {};
  const openBefore = listOpenConflicts(ctx).length;
  if (!openBefore) {
    return { ran: false, merged: 0, accepted: 0, remainingOpen: 0, source: options.source || null };
  }

  const res = autoAcceptRemoteNewerConflicts(ctx);
  const merged = res.merged || res.accepted || 0;

  if (merged > 0 && typeof ctx.saveDb === 'function') {
    try { ctx.saveDb(); } catch (_) {}
  }

  if (!getSetting(ctx.dbGet, SETTINGS_LEGACY_OPEN_CONFLICTS_MIGRATED)) {
    setSetting(ctx.dbRun, SETTINGS_LEGACY_OPEN_CONFLICTS_MIGRATED, new Date().toISOString());
  }

  return Object.assign({ ran: true, source: options.source || null }, res);
}

module.exports = {
  SETTINGS_LEGACY_OPEN_CONFLICTS_MIGRATED,
  resolveOpenSyncConflictsIfAny,
};
