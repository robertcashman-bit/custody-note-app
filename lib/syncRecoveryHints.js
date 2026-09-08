/**
 * Pure helpers for sync / empty-DB recovery UX.
 * Kept free of Electron so unit tests can pin the incident heuristics.
 */

/** Live DB larger than this with zero attendances is almost never a fresh install. */
const EMPTY_LARGE_DB_BYTES = 512 * 1024;

/**
 * Windows incident class: encrypted attendances.db is multi-MB but Home shows
 * "No records yet". Surface a recover path instead of looking like a blank install.
 */
function detectEmptyLargeDb({ dbFileBytes, activeAttendanceCount } = {}) {
  const bytes = Number(dbFileBytes) || 0;
  const count = Number(activeAttendanceCount) || 0;
  return bytes >= EMPTY_LARGE_DB_BYTES && count === 0;
}

/**
 * Local machine has records and nothing pending, but a full cloud pull
 * (since=epoch) received 0 remote rows. Incremental pulls also report
 * received=0 when there are no deltas — that is healthy steady state and
 * must not be treated as an empty cloud.
 *
 * Other devices stay empty until this machine re-uploads (raw DB file-swap
 * and "already synced" local state do not push).
 */
function detectLocalFullCloudEmpty({
  totalRecords,
  pendingChanges,
  dirtyPushCount,
  lastPullReceived,
  pullEverCompleted,
  pulledFromEpoch,
} = {}) {
  const total = Number(totalRecords) || 0;
  const pending = Number(pendingChanges) || 0;
  const dirty = Number(dirtyPushCount) || 0;
  const received = Number(lastPullReceived) || 0;
  if (total <= 0) return false;
  if (pending > 0 || dirty > 0) return false;
  if (!pullEverCompleted) return false;
  if (!pulledFromEpoch) return false;
  return received === 0;
}

module.exports = {
  EMPTY_LARGE_DB_BYTES,
  detectEmptyLargeDb,
  detectLocalFullCloudEmpty,
};
