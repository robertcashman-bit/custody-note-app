'use strict';

/**
 * Diagnostic plain-text sync log (Save & Sync investigation build).
 * Writes <userData>/logs/sync.log, rotating to sync.log.1 at 2 MB.
 * Records queue metadata only: ids, statuses, attempts, timestamps and
 * server error strings. Never note content, payloads or client names.
 */

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 2 * 1024 * 1024;
const STUCK_SYNCING_MS = 5 * 60 * 1000;
const MAX_ERROR_CHARS = 300;

const SKIP_REASON_TEXT = Object.freeze({
  in_progress: 'Another sync is still running (it may be stuck on a slow or blocked connection). Try again in a minute or restart Custody Note.',
  rate_limited: 'The sync server asked us to slow down. It will retry automatically.',
  auth_required: 'Sign in again to sync (Settings, Sync).',
  offline: 'No connection to the sync server. Police station Wi-Fi often blocks sync.',
  api_unreachable: 'The sync server could not be reached. Police station Wi-Fi often blocks sync.',
  device_revoked: 'This computer was removed from sync. Re-activate it in Settings, Sync.',
  device_not_activated: 'This computer is not activated for sync yet. Activate it in Settings, Sync.',
  local_only: 'Not signed in, so notes stay on this computer. Sign in to sync.',
  free_quota_exceeded: 'Your free sync allowance is full.',
  no_worker: 'Sync has not started on this computer yet. Restart Custody Note.',
  no_progress: 'Sync ran but nothing was uploaded. See logs\\sync.log.',
  no_verified_push: 'Nothing is waiting to upload, but no upload has been confirmed since Custody Note started.',
});

function skipReasonText(reason) {
  if (!reason) return null;
  return SKIP_REASON_TEXT[reason] || ('Sync skipped: ' + String(reason));
}

function cleanError(err) {
  if (err == null || err === '') return null;
  return String(err).replace(/[\r\n\t]+/g, ' ').slice(0, MAX_ERROR_CHARS);
}

function iso(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  try { return new Date(n).toISOString(); } catch (_) { return null; }
}

/** Summarise sync_queue rows (metadata only). */
function summarizeQueue(rows, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const counts = {};
  const items = [];
  for (const r of rows || []) {
    const status = String((r && r.status) || 'unknown');
    counts[status] = (counts[status] || 0) + 1;
    items.push({
      id: r.id != null ? String(r.id) : null,
      recordId: r.record_id != null ? String(r.record_id) : null,
      type: r.operation != null ? String(r.operation) : null,
      status,
      attempts: Number(r.retry_count) || 0,
      lastAttemptAt: iso(r.last_attempt),
      ageSinceAttemptSec: Number(r.last_attempt) > 0 ? Math.round((now - Number(r.last_attempt)) / 1000) : null,
      createdAt: iso(r.created_at),
      lastError: cleanError(r.error),
    });
  }
  return { counts, total: items.length, items };
}

/** Rows stuck in 'syncing' with last_attempt older than the threshold. */
function findStuckSyncing(rows, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const limit = opts.thresholdMs != null ? opts.thresholdMs : STUCK_SYNCING_MS;
  return (rows || []).filter((r) => r && r.status === 'syncing'
    && (now - (Number(r.last_attempt) || 0)) > limit);
}

function formatEntry(event, data, at) {
  const ts = (at || new Date()).toISOString();
  let body;
  try { body = JSON.stringify(data == null ? {} : data); } catch (_) { body = '{"error":"unserialisable"}'; }
  return ts + ' ' + String(event) + ' ' + body + '\n';
}

function createSyncDiagLog(opts = {}) {
  const dir = opts.dir;
  const maxBytes = opts.maxBytes || MAX_BYTES;
  const file = path.join(dir, 'sync.log');
  function rotateIfNeeded(incoming) {
    try {
      const st = fs.statSync(file);
      if (st.size + incoming > maxBytes) {
        const old = file + '.1';
        try { fs.rmSync(old, { force: true }); } catch (_) {}
        fs.renameSync(file, old);
      }
    } catch (_) { /* no file yet */ }
  }
  function write(event, data) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const line = formatEntry(event, data);
      rotateIfNeeded(Buffer.byteLength(line));
      fs.appendFileSync(file, line, 'utf8');
      return true;
    } catch (_) {
      return false;
    }
  }
  return { file, write };
}

module.exports = {
  MAX_BYTES,
  STUCK_SYNCING_MS,
  SKIP_REASON_TEXT,
  skipReasonText,
  cleanError,
  summarizeQueue,
  findStuckSyncing,
  formatEntry,
  createSyncDiagLog,
};
