'use strict';

const { normalizeLicenceKeyForSync } = require('./licenceKeyNormalize');
const { isSyntheticLocalLicenceKey } = require('../main/licenceAdminEmails');

/**
 * Full enqueue + pull/merge only when this computer is receiving a server key
 * it did not already sync with. Re-signing the same Pro key must not re-upload
 * every note.
 */
function shouldRunFirstSignInMerge(previousKey, nextKey) {
  const prev = normalizeLicenceKeyForSync(previousKey);
  const next = normalizeLicenceKeyForSync(nextKey);
  if (!prev || isSyntheticLocalLicenceKey(prev)) return true;
  if (prev !== next) return true;
  return false;
}


/**
 * First time a computer gets a real server key (magic-link sign-in, or a
 * licence pasted over a local FREE-/TRIAL- key).
 *
 * Order is fixed:
 *   1. Canonical master key (download escrow, or upload ours; re-key locally
 *      when the escrow key differs — same path as Pro, no row deletes)
 *   2. If this computer already has notes: enqueue every local attendance,
 *      pull/merge, then push
 *   3. If the database is empty: full re-sync from cloud (escrow + pull)
 *
 * Empty or smaller cloud must never delete or overwrite local-only rows.
 * Callers pass that guarantee in via pullAndMerge / fullResyncFromCloud.
 */

async function bootstrapSyncAfterSignIn(deps) {
  const countRaw = await deps.countLocalAttendances();
  const localCount = Number(countRaw) || 0;
  const canonical = await deps.ensureCanonicalSyncKey();
  if (localCount > 0) {
    const enqueued = await deps.enqueueAllLocalAttendances();
    const pull = await deps.pullAndMerge();
    await deps.pushPending();
    return {
      ok: true,
      mode: 'merge_existing_local',
      localCount: localCount,
      enqueued: enqueued,
      canonical: canonical,
      pull: pull,
      wipedLocal: false,
    };
  }
  const full = await deps.fullResyncFromCloud();
  return {
    ok: true,
    mode: 'full_resync_empty',
    localCount: 0,
    canonical: canonical,
    full: full,
    wipedLocal: false,
  };
}

module.exports = { bootstrapSyncAfterSignIn, shouldRunFirstSignInMerge };
