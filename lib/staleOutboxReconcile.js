'use strict';

/**
 * Stale outbox / empty-write reconciliation (pure helpers).
 *
 * Failure class (Robsprgr 1.9.101→1.9.102): cloud already holds every local sync_id
 * (integrity localOnly=0, inventory matches), but push returns ok:true written:0
 * ("Push accepted 0 records (cloud write empty)"). assertPushAccepted refuses,
 * dirty/outbox never clear, footer shows fake "N not confirmed" (often
 * pendingChanges + dirtyPushCount double-count).
 *
 * 1.9.102 miss: Fix sync drain never reached reconcile when oldest pending rows
 * were in thrash backoff (getNextQueueItem LIMIT 20 before due-filter) and
 * forceRetryAll ignored pending backoff. Partial batches with one missing id
 * also blocked whole-batch confirm.
 *
 * Safety rules:
 * - Never confirm on omitted/ambiguous written, hard failures, or rate limits.
 * - Never confirm when cloudEmptyProven or localOnly > 0.
 * - Prefer per-syncId proof (cloudSyncIdSet). Inventory count alone is not enough
 *   to clear a batch that may include local-only rows.
 * - Never wipe attendance rows — only clear sync_dirty / dequeue outbox.
 * - Never auto Keep-local; never default to reuploadAll.
 */

/**
 * True when the server accepted the push but reported a durable write of 0.
 * Distinguishes empty-write from omitted written / partial writes.
 */
function isEmptyWritePushResponse(resp, sentCount) {
  const sent = Number(sentCount) || 0;
  if (sent <= 0) return false;
  if (!resp || resp.ok !== true) return false;
  if (resp.written == null) return false;
  if (Array.isArray(resp.written)) return resp.written.length === 0;
  const n = Number(resp.written);
  return Number.isFinite(n) && n === 0;
}

/**
 * Unique attendance/case ids that still need central confirmation.
 * Dirty flag and queue rows for the same record count as one case.
 */
function countUniquePendingSyncCases({ dirtyRecordIds, queueRecordIds } = {}) {
  const set = new Set();
  const add = (list) => {
    const arr = Array.isArray(list) ? list : [];
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] == null || arr[i] === '') continue;
      set.add(String(arr[i]));
    }
  };
  add(dirtyRecordIds);
  add(queueRecordIds);
  return set.size;
}

/**
 * Build honest pending upload stats for footer / health.
 * pendingUploads = unique cases (not dirty+queue double-count).
 */
function buildPendingUploadStats({
  dirtyCount,
  queuePendingCount,
  uniqueCaseCount,
  dirtyRecordIds,
  queueRecordIds,
} = {}) {
  const dirty = Number(dirtyCount) || 0;
  const queue = Number(queuePendingCount) || 0;
  let unique = uniqueCaseCount;
  if (unique == null) {
    unique = countUniquePendingSyncCases({ dirtyRecordIds, queueRecordIds });
  }
  unique = Number(unique) || 0;
  return {
    dirtyPushCount: dirty,
    queuePendingCount: queue,
    pendingCaseCount: unique,
    pendingUploads: unique,
    doubleCountedSum: dirty + queue,
    wasDoubleCounting: dirty > 0 && queue > 0 && dirty + queue > unique,
  };
}

/**
 * Decide whether written:0 may be treated as "already present in cloud".
 *
 * @param {{
 *   resp?: object,
 *   sentCount?: number,
 *   pushedSyncIds?: string[],
 *   cloudSyncIds?: string[]|null,
 *   localOnly?: number|null,
 *   cloudEmptyProven?: boolean,
 *   cloudInventoryCount?: number|null,
 *   discrepancies?: Array<{code?: string}>,
 * }} input
 */
function shouldConfirmAlreadyPresent(input = {}) {
  const sent = Number(input.sentCount) || 0;
  if (!isEmptyWritePushResponse(input.resp, sent)) {
    return { confirm: false, reason: 'not_empty_write' };
  }
  if (input.cloudEmptyProven) {
    return { confirm: false, reason: 'cloud_empty_proven' };
  }
  const localOnly = input.localOnly == null ? null : Number(input.localOnly);
  if (localOnly != null && localOnly > 0) {
    return { confirm: false, reason: 'local_only_present', localOnly };
  }
  const discrepancies = Array.isArray(input.discrepancies) ? input.discrepancies : [];
  if (discrepancies.some((d) => d && d.code === 'local_present_cloud_empty')) {
    return { confirm: false, reason: 'discrepancy_empty_cloud' };
  }
  if (discrepancies.some((d) => d && d.code === 'local_only_sync_ids')) {
    return { confirm: false, reason: 'discrepancy_local_only' };
  }

  const pushed = (Array.isArray(input.pushedSyncIds) ? input.pushedSyncIds : [])
    .map((id) => (id != null ? String(id).trim() : ''))
    .filter(Boolean);
  if (pushed.length === 0) {
    return { confirm: false, reason: 'no_pushed_sync_ids' };
  }

  const cloudIds = Array.isArray(input.cloudSyncIds) ? input.cloudSyncIds : null;
  if (!cloudIds) {
    // Inventory count alone cannot prove each pushed id is present.
    return { confirm: false, reason: 'cloud_id_set_required' };
  }
  const cloudSet = new Set(cloudIds.map(String));
  if (cloudSet.size === 0) {
    return { confirm: false, reason: 'cloud_id_set_empty' };
  }

  const missing = pushed.filter((id) => !cloudSet.has(id));
  if (missing.length > 0) {
    return {
      confirm: false,
      reason: 'pushed_ids_not_in_cloud',
      missingCount: missing.length,
      missingSample: missing.slice(0, 5),
    };
  }

  const inventory =
    input.cloudInventoryCount == null ? null : Number(input.cloudInventoryCount);
  if (inventory != null && Number.isFinite(inventory) && inventory <= 0) {
    return { confirm: false, reason: 'inventory_empty' };
  }

  return {
    confirm: true,
    reason: 'already_present_in_cloud',
    confirmedCount: pushed.length,
  };
}

/**
 * Ack meta that mayClearOutboxEntry accepts for already-present clears.
 */
function ackMetaForAlreadyPresent(sentCount) {
  return {
    confirmed: true,
    ambiguous: false,
    alreadyPresentInCloud: true,
    integrityClean: true,
    written: Number(sentCount) || 0,
    sentCount: Number(sentCount) || 0,
  };
}

/**
 * Partition queue/dirty candidates: confirm only those whose syncId is in cloud.
 * Never includes rows without sync_id (cannot prove cloud presence).
 */
function partitionOutboxForReconcile({ candidates, cloudSyncIds } = {}) {
  const cloudSet = new Set(
    (Array.isArray(cloudSyncIds) ? cloudSyncIds : []).map(String).filter(Boolean)
  );
  const confirmable = [];
  const retain = [];
  const list = Array.isArray(candidates) ? candidates : [];
  for (let i = 0; i < list.length; i++) {
    const row = list[i] || {};
    const syncId = row.syncId != null ? String(row.syncId) : (row.sync_id != null ? String(row.sync_id) : '');
    if (syncId && cloudSet.has(syncId)) confirmable.push(row);
    else retain.push(row);
  }
  return {
    confirmable,
    retain,
    cloudIdCount: cloudSet.size,
    canReconcileAny: confirmable.length > 0 && cloudSet.size > 0,
  };
}

/**
 * Merge / replace persisted cloud sync id set after a pull.
 * From-epoch replaces; incremental merges.
 */
function nextCloudSyncIdSet({ previousIds, pulledIds, pulledFromEpoch } = {}) {
  const pulled = (Array.isArray(pulledIds) ? pulledIds : [])
    .map((id) => (id != null ? String(id).trim() : ''))
    .filter(Boolean);
  if (pulledFromEpoch) {
    return Array.from(new Set(pulled));
  }
  const prev = (Array.isArray(previousIds) ? previousIds : [])
    .map((id) => (id != null ? String(id).trim() : ''))
    .filter(Boolean);
  if (pulled.length === 0) return Array.from(new Set(prev));
  return Array.from(new Set(prev.concat(pulled)));
}

module.exports = {
  isEmptyWritePushResponse,
  countUniquePendingSyncCases,
  buildPendingUploadStats,
  shouldConfirmAlreadyPresent,
  ackMetaForAlreadyPresent,
  partitionOutboxForReconcile,
  nextCloudSyncIdSet,
};
