'use strict';

/**
 * Pure decision helpers for stale-device sync catch-up.
 *
 * Product policy (Robert): after a long gap, cloud is source of truth.
 * Never auto Keep-local for the whole set. Auto-accept remote only where
 * remote is newer AND this device does not have a true dirty local edit
 * conflict (preserve_local_dirty → human pause with bulk "Use cloud").
 */

const STALE_SYNC_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
/** Patch/build distance that counts as a "large version jump" (e.g. 1.9.18 → 1.9.100). */
const LARGE_VERSION_JUMP_UNITS = 20;

function parseSemver(raw) {
  const s = String(raw || '').trim().replace(/^v/i, '');
  if (!s) return null;
  const m = s.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
}

/**
 * Rough distance between two app versions. Major/minor changes count heavily;
 * same major.minor uses absolute patch delta.
 */
function versionJumpUnits(fromVersion, toVersion) {
  const a = parseSemver(fromVersion);
  const b = parseSemver(toVersion);
  if (!a || !b) return 0;
  if (a.major !== b.major) {
    return Math.abs(b.major - a.major) * 1000 + Math.abs(b.minor - a.minor) * 100 + Math.abs(b.patch - a.patch);
  }
  if (a.minor !== b.minor) {
    return Math.abs(b.minor - a.minor) * 100 + Math.abs(b.patch - a.patch);
  }
  return Math.abs(b.patch - a.patch);
}

function isLargeVersionJump(fromVersion, toVersion) {
  return versionJumpUnits(fromVersion, toVersion) >= LARGE_VERSION_JUMP_UNITS;
}

function parseSyncTimeMs(iso) {
  if (!iso) return null;
  const t = Date.parse(String(iso));
  return Number.isFinite(t) ? t : null;
}

/**
 * Should we run open/upgrade catch-up?
 * Triggers: last successful sync >7 days ago OR large app version jump.
 *
 * @param {{
 *   lastSuccessfulSyncAt?: string|null,
 *   lastSeenAppVersion?: string|null,
 *   currentAppVersion?: string|null,
 *   now?: number,
 *   syncEnabled?: boolean,
 * }} input
 */
function shouldRunStaleCatchUp(input = {}) {
  if (input.syncEnabled === false) {
    return { run: false, reason: 'sync_disabled' };
  }

  const now = input.now != null ? Number(input.now) : Date.now();
  const lastSyncMs = parseSyncTimeMs(input.lastSuccessfulSyncAt);
  const epochLike = !lastSyncMs || input.lastSuccessfulSyncAt === '1970-01-01T00:00:00.000Z';

  if (!epochLike && lastSyncMs != null && (now - lastSyncMs) > STALE_SYNC_MS) {
    return {
      run: true,
      reason: 'stale_sync',
      daysSinceSync: Math.floor((now - lastSyncMs) / (24 * 60 * 60 * 1000)),
    };
  }

  const fromV = input.lastSeenAppVersion || null;
  const toV = input.currentAppVersion || null;
  if (fromV && toV && isLargeVersionJump(fromV, toV)) {
    return {
      run: true,
      reason: 'version_jump',
      fromVersion: fromV,
      toVersion: toV,
      jumpUnits: versionJumpUnits(fromV, toV),
    };
  }

  // First boot after install with no prior version stamp but a very old/missing
  // pull cursor still qualifies as catch-up (never synced successfully).
  if (epochLike && toV) {
    return { run: true, reason: 'never_synced' };
  }

  return { run: false, reason: 'fresh' };
}

function isRemoteNewerConflict(conflict) {
  if (!conflict) return false;
  const localV = Number(conflict.localVersion) || 0;
  const remoteV = Number(conflict.remoteVersion) || 0;
  if (remoteV > localV) return true;
  if (remoteV < localV) return false;
  const localAt = conflict.localUpdatedAt || (conflict.local && conflict.local.updatedAt) || '';
  const remoteAt = conflict.remoteUpdatedAt || (conflict.remote && conflict.remote.updatedAt) || '';
  return !!(remoteAt && localAt && String(remoteAt) > String(localAt));
}

/**
 * Classify one open conflict for stale catch-up.
 * - auto_accept_remote: remote newer, no true local dirty-edit conflict
 * - needs_human: this device has unsynced local edits and cloud also changed
 * - skip: remote not newer (do not auto-clobber)
 */
function classifyCatchUpConflict(conflict) {
  if (!conflict) return { action: 'skip', reason: 'missing' };
  const reason = String(conflict.reason || '');

  // True bidirectional conflict — solicitor must choose (bulk Use cloud OK).
  if (reason === 'preserve_local_dirty') {
    return { action: 'needs_human', reason: 'local_dirty_and_remote_changed' };
  }

  if (!isRemoteNewerConflict(conflict)) {
    return { action: 'skip', reason: 'remote_not_newer' };
  }

  // protect_finalised / remote_newer / revision leftovers with remote newer:
  // cloud is SoT after a long gap — auto accept (caller may pass force).
  const needsForce =
    reason === 'protect_finalised' ||
    conflict.currentLocalStatus === 'finalised' ||
    conflict.currentLocalStatus === 'completed';

  return {
    action: 'auto_accept_remote',
    reason: reason || 'remote_newer',
    force: !!needsForce,
  };
}

/**
 * Partition a conflict list for catch-up / bulk UI.
 */
function partitionConflictsForCatchUp(conflicts) {
  const list = Array.isArray(conflicts) ? conflicts : [];
  const autoAccept = [];
  const needsHuman = [];
  const skipped = [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const cls = classifyCatchUpConflict(c);
    if (cls.action === 'auto_accept_remote') autoAccept.push({ conflict: c, classify: cls });
    else if (cls.action === 'needs_human') needsHuman.push({ conflict: c, classify: cls });
    else skipped.push({ conflict: c, classify: cls });
  }
  return { autoAccept, needsHuman, skipped };
}

module.exports = {
  STALE_SYNC_MS,
  LARGE_VERSION_JUMP_UNITS,
  parseSemver,
  versionJumpUnits,
  isLargeVersionJump,
  shouldRunStaleCatchUp,
  isRemoteNewerConflict,
  classifyCatchUpConflict,
  partitionConflictsForCatchUp,
};
