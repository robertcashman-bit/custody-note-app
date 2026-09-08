'use strict';

/**
 * Local vs cloud sync health for Settings / diagnostics.
 * Does not include note bodies — counts and timestamps only.
 */

function buildLocalCloudHealth({
  localCount,
  lastPullReceived,
  pulledFromEpoch,
  dirtyPushCount,
  pendingChanges,
  lastVerifiedCloudPushAt,
  syncPhase,
  schemaVersion,
} = {}) {
  const local = Number(localCount) || 0;
  const received = Number(lastPullReceived) || 0;
  const dirty = Number(dirtyPushCount) || 0;
  const pending = Number(pendingChanges) || 0;
  const cloudLikelyEmpty =
    local > 0 &&
    dirty === 0 &&
    pending === 0 &&
    !!pulledFromEpoch &&
    received === 0;
  return {
    localCount: local,
    lastCloudPullReceived: received,
    pulledFromEpoch: !!pulledFromEpoch,
    pendingUploads: pending + dirty,
    dirtyPushCount: dirty,
    verifiedPushAt: lastVerifiedCloudPushAt || null,
    cloudLikelyEmpty,
    syncPhase: syncPhase || null,
    schemaVersion: schemaVersion != null ? schemaVersion : null,
  };
}

/**
 * Strip attendance rows down to a recovery index (no note body / data JSON).
 */
function buildEmergencyRecordIndex(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.map((r) => ({
    id: r.id,
    syncId: r.sync_id || r.syncId || null,
    clientName: r.client_name || r.clientName || '',
    stationName: r.station_name || r.stationName || '',
    dsccRef: r.dscc_ref || r.dsccRef || '',
    attendanceDate: r.attendance_date || r.attendanceDate || '',
    status: r.status || '',
    updatedAt: r.updated_at || r.updatedAt || null,
    deletedAt: r.deleted_at || r.deletedAt || null,
    syncDirty: r.sync_dirty != null ? !!r.sync_dirty : null,
    syncVersion: r.sync_version != null ? r.sync_version : null,
  }));
}

module.exports = {
  buildLocalCloudHealth,
  buildEmergencyRecordIndex,
};
