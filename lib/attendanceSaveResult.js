'use strict';

/**
 * Metadata-only save observability (no case content / note bodies).
 */

function buildAttendanceSaveLog({
  id,
  status,
  durable,
  syncDirty,
  pendingSync,
  op,
} = {}) {
  return {
    tag: 'SAVE',
    id: id != null ? id : null,
    status: status || null,
    durable: !!durable,
    syncDirty: syncDirty !== false,
    pendingSync: pendingSync !== false,
    op: op || 'attendance-save',
    at: new Date().toISOString(),
  };
}

/**
 * Normalize attendance-save IPC result for renderer callers.
 * Supports legacy numeric id and object { id, durable, ... }.
 */
function normalizeAttendanceSaveResult(result) {
  if (result == null) {
    return { id: null, durable: false, pendingSync: false, syncDirty: false, error: null, raw: result };
  }
  if (typeof result === 'number' || typeof result === 'string') {
    return {
      id: result,
      durable: false,
      pendingSync: true,
      syncDirty: true,
      error: null,
      raw: result,
    };
  }
  if (typeof result === 'object') {
    return {
      id: result.id != null ? result.id : null,
      durable: result.durable === true,
      pendingSync: result.pendingSync !== false && !result.error,
      syncDirty: result.syncDirty !== false && !result.error,
      error: result.error || null,
      message: result.message || null,
      raw: result,
    };
  }
  return { id: null, durable: false, pendingSync: false, syncDirty: false, error: 'invalid_result', raw: result };
}

module.exports = {
  buildAttendanceSaveLog,
  normalizeAttendanceSaveResult,
};
