'use strict';

/**
 * Free-sync quota classification.
 * Tombstones and deletes do not count toward a client-side quota estimate.
 * Edits and deletes of notes the server already has are non-growing pushes.
 */

function isTombstoneRow(row) {
  if (!row) return false;
  if (row.deleted_at || row.deletedAt) return true;
  const reason = row.deletion_reason || row.deletionReason;
  return !!(reason && String(reason).trim());
}

function countTowardFreeQuota(rows) {
  let n = 0;
  const list = Array.isArray(rows) ? rows : [];
  for (let i = 0; i < list.length; i++) {
    if (isTombstoneRow(list[i])) continue;
    n += 1;
  }
  return n;
}

/**
 * A push grows the free quota when it introduces a note the server does not have.
 * Deletes, tombstones, and edits of known cloud notes do not.
 */
function isNonGrowingOutboxItem(input) {
  const item = input || {};
  const op = String(item.operation || '').toLowerCase();
  if (op === 'delete') return true;
  if (item.deletedAt || item.deleted_at) return true;
  if (item.deletionReason || item.deletion_reason) return true;
  const syncId = item.syncId || item.sync_id;
  if (!syncId) return false;
  const known = item.knownCloudSyncIds;
  if (!known) return false;
  if (typeof known.has === 'function') return known.has(String(syncId));
  if (Array.isArray(known)) return known.map(String).indexOf(String(syncId)) !== -1;
  return false;
}

module.exports = {
  isTombstoneRow,
  countTowardFreeQuota,
  isNonGrowingOutboxItem,
};
