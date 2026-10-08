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

const HISTORY_PER_FIELD = 10;
const HISTORY_MAX_BYTES = 50 * 1024;

const CARRY_COLUMNS = [
  'quickfile_invoice_id',
  'quickfile_invoice_number',
  'quickfile_invoice_url',
  'invoice_created_at',
  'invoice_created_by',
  'invoice_subtotal',
  'invoice_vat',
  'invoice_total',
  'invoice_narrative',
  'invoice_mileage_miles',
  'invoice_mileage_rate',
  'invoice_parking_amount',
  'invoice_attendance_fee',
  'invoice_vat_rate',
  'work_type',
];

/** SQLite datetime('now') is "YYYY-MM-DD HH:MM:SS" UTC. ISO instants already have a zone. */
function parseTimestampMs(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (!s) return null;
  let iso = s;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) {
    iso = s.replace(' ', 'T') + 'Z';
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    iso = s + 'T00:00:00.000Z';
  }
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function toIsoUtc(value) {
  const ms = parseTimestampMs(value);
  if (ms == null) return value == null ? '' : String(value);
  return new Date(ms).toISOString();
}

function newerSide(localAt, remoteAt) {
  const l = parseTimestampMs(localAt);
  const r = parseTimestampMs(remoteAt);
  if (l != null && r != null) {
    if (l > r) return 'local';
    if (r > l) return 'remote';
    return 'tie';
  }
  if (l != null) return 'local';
  if (r != null) return 'remote';
  return 'tie';
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/** Last 10 entries per field, then oldest dropped until the JSON is about 50 KB. */
function capConflictHistory(list) {
  const src = Array.isArray(list) ? list : [];
  const counts = Object.create(null);
  const keptRev = [];
  for (let i = src.length - 1; i >= 0; i--) {
    const field = String((src[i] && src[i].field) || '');
    counts[field] = (counts[field] || 0) + 1;
    if (counts[field] <= HISTORY_PER_FIELD) keptRev.push(src[i]);
  }
  const kept = keptRev.reverse();
  while (kept.length && jsonBytes(kept) > HISTORY_MAX_BYTES) kept.shift();
  return kept;
}

function unionConflictHistory(prevRaw, nextObj) {
  const list = [];
  historyOf(parseData(prevRaw)).forEach((entry) => addHistory(list, entry));
  historyOf(nextObj).forEach((entry) => addHistory(list, entry));
  return capConflictHistory(list);
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
    if (winAt) mergedTimes[key] = toIsoUtc(winAt);
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

  const historyBeforeSig = canonical(historyOf(local.data));
  const cappedHistory = capConflictHistory(history);
  if (cappedHistory.length) mergedData[HISTORY_KEY] = cappedHistory;
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
    updatedAt: newerSide(local.updatedAt, remote.updatedAt) === 'remote' ? toIsoUtc(remote.updatedAt) : toIsoUtc(local.updatedAt),
  };

  const historySame = canonical(cappedHistory) === historyBeforeSig;
  const sameAsLocal = contentSignature(mergedView) === contentSignature(local) && same(mergedDeletedAt, local.deletedAt);
  if (sameAsLocal && historySame) {
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
  Object.keys(times).forEach((key) => {
    const iso = toIsoUtc(times[key]);
    if (iso) times[key] = iso;
  });
  const union = unionConflictHistory(prev, next);
  if (union.length) next[HISTORY_KEY] = union;
  else delete next[HISTORY_KEY];
  if (Object.keys(times).length) next[TIMES_KEY] = times;
  return next;
}

function columnValue(row, key) {
  if (!row || row[key] == null || row[key] === '') return null;
  return row[key];
}

function createdDay(row) {
  const raw = columnValue(row, 'created_at');
  const alt = raw == null ? columnValue(row, 'createdAt') : raw;
  const ms = parseTimestampMs(alt);
  if (ms == null) return '';
  return new Date(ms).toISOString().slice(0, 10);
}

function normText(value) {
  if (value == null) return '';
  return String(value).trim().toLowerCase();
}

function identityTuple(row) {
  return [
    createdDay(row),
    normText(columnValue(row, 'client_name') || columnValue(row, 'clientName')),
    normText(columnValue(row, 'attendance_date') || columnValue(row, 'attendanceDate')),
    normText(columnValue(row, 'dscc_ref') || columnValue(row, 'dsccRef')),
  ];
}

function strictIdentityMatch(a, b) {
  const left = identityTuple(a);
  const right = identityTuple(b);
  for (let i = 0; i < left.length; i++) {
    if (!left[i] || !right[i] || left[i] !== right[i]) return false;
  }
  return true;
}

function presentDataEntries(row) {
  const data = parseData(row && row.data);
  const out = [];
  Object.keys(data).forEach((key) => {
    if (key === HISTORY_KEY || key === TIMES_KEY) return;
    if (!present(data[key])) return;
    out.push([key, data[key]]);
  });
  return out;
}

/** Every present identity or note field on smaller equals larger. */
function isContentSubset(smaller, larger) {
  let matched = 0;
  const smallId = identityTuple(smaller);
  const largeId = identityTuple(larger);
  for (let i = 0; i < smallId.length; i++) {
    if (!smallId[i]) continue;
    if (!largeId[i] || largeId[i] !== smallId[i]) return false;
    matched += 1;
  }
  const data = presentDataEntries(smaller);
  const largerData = parseData(larger && larger.data);
  for (let i = 0; i < data.length; i++) {
    const key = data[i][0];
    if (!present(largerData[key]) || !same(data[i][1], largerData[key])) return false;
    matched += 1;
  }
  return matched > 0;
}

function rowsAreSameNote(a, b) {
  if (strictIdentityMatch(a, b)) return true;
  if (isContentSubset(a, b) || isContentSubset(b, a)) return true;
  return false;
}

function carryColumns(keeper, extra) {
  const values = {};
  for (let i = 0; i < CARRY_COLUMNS.length; i++) {
    const key = CARRY_COLUMNS[i];
    const kept = columnValue(keeper, key);
    const other = columnValue(extra, key);
    if (kept != null && other != null && !same(kept, other)) return { ok: false, conflict: key };
    values[key] = kept != null ? kept : other;
  }
  return { ok: true, values: values };
}

function dirtyFlag(row) {
  if (!row) return false;
  const v = row.sync_dirty != null ? row.sync_dirty : row.syncDirty;
  return Number(v) === 1;
}

function rowVersion(row) {
  return Number(row && (row.sync_version || row.version)) || 1;
}

/**
 * Fold duplicate local rows that share a sync_id only when they are clearly
 * the same note. Otherwise the extra row is listed for a fresh sync_id.
 * Does not invent a tombstone push and does not delete on its own.
 */
function planDuplicateCollapse(rows) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  if (list.length < 2) {
    return { collapse: false, action: 'keep', keeper: list[0] || null, removeIds: [], rekeyIds: [] };
  }
  list.sort((a, b) => Number(a.id) - Number(b.id));
  let keeper = Object.assign({}, list[0]);
  const removeIds = [];
  const rekeyIds = [];
  const foldedRows = [list[0]];
  for (let i = 1; i < list.length; i++) {
    const extra = list[i];
    const carry = carryColumns(keeper, extra);
    if (!rowsAreSameNote(keeper, extra) || !carry.ok) {
      if (extra && extra.id != null) rekeyIds.push(extra.id);
      continue;
    }
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
    Object.keys(carry.values).forEach((key) => {
      if (carry.values[key] != null) keeper[key] = carry.values[key];
    });
    foldedRows.push(extra);
    if (extra && extra.id != null) removeIds.push(extra.id);
  }
  if (!removeIds.length) {
    return {
      collapse: false,
      action: rekeyIds.length ? 'rekey' : 'keep',
      keeper: list[0],
      removeIds: [],
      rekeyIds: rekeyIds,
    };
  }
  const version = foldedRows.reduce((max, row) => Math.max(max, rowVersion(row)), 1);
  const dirty = foldedRows.some(dirtyFlag);
  keeper.sync_version = Math.max(version, rowVersion(keeper));
  keeper.sync_dirty = dirty ? 1 : 0;
  return {
    collapse: true,
    action: rekeyIds.length ? 'mixed' : 'fold',
    keeper: keeper,
    removeIds: removeIds,
    rekeyIds: rekeyIds,
  };
}

function moveAttendancePhotos(fsImpl, pathImpl, photosRoot, fromId, toId, opts) {
  if (!fsImpl || !pathImpl || !photosRoot) return { ok: true, moved: 0 };
  const from = String(fromId == null ? '' : fromId);
  const to = String(toId == null ? '' : toId);
  if (!from || !to || from === to) return { ok: true, moved: 0 };
  const src = pathImpl.join(photosRoot, from);
  const dest = pathImpl.join(photosRoot, to);
  if (!fsImpl.existsSync(src)) return { ok: true, moved: 0 };
  let names = [];
  try {
    names = fsImpl.readdirSync(src);
  } catch (_) {
    return { ok: false, reason: 'photo_read_failed' };
  }
  if (fsImpl.existsSync(dest)) {
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const destFile = pathImpl.join(dest, name);
      if (!fsImpl.existsSync(destFile)) continue;
      const left = fsImpl.readFileSync(pathImpl.join(src, name));
      const right = fsImpl.readFileSync(destFile);
      const sameBytes = Buffer.isBuffer(left) && Buffer.isBuffer(right) ? left.equals(right) : String(left) === String(right);
      if (!sameBytes) return { ok: false, conflict: true, reason: 'photo_conflict', file: name };
    }
  }
  if (opts && opts.dry) return { ok: true, moved: 0, dry: true };
  try {
    fsImpl.mkdirSync(dest, { recursive: true });
    let moved = 0;
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const srcFile = pathImpl.join(src, name);
      const destFile = pathImpl.join(dest, name);
      if (fsImpl.existsSync(destFile)) fsImpl.unlinkSync(srcFile);
      else {
        fsImpl.renameSync(srcFile, destFile);
        moved += 1;
      }
    }
    try {
      if (fsImpl.readdirSync(src).length === 0) fsImpl.rmdirSync(src);
    } catch (_) {}
    return { ok: true, moved: moved };
  } catch (err) {
    return { ok: false, reason: err && err.message ? err.message : 'photo_move_failed' };
  }
}

function backupFoldedAttendanceRow(fsImpl, pathImpl, backupDir, extraRow, related) {
  if (!fsImpl || !pathImpl || !backupDir) return { ok: false, reason: 'no_backup_dir' };
  if (!extraRow) return { ok: false, reason: 'no_row' };
  try {
    fsImpl.mkdirSync(backupDir, { recursive: true });
    const dest = pathImpl.join(backupDir, 'fold-row-' + String(extraRow.id) + '-' + Date.now() + '.json');
    const payload = {
      backedUpAt: new Date().toISOString(),
      attendance: extraRow,
    };
    if (related) payload.related = related;
    const body = JSON.stringify(payload);
    fsImpl.writeFileSync(dest, body);
    if (fsImpl.readFileSync(dest, 'utf8') !== body) return { ok: false, reason: 'verify_failed' };
    return { ok: true, path: dest };
  } catch (err) {
    return { ok: false, reason: err && err.message ? err.message : 'backup_failed' };
  }
}

/**
 * Back up the extra row, then move photos/<fromId> onto the kept row.
 * A photo filename clash or a backup failure returns ok:false and moves nothing
 * (backup runs only after the photo clash check).
 */
function backupThenMoveFoldFiles(opts) {
  const src = opts || {};
  const photo = moveAttendancePhotos(src.fs, src.path, src.photosRoot, src.extraRow && src.extraRow.id, src.keeperId, { dry: true });
  if (!photo.ok) return photo;
  const backed = backupFoldedAttendanceRow(src.fs, src.path, src.backupDir, src.extraRow, src.related);
  if (!backed.ok) return backed;
  const moved = moveAttendancePhotos(src.fs, src.path, src.photosRoot, src.extraRow && src.extraRow.id, src.keeperId);
  if (!moved.ok) return Object.assign({ backupPath: backed.path }, moved);
  return { ok: true, backupPath: backed.path, moved: moved.moved || 0 };
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
  capConflictHistory,
  parseTimestampMs,
  toIsoUtc,
  rowsAreSameNote,
  moveAttendancePhotos,
  backupFoldedAttendanceRow,
  backupThenMoveFoldFiles,
  CARRY_COLUMNS,
  viewOf,
  writeMergedAttendance,
  markConflictsAutoMerged,
};
