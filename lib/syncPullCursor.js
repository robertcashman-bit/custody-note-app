'use strict';

/**
 * Whether to advance lastSyncPullAt after a pull cycle.
 * Do not advance if encrypted records were skipped (missing key or decrypt failure) —
 * otherwise those records are never requested again (pull uses since=cursor).
 *
 * Hostile/shell validation rejects must NOT be counted in decryptFailed by the
 * caller — poison rows should be skipped with a metric so later valid pages still
 * advance. rejectedHostile is accepted here for metrics only and does not block.
 */
function shouldAdvanceSyncPullCursor(stats) {
  const decryptFailed = stats.decryptFailed || 0;
  const noMasterKeySkipped = stats.noMasterKeySkipped || 0;
  if (decryptFailed > 0 || noMasterKeySkipped > 0) return false;
  return true;
}

module.exports = { shouldAdvanceSyncPullCursor };
