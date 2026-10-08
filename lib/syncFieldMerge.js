'use strict';

/**
 * Automatic field merge for one attendance note.
 *
 * No user prompt. If only one side changed a field, that side wins.
 * If both changed it, the newest edit wins and the losing value is kept in
 * hidden history on the same note (_cnConflictHistory). That history is not
 * a second visible note and is not deleted.
 *
 * A delete against an edit restores the note (the edit wins).
 * Repeated merges of the same pair do not append another history copy.
 */

const HISTORY_KEY = '_cnConflictHistory';
const TIMES_KEY = '_cnFieldUpdatedAt';
const QUIET_MERGED_MESSAGE = 'Merged changes from another computer';

const TOP_FIELDS = [
  'status',
  'clientName',
  'stationName',
  'dsccRef',
  'attendanceDate',
  'supervisorApprovedAt',
  'supervisorNote',
  'archivedAt',
];

function parseData(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }
  return {};
}

function canonical(value) {
  if (value == null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

function same(a, b) {
  if (a == null || a === '') {
    return b == null || b === '';
  }
  if (b == null || b === '') return false;
  return canonical(a) === canonical(b);
}

function timesOf(data) {
  const t = data && data[TIMES_KEY];
  return t && typeof t === 'object' && !Array.isArray(t) ? t : {};
}

function historyOf(data) {
  const h = data && data[HISTORY_KEY];
  return Array.isArray(h) ? h.slice() : [];
}

function historySignature(entry) {
  if (!entry || typeof entry !== 'object') return '';
  return String(entry.field || '') + '\n' + canonical(entry.lost) + '\n' + canonical(entry.kept);
}

function addHistory(list, entry) {
  if (!entry || entry.lost === undefined) return list;
  if (same(entry.lost, entry.kept)) return list;
  const sig = historySignature(entry);
  for (let i = 0; i < list.length; i++) {
    if (historySignature(list[i]) === sig) return list;
  }
  list.push({
    field: entry.field,
    kept: entry.kept,
    lost: entry.lost,
    keptFrom: entry.keptFrom || null,
    lostFrom: entry.lostFrom || null,
    at: entry.at || null,
  });
  return list;
}

function pick(obj, camel, snake) {
  if (!obj) return null;
  if (obj[camel] != null && obj[camel] !== '') return obj[camel];
  if (snake && obj[snake] != null && obj[snake] !== '') return obj[snake];
  if (obj[camel] != null) return obj[camel];
  if (snake && obj[snake] != null) return obj[snake];
  return null;
}

function viewOf(row) {
  if (!row) return null;
  const data = parseData(row.data);
  return {
    data: data,
    status: pick(row, 'status') || 'draft',
    clientName: pick(row, 'clientName', 'client_name') || '',
    stationName: pick(row, 'stationName', 'station_name') || '',
    dsccRef: pick(row, 'dsccRef', 'dscc_ref') || '',
    attendanceDate: pick(row, 'attendanceDate', 'attendance_date') || '',
    supervisorApprovedAt: pick(row, 'supervisorApprovedAt', 'supervisor_approved_at'),
    supervisorNote: pick(row, 'supervisorNote', 'supervisor_note') || '',
    archivedAt: pick(row, 'archivedAt', 'archived_at'),
    deletedAt: pick(row, 'deletedAt', 'deleted_at'),
    deletionReason: pick(row, 'deletionReason', 'deletion_reason'),
    updatedAt: pick(row, 'updatedAt', 'updated_at') || '',
    version: Number(row.version || row.sync_version || row.syncVersion) || 1,
    syncDirty: row.syncDirty != null ? row.syncDirty : row.sync_dirty,
  };
}

function newerSide(localAt, remoteAt) {
  const l = localAt || '';
  const r = remoteAt || '';
  if (l && r) {
    if (l > r) return 'local';
    if (r > l) return 'remote';
    return 'tie';
  }
  if (l && !r) return 'local';
  if (r && !l) return 'remote';
  return 'tie';
}

function present(value) {
  return !(value == null || value === '');
}

function decideField(field, baseVal, localVal, remoteVal, hasBase, localAt, remoteAt) {
  if (hasBase) {
    const localChanged = !same(localVal, baseVal);
    const remoteChanged = !same(remoteVal, baseVal);
    if (!localChanged && !remoteChanged) return { value: localVal, from: 'base' };
    if (localChanged && !remoteChanged) return { value: localVal, from: 'local' };
    if (remoteChanged && !localChanged) return { value: remoteVal, from: 'remote' };
  } else if (same(localVal, remoteVal)) {
    return { value: localVal, from: 'same' };
  } else if (present(localVal) && !present(remoteVal)) {
    // No base: a value only one side has is that side's edit, not a deletion.
    return { value: localVal, from: 'local' };
  } else if (present(remoteVal) && !present(localVal)) {
    return { value: remoteVal, from: 'remote' };
  }
  const win = newerSide(localAt, remoteAt);
  if (win === 'remote') {
    return { value: remoteVal, from: 'remote', lost: localVal, lostFrom: 'local' };
  }
  // Tie keeps the local edit so an unsynced change is not dropped.
  return { value: localVal, from: 'local', lost: remoteVal, lostFrom: 'remote' };
}

function contentSignature(view) {
  if (!view) return '';
  const data = Object.assign({}, view.data || {});
  delete data[HISTORY_KEY];
  delete data[TIMES_KEY];
  const top = {};
  for (let i = 0; i < TOP_FIELDS.length; i++) {
    top[TOP_FIELDS[i]] = view[TOP_FIELDS[i]];
  }
  return canonical({ data: data, top: top });
}

/**
 * @param {{ base?: object|null, local: object, remote: object }} input
 */
function mergeAttendanceRecords(input) {
  const local = viewOf(input && input.local);
  const remote = viewOf(input && input.remote);
  const hasBase = !!(input && input.base);
  const base = hasBase ? viewOf(input.base) : null;
  if (!local || !remote) {
    return { ok: false, unchanged: true, syncDirty: 0, fieldConflicts: 0, restored: false };
  }

  const localTimes = Object.assign({}, timesOf(base && base.data), timesOf(local.data));
  const remoteTimes = Object.assign({}, timesOf(base && base.data), timesOf(remote.data));
  const history = historyOf(local.data);
  historyOf(remote.data).forEach((entry) => addHistory(history, entry));
  if (base) historyOf(base.data).forEach((entry) => addHistory(history, entry));
  const historyBefore = history.length;

  const dataKeys = new Set();
  [base && base.data, local.data, remote.data].forEach((obj) => {
    if (!obj) return;
    Object.keys(obj).forEach((k) => {
      if (k === HISTORY_KEY || k === TIMES_KEY) return;
      dataKeys.add(k);
    });
  });

  const mergedData = {};
  const mergedTimes = {};
  let keptLocal = false;
  let tookRemote = false;
  let fieldConflicts = 0;

  dataKeys.forEach((key) => {
    const localAt = localTimes[key] || local.updatedAt;
    const remoteAt = remoteTimes[key] || remote.updatedAt;
    const decision = decideField(
      key,
      base && base.data ? base.data[key] : undefined,
      local.data[key],
      remote.data[key],
      hasBase,
      localAt,
      remoteAt
    );
    if (decision.value != null && decision.value !== '') mergedData[key] = decision.value;
    else if (decision.value === 0 || decision.value === false) mergedData[key] = decision.value;
    if (decision.from === 'local' && !same(local.data[key], remote.data[key])) keptLocal = true;
    if (decision.from === 'remote' && !same(decision.value, local.data[key])) tookRemote = true;
    if (decision.lost !== undefined && !same(decision.lost, decision.value)) {
      fieldConflicts += 1;
      addHistory(history, {
        field: key,
        kept: decision.value == null ? null : decision.value,
        lost: decision.lost == null ? null : decision.lost,
        keptFrom: decision.from,
        lostFrom: decision.lostFrom,
        at: decision.from === 'remote' ? remote.updatedAt : local.updatedAt,
      });
    }
    const winAt = decision.from === 'remote' ? remoteAt : localAt;
    if (winAt) mergedTimes[key] = winAt;
  });

  const mergedTop = {};
  TOP_FIELDS.forEach((field) => {
    const localAt = localTimes['_' + field] || local.updatedAt;
    const remoteAt = remoteTimes['_' + field] || remote.updatedAt;
    const decision = decideField(
      field,
      base ? base[field] : undefined,
      local[field],
      remote[field],
      hasBase,
      localAt,
      remoteAt
    );
    mergedTop[field] = decision.value == null || decision.value === '' ? null : decision.value;
    if (field === 'status' || field === 'clientName' || field === 'stationName' || field === 'dsccRef' || field === 'attendanceDate' || field === 'supervisorNote') {
      if (decision.value == null) mergedTop[field] = decision.value === null ? '' : (local[field] || '');
      if (mergedTop[field] == null) mergedTop[field] = '';
    }
    if (decision.from === 'local' && !same(local[field], remote[field])) keptLocal = true;
    if (decision.from === 'remote' && !same(decision.value, local[field])) tookRemote = true;
    if (decision.lost !== undefined && !same(decision.lost, decision.value)) {
      fieldConflicts += 1;
      addHistory(history, {
        field: field,
        kept: decision.value == null ? null : decision.value,
        lost: decision.lost == null ? null : decision.lost,
        keptFrom: decision.from,
        lostFrom: decision.lostFrom,
        at: decision.from === 'remote' ? remote.updatedAt : local.updatedAt,
      });
    }
  });

  const localDeleted = !!(local.deletedAt);
  const remoteDeleted = !!(remote.deletedAt);
  let restored = false;
  let mergedDeletedAt = null;
  let mergedDeletionReason = null;
  if (localDeleted !== remoteDeleted) {
    const editor = localDeleted ? remote : local;
    const deleter = localDeleted ? local : remote;
    const editorChanged = contentSignature(editor) !== contentSignature(Object.assign({}, deleter, {
      deletedAt: editor.deletedAt,
      deletionReason: editor.deletionReason,
    }));
    const substantive = editorChanged || contentSignature(local) !== contentSignature(remote);
    if (substantive) {
      restored = true;
      mergedDeletedAt = null;
      mergedDeletionReason = null;
      if (remoteDeleted) keptLocal = true;
      else tookRemote = true;
      fieldConflicts += 1;
      addHistory(history, {
        field: 'deletedAt',
        kept: null,
        lost: deleter.deletedAt || true,
        keptFrom: localDeleted ? 'remote' : 'local',
        lostFrom: localDeleted ? 'local' : 'remote',
        at: editor.updatedAt || null,
      });
    } else {
      mergedDeletedAt = deleter.deletedAt || null;
      mergedDeletionReason = deleter.deletionReason || null;
    }
  } else if (localDeleted && remoteDeleted) {
    const win = newerSide(local.updatedAt, remote.updatedAt);
    const chosen = win === 'remote' ? remote : local;
    mergedDeletedAt = chosen.deletedAt || local.deletedAt || remote.deletedAt;
    mergedDeletionReason = chosen.deletionReason || null;
  }

  if (history.length) mergedData[HISTORY_KEY] = history;
  if (Object.keys(mergedTimes).length) mergedData[TIMES_KEY] = mergedTimes;

  const mergedView = {
    data: mergedData,
    status: mergedTop.status || local.status || 'draft',
    clientName: mergedTop.clientName || '',
    stationName: mergedTop.stationName || '',
    dsccRef: mergedTop.dsccRef || '',
    attendanceDate: mergedTop.attendanceDate || '',
    supervisorApprovedAt: mergedTop.supervisorApprovedAt,
    supervisorNote: mergedTop.supervisorNote || '',
    archivedAt: mergedTop.archivedAt,
    deletedAt: mergedDeletedAt,
    deletionReason: mergedDeletionReason,
    updatedAt: newerSide(local.updatedAt, remote.updatedAt) === 'remote' ? remote.updatedAt : local.updatedAt,
  };

  const sameAsLocal = contentSignature(mergedView) === contentSignature(local) && same(mergedDeletedAt, local.deletedAt);
  if (sameAsLocal && history.length === historyBefore) {
    return {
      ok: true,
      unchanged: true,
      syncDirty: local.syncDirty ? 1 : 0,
      version: local.version,
      fieldConflicts: 0,
      restored: false,
      data: local.data,
      status: local.status,
      clientName: local.clientName,
      stationName: local.stationName,
      dsccRef: local.dsccRef,
      attendanceDate: local.attendanceDate,
      supervisorApprovedAt: local.supervisorApprovedAt,
      supervisorNote: local.supervisorNote,
      archivedAt: local.archivedAt,
      deletedAt: local.deletedAt,
      deletionReason: local.deletionReason,
      updatedAt: local.updatedAt,
    };
  }

  const differsFromRemote = contentSignature(mergedView) !== contentSignature(remote) || !same(mergedDeletedAt, remote.deletedAt);
  const syncDirty = differsFromRemote ? 1 : 0;
  let version = Math.max(local.version || 1, remote.version || 1);
  if (syncDirty && differsFromRemote && !sameAsLocal) {
    version += 1;
  } else if (!syncDirty) {
    version = Math.max(local.version || 1, remote.version || 1);
  }

  return {
    ok: true,
    unchanged: false,
    syncDirty: syncDirty,
    version: version,
    fieldConflicts: fieldConflicts,
    restored: restored,
    keptLocal: keptLocal,
    tookRemote: tookRemote,
    data: mergedData,
    dataJson: JSON.stringify(mergedData),
    status: mergedView.status,
    clientName: mergedView.clientName,
    stationName: mergedView.stationName,
    dsccRef: mergedView.dsccRef,
    attendanceDate: mergedView.attendanceDate,
    supervisorApprovedAt: mergedView.supervisorApprovedAt,
    supervisorNote: mergedView.supervisorNote,
    archivedAt: mergedView.archivedAt,
    deletedAt: mergedDeletedAt,
    deletionReason: mergedDeletionReason,
    updatedAt: mergedView.updatedAt || new Date().toISOString(),
    quietMessage: (fieldConflicts > 0 || restored || tookRemote) ? QUIET_MERGED_MESSAGE : null,
  };
}

/**
 * Stamp per-field times onto the note JSON when a field changes.
 * Hidden keys are not form fields.
 */
function stampFieldUpdatedAt(prevRaw, nextObj, nowIso) {
  const prev = parseData(prevRaw);
  const next = Object.assign({}, nextObj || {});
  const prevTimes = timesOf(prev);
  const times = Object.assign({}, prevTimes);
  const now = nowIso || new Date().toISOString();
  const keys = new Set(Object.keys(prev).concat(Object.keys(next)));
  keys.delete(HISTORY_KEY);
  keys.delete(TIMES_KEY);
  keys.forEach((key) => {
    if (!same(prev[key], next[key])) times[key] = now;
  });
  if (prev[HISTORY_KEY] && next[HISTORY_KEY] == null) next[HISTORY_KEY] = prev[HISTORY_KEY];
  if (Object.keys(times).length) next[TIMES_KEY] = times;
  return next;
}

/**
 * Fold duplicate local rows that share a sync_id into the oldest row.
 * Extra rows are listed for removal after their fields are in the keeper.
 * Does not invent a tombstone push.
 */
function planDuplicateCollapse(rows) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  if (list.length < 2) return { collapse: false, keeper: list[0] || null, removeIds: [] };
  list.sort((a, b) => Number(a.id) - Number(b.id));
  let keeper = list[0];
  const removeIds = [];
  for (let i = 1; i < list.length; i++) {
    const extra = list[i];
    const merged = mergeAttendanceRecords({ base: null, local: keeper, remote: extra });
    if (!merged.unchanged) {
      keeper = Object.assign({}, keeper, {
        data: merged.dataJson || JSON.stringify(merged.data || {}),
        status: merged.status,
        client_name: merged.clientName,
        clientName: merged.clientName,
        station_name: merged.stationName,
        stationName: merged.stationName,
        dscc_ref: merged.dsccRef,
        dsccRef: merged.dsccRef,
        attendance_date: merged.attendanceDate,
        attendanceDate: merged.attendanceDate,
        supervisor_approved_at: merged.supervisorApprovedAt,
        supervisorApprovedAt: merged.supervisorApprovedAt,
        supervisor_note: merged.supervisorNote,
        supervisorNote: merged.supervisorNote,
        archived_at: merged.archivedAt,
        archivedAt: merged.archivedAt,
        deleted_at: merged.deletedAt,
        deletedAt: merged.deletedAt,
        deletion_reason: merged.deletionReason,
        deletionReason: merged.deletionReason,
        updated_at: merged.updatedAt,
        updatedAt: merged.updatedAt,
        sync_version: merged.version,
        sync_dirty: merged.syncDirty,
      });
    }
    if (extra && extra.id != null) removeIds.push(extra.id);
  }
  return { collapse: true, keeper: keeper, removeIds: removeIds };
}

function writeMergedAttendance(ctx, attendanceId, merged) {
  if (!ctx || typeof ctx.dbRun !== 'function' || !merged || merged.unchanged || !merged.ok) return merged;
  const dataJson = merged.dataJson || (typeof merged.data === 'string' ? merged.data : JSON.stringify(merged.data || {}));
  ctx.dbRun(
    `UPDATE attendances SET data=?, status=?, updated_at=?, deleted_at=?, deletion_reason=?,
      client_name=?, station_name=?, dscc_ref=?, attendance_date=?,
      supervisor_approved_at=?, supervisor_note=?, archived_at=?, sync_dirty=?, sync_version=?
     WHERE id=?`,
    [
      dataJson,
      merged.status || 'draft',
      merged.updatedAt || null,
      merged.deletedAt || null,
      merged.deletionReason || null,
      merged.clientName || '',
      merged.stationName || '',
      merged.dsccRef || '',
      merged.attendanceDate || '',
      merged.supervisorApprovedAt || null,
      merged.supervisorNote || '',
      merged.archivedAt || null,
      merged.syncDirty ? 1 : 0,
      merged.version || 1,
      attendanceId,
    ]
  );
  return merged;
}

function markConflictsAutoMerged(ctx, attendanceId, nowIso) {
  if (!ctx || typeof ctx.dbRun !== 'function' || attendanceId == null) return;
  ctx.dbRun(
    'UPDATE sync_conflicts SET resolved_at=?, resolution_note=? WHERE attendance_id=? AND resolved_at IS NULL',
    [nowIso || new Date().toISOString(), 'auto_merged', attendanceId]
  );
}

module.exports = {
  HISTORY_KEY,
  TIMES_KEY,
  QUIET_MERGED_MESSAGE,
  parseData,
  canonical,
  same,
  mergeAttendanceRecords,
  stampFieldUpdatedAt,
  planDuplicateCollapse,
  viewOf,
  writeMergedAttendance,
  markConflictsAutoMerged,
};
