/**
 * Anywhere ↔ Desktop bridge payload (v1).
 * File exchange only — no cloud sync in this module.
 */
'use strict';

const BRIDGE_APP = 'custodynote-anywhere';
const BRIDGE_FORMAT = 'cn-anywhere-bridge';
const BRIDGE_VERSION = 1;
const MAX_BRIDGE_ATTENDANCES = 500;
const MAX_BRIDGE_JSON_CHARS = 25 * 1024 * 1024; // 25 MB raw JSON
const MAX_RECORD_DATA_CHARS = 2 * 1024 * 1024; // 2 MB per attendance data blob

function isBridgePayload(obj) {
  return !!(
    obj &&
    typeof obj === 'object' &&
    obj.format === BRIDGE_FORMAT &&
    Number(obj.version) === BRIDGE_VERSION &&
    Array.isArray(obj.attendances)
  );
}

function safeJsonParse(text) {
  if (typeof text !== 'string') {
    return { ok: false, error: 'Bridge file must be UTF-8 JSON text.' };
  }
  if (text.length > MAX_BRIDGE_JSON_CHARS) {
    return {
      ok: false,
      error:
        'Bridge file is too large (' +
        Math.round(text.length / (1024 * 1024)) +
        ' MB). Max is ' +
        Math.round(MAX_BRIDGE_JSON_CHARS / (1024 * 1024)) +
        ' MB.',
    };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: 'Could not parse JSON: ' + (e && e.message ? e.message : String(e)) };
  }
}

function buildBridgeFromAnywhereBackup(backupObj) {
  const src = backupObj && typeof backupObj === 'object' ? backupObj : {};
  const attendances = Array.isArray(src.attendances) ? src.attendances : Array.isArray(src) ? src : [];
  return {
    format: BRIDGE_FORMAT,
    version: BRIDGE_VERSION,
    sourceApp: BRIDGE_APP,
    exportedAt: new Date().toISOString(),
    attendances: attendances.map((rec) => ({
      anywhereId: String((rec && (rec.id || rec.anywhereId)) || ''),
      attendanceMode: (rec && rec.attendanceMode) || 'custody',
      status: (rec && rec.status) || 'draft',
      updatedAt: (rec && (rec.updatedAt || rec.updated_at)) || null,
      data: rec && rec.data && typeof rec.data === 'object' ? rec.data : {},
    })),
  };
}

/**
 * Build a bridge payload from desktop attendance rows (for export to Anywhere).
 * rows: [{ id, status, updated_at, data (object|string), ... }]
 */
function buildBridgeFromDesktopRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    format: BRIDGE_FORMAT,
    version: BRIDGE_VERSION,
    sourceApp: 'custody-note-desktop',
    exportedAt: new Date().toISOString(),
    attendances: list.map((row) => {
      let data = {};
      if (row && row.data && typeof row.data === 'object') data = Object.assign({}, row.data);
      else if (row && typeof row.data === 'string') {
        try {
          data = JSON.parse(row.data) || {};
        } catch (_) {
          data = {};
        }
      }
      const mode =
        data.attendanceMode ||
        (data._formType === 'telephone' ? 'telephone' : data.attendanceMode === 'voluntary' ? 'voluntary' : 'custody');
      const anywhereId =
        data._importedFromAnywhereId ||
        (row && row.sync_id ? String(row.sync_id) : '') ||
        (row && row.id != null ? 'desktop-' + String(row.id) : '');
      return {
        anywhereId: String(anywhereId),
        attendanceMode: mode === 'voluntary' || mode === 'telephone' ? mode : 'custody',
        status: row && row.status === 'finalised' ? 'completed' : (row && row.status) || 'draft',
        updatedAt: (row && (row.updated_at || row.updatedAt)) || null,
        data: data,
        desktopId: row && row.id != null ? String(row.id) : null,
      };
    }),
  };
}

/**
 * Normalise unknown JSON into a bridge payload, or return null.
 */
function normaliseToBridgePayload(raw) {
  if (isBridgePayload(raw)) return raw;
  if (Array.isArray(raw)) return buildBridgeFromAnywhereBackup({ attendances: raw });
  if (raw && typeof raw === 'object' && Array.isArray(raw.attendances)) {
    return buildBridgeFromAnywhereBackup(raw);
  }
  return null;
}

function validateBridgePayload(payload) {
  if (!isBridgePayload(payload)) {
    return { ok: false, error: 'Not a valid Custody Note Anywhere bridge file (cn-anywhere-bridge v1).' };
  }
  if (payload.attendances.length === 0) {
    return { ok: false, error: 'Bridge file contains no attendances.' };
  }
  if (payload.attendances.length > MAX_BRIDGE_ATTENDANCES) {
    return {
      ok: false,
      error:
        'Bridge file has ' +
        payload.attendances.length +
        ' records (max ' +
        MAX_BRIDGE_ATTENDANCES +
        '). Split the export and import in batches.',
    };
  }
  return { ok: true };
}

/**
 * Map one Anywhere attendance into desktop attendanceSave shape.
 */
function mapBridgeAttendanceToDesktop(item) {
  const data = Object.assign({}, (item && item.data) || {});
  const mode = (item && item.attendanceMode) || data.attendanceMode || 'custody';
  if (!data._formType) {
    if (mode === 'telephone') data._formType = 'telephone';
    else data._formType = 'attendance';
  }
  if (!data.attendanceMode) {
    if (mode === 'voluntary') data.attendanceMode = 'voluntary';
    else if (mode === 'telephone') data.attendanceMode = 'telephone';
    else data.attendanceMode = 'custody';
  }
  if (item && item.anywhereId) data._importedFromAnywhereId = String(item.anywhereId);
  data._importedFromAnywhereAt = new Date().toISOString();

  let status = (item && item.status) || 'draft';
  if (status === 'completed' || status === 'finalised' || status === 'office_complete') {
    status = 'draft';
  }
  if (status !== 'draft') status = 'draft';

  const dataJson = JSON.stringify(data);
  if (dataJson.length > MAX_RECORD_DATA_CHARS) {
    const err = new Error(
      'Record too large to import (' + Math.round(dataJson.length / 1024) + ' KB). Remove photos/attachments in Anywhere and re-export.'
    );
    err.code = 'RECORD_TOO_LARGE';
    throw err;
  }

  return { data, status, anywhereId: item && item.anywhereId ? String(item.anywhereId) : '' };
}

module.exports = {
  BRIDGE_APP,
  BRIDGE_FORMAT,
  BRIDGE_VERSION,
  MAX_BRIDGE_ATTENDANCES,
  MAX_BRIDGE_JSON_CHARS,
  MAX_RECORD_DATA_CHARS,
  isBridgePayload,
  safeJsonParse,
  buildBridgeFromAnywhereBackup,
  buildBridgeFromDesktopRows,
  normaliseToBridgePayload,
  validateBridgePayload,
  mapBridgeAttendanceToDesktop,
};
