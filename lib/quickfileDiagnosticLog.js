'use strict';

/**
 * Append-only QuickFile diagnostic log: userData/logs/quickfile.log
 * Rotates at 1 MB, keeps 3 generations (.log, .log.1, .log.2).
 * Every line is passed through lib/safeLog.redact before write.
 */

const fs = require('fs');
const path = require('path');
const safeLog = require('./safeLog');

const MAX_BYTES = 1024 * 1024;
const MAX_GENERATIONS = 3;
const FILENAME = 'quickfile.log';
const MAX_LINE_BYTES = 8192;

let _logsDir = null;

function init(userDataPath) {
  const base = String(userDataPath || '').trim();
  if (!base) return;
  _logsDir = path.join(base, 'logs');
  try {
    fs.mkdirSync(_logsDir, { recursive: true });
  } catch (_) { /* ignore */ }
}

function getLogsDir() {
  if (_logsDir) return _logsDir;
  try {
    const ud = require('electron').app.getPath('userData');
    init(ud);
  } catch (_) { /* ignore */ }
  return _logsDir;
}

function _filePath(generation) {
  const dir = getLogsDir();
  if (!dir) return null;
  if (!generation) return path.join(dir, FILENAME);
  return path.join(dir, FILENAME + '.' + generation);
}

function _rotateIfNeeded(filePath) {
  try {
    const st = fs.statSync(filePath);
    if (!st || st.size <= MAX_BYTES) return;
    for (let g = MAX_GENERATIONS - 1; g >= 1; g -= 1) {
      const from = _filePath(g);
      const to = _filePath(g + 1);
      if (g === MAX_GENERATIONS - 1) {
        try { if (fs.existsSync(to)) fs.unlinkSync(to); } catch (_) {}
      }
      if (from && fs.existsSync(from)) {
        try { fs.renameSync(from, to); } catch (_) {}
      }
    }
    const rotated = _filePath(1);
    try { fs.renameSync(filePath, rotated); } catch (_) {}
  } catch (_) { /* file missing */ }
}

/** Fields allowed in log entries — never pass credentials, client names, or amounts. */
function sanitiseEntry(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const out = {
    ts: e.ts || new Date().toISOString(),
    event: String(e.event || 'request'),
    apiPath: String(e.apiPath || ''),
    httpStatus: e.httpStatus != null ? Number(e.httpStatus) : undefined,
    outcome: String(e.outcome || ''),
    qfErrorCode: e.qfErrorCode != null ? String(e.qfErrorCode) : undefined,
    qfErrorMessage: e.qfErrorMessage != null ? String(e.qfErrorMessage).slice(0, 500) : undefined,
    networkCode: e.networkCode != null ? String(e.networkCode) : undefined,
    retryAttempt: Number.isFinite(Number(e.retryAttempt)) ? Number(e.retryAttempt) : undefined,
    createRequestSent: e.createRequestSent === true,
    attendanceId: e.attendanceId != null ? String(e.attendanceId) : undefined,
    invoiceNumberTried: e.invoiceNumberTried != null ? String(e.invoiceNumberTried) : undefined,
    referenceCode: e.referenceCode != null ? String(e.referenceCode) : undefined,
    category: e.category != null ? String(e.category) : undefined,
  };
  Object.keys(out).forEach((k) => {
    if (out[k] === undefined || out[k] === '') delete out[k];
  });
  return safeLog.redact(out);
}

function append(entry) {
  const filePath = _filePath(0);
  if (!filePath) return;
  try {
    _rotateIfNeeded(filePath);
    const line = JSON.stringify(sanitiseEntry(entry));
    const truncated = line.length > MAX_LINE_BYTES
      ? line.slice(0, MAX_LINE_BYTES - 1) + '"'
      : line;
    fs.appendFileSync(filePath, truncated + '\n');
  } catch (e) {
    try { console.warn('[quickfile-log] write failed:', e && e.message ? e.message : e); }
    catch (_) {}
  }
}

module.exports = {
  init,
  getLogsDir,
  append,
  sanitiseEntry,
  MAX_BYTES,
  MAX_GENERATIONS,
};
