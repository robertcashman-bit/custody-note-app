/**
 * Offline-First Sync Worker
 * Processes sync_queue per-record. One bad item never blocks others.
 * Runs in Electron main process every 10 seconds.
 *
 * Connectivity states: offline | internet_available_api_unreachable | api_available | auth_required
 * Retry schedule: 1=0s, 2=10s, 3=30s, 4=2m, 5=10m, 6=30m → then failed
 */
const crypto = require('crypto');

const SYNC_POLL_INTERVAL_MS = 10000;
const SYNC_REQUEST_TIMEOUT_MS = 8000;
const RETRY_DELAYS_MS = [0, 10_000, 30_000, 120_000, 600_000, 1_800_000]; // attempt 1..6
const MAX_RETRY_ATTEMPTS = 6;

/** Classify errors: retryable vs permanent */
function isRetryableError(err) {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();
  const code = err.code || err.statusCode;
  if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ECONNRESET' ||
      code === 'ENETUNREACH' || code === 'EAI_AGAIN') return true;
  if (msg.includes('timeout') || msg.includes('network')) return true;
  const m = msg.match(/server error (\d+)/i);
  const status = code || (m && parseInt(m[1], 10));
  if (status >= 500 || status === 429) return true;
  if ([400, 401, 403, 404, 422].includes(status)) return false;
  return true;
}

/** Exponential backoff: next attempt after RETRY_DELAYS_MS[retry_count] */
function getNextAttemptMs(retryCount) {
  const idx = Math.min(retryCount, RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[idx] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
}

function generateQueueId() {
  return 'sq-' + crypto.randomBytes(12).toString('hex');
}

function generateCorrelationId() {
  return 'sync-' + crypto.randomBytes(8).toString('hex');
}

/**
 * Create sync worker. Requires ctx with:
 *   db, dbRun, dbGet, dbAll, flushDb
 *   getSyncApiUrl, readLicenceData, getMachineId
 *   httpPost (url, body, opts) → Promise, opts.timeout in ms
 *   onStatusChange (status) → called with connectivity/sync status
 *   sendToRenderer (channel, data) → IPC to renderer
 */
function createSyncWorker(ctx) {
  let _timer = null;
  let _inProgress = false;
  let _connectivityState = 'unknown'; // offline | api_available | internet_available_api_unreachable | auth_required | unknown
  let _lastSyncAt = null;
  let _lastError = null;

  function setConnectivity(state) {
    if (_connectivityState !== state) {
      _connectivityState = state;
      ctx.onStatusChange && ctx.onStatusChange({ connectivity: state });
    }
  }

  function notifyRenderer(payload) {
    if (ctx.sendToRenderer) ctx.sendToRenderer('sync-status-changed', payload);
  }

  /** Lightweight health check. Uses httpGetWithTimeout if provided, else assumes api_available. */
  async function checkConnectivity() {
    const apiUrl = ctx.getSyncApiUrl && ctx.getSyncApiUrl();
    if (!apiUrl) return 'offline';
    const data = ctx.readLicenceData && ctx.readLicenceData();
    if (!data || !data.key) return 'auth_required';
    if (!ctx.httpGetWithTimeout) return 'api_available';
    try {
      const base = apiUrl.replace(/\/$/, '');
      const healthUrl = base + '/api/health';
      const resp = await ctx.httpGetWithTimeout(healthUrl, SYNC_REQUEST_TIMEOUT_MS);
      if (resp && (resp.statusCode === 200 || resp.statusCode === 204)) return 'api_available';
      if (resp && resp.statusCode === 401) return 'auth_required';
      if (resp && resp.statusCode === 404) return 'api_available';
      return 'internet_available_api_unreachable';
    } catch (e) {
      return 'internet_available_api_unreachable';
    }
  }

  /** Enqueue a sync operation for a record. Replaces any existing pending for same record. */
  function enqueue(recordId, operation, payload) {
    if (!ctx.db) return null;
    const id = generateQueueId();
    const now = Date.now();
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
    try {
      ctx.dbRun('DELETE FROM sync_queue WHERE record_id=? AND status IN (\'pending\',\'syncing\')', [String(recordId)]);
      ctx.dbRun(
        'INSERT INTO sync_queue (id, record_id, operation, payload, created_at, retry_count, last_attempt, status, error) VALUES (?,?,?,?,?,0,?,?,?)',
        [id, String(recordId), operation || 'upsert', payloadStr, now, now, 'pending', null]
      );
      ctx.flushDb && ctx.flushDb();
      return id;
    } catch (e) {
      console.warn('[SyncWorker] Enqueue failed:', e && e.message);
      return null;
    }
  }

  /** Get next queue item ready to process (pending or retry due) */
  function getNextQueueItem() {
    if (!ctx.db) return null;
    const now = Date.now();
    const rows = ctx.dbAll(
      `SELECT id, record_id, operation, payload, retry_count, last_attempt, status, created_at
       FROM sync_queue
       WHERE status IN ('pending','syncing')
       ORDER BY created_at ASC LIMIT 20`
    );
    for (const row of rows || []) {
      const nextMs = getNextAttemptMs(row.retry_count || 0);
      const lastAttempt = row.last_attempt || row.created_at || 0;
      if (now - lastAttempt >= nextMs) return row;
    }
    return null;
  }

  /** Mark item syncing */
  function markSyncing(id) {
    ctx.dbRun('UPDATE sync_queue SET status=?, last_attempt=? WHERE id=?', ['syncing', Date.now(), id]);
  }

  /** Mark item synced and clear sync_dirty */
  function markSynced(id, recordId) {
    ctx.dbRun('UPDATE sync_queue SET status=?, error=NULL WHERE id=?', ['synced', id]);
    if (recordId) ctx.dbRun('UPDATE attendances SET sync_dirty=0 WHERE id=?', [recordId]);
    ctx.flushDb && ctx.flushDb();
  }

  /** Mark item failed or blocked */
  function markFailed(id, error, retryable) {
    const now = Date.now();
    const errMsg = error && (error.message || String(error)) ? (error.message || String(error)).slice(0, 500) : null;
    const row = ctx.dbGet('SELECT retry_count FROM sync_queue WHERE id=?', [id]);
    const nextCount = (row ? row.retry_count || 0 : 0) + (retryable ? 1 : 0);
    const status = !retryable ? 'blocked' : nextCount >= MAX_RETRY_ATTEMPTS ? 'failed' : 'pending';
    ctx.dbRun(
      'UPDATE sync_queue SET status=?, error=?, retry_count=?, last_attempt=? WHERE id=?',
      [status, errMsg, nextCount, now, id]
    );
    ctx.flushDb && ctx.flushDb();
  }

  /** Push single record to API. Always reads current state from attendances. */
  async function pushRecord(queueItem) {
    const apiUrl = ctx.getSyncApiUrl && ctx.getSyncApiUrl();
    if (!apiUrl) throw new Error('No API URL');
    const data = ctx.readLicenceData && ctx.readLicenceData();
    if (!data || !data.key) throw new Error('No licence');
    const recordId = queueItem.record_id;
    const row = ctx.dbGet('SELECT id, sync_id, data, status, created_at, updated_at, deleted_at, deletion_reason, client_name, station_name, dscc_ref, attendance_date, supervisor_approved_at, supervisor_note, archived_at, sync_version FROM attendances WHERE id=?', [recordId]);
    if (!row) throw new Error('Record not found');
    const record = {
      syncId: row.sync_id,
      data: row.data,
      status: row.status || 'draft',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at || null,
      deletionReason: row.deletion_reason || null,
      clientName: row.client_name || '',
      stationName: row.station_name || '',
      dsccRef: row.dscc_ref || '',
      attendanceDate: row.attendance_date || '',
      supervisorApprovedAt: row.supervisor_approved_at || null,
      supervisorNote: row.supervisor_note || '',
      archivedAt: row.archived_at || null,
      version: row.sync_version || 1,
    };
    const correlationId = generateCorrelationId();
    const resp = await ctx.httpPost(
      `${apiUrl.replace(/\/$/, '')}/api/sync/push`,
      { key: data.key, machineId: ctx.getMachineId(), records: [record] },
      { timeout: SYNC_REQUEST_TIMEOUT_MS, correlationId }
    );
    if (!resp || !resp.ok) throw new Error(resp && resp.error ? resp.error : 'Push failed');
    return { written: resp.written || 1 };
  }

  /** Process one queue item. Returns { ok, error } */
  async function processOne() {
    const item = getNextQueueItem();
    if (!item) return { processed: 0 };
    const id = item.id;
    const recordId = item.record_id;
    markSyncing(id);
    notifyRenderer({ status: 'syncing' });
    try {
      await pushRecord(item);
      markSynced(id, recordId);
      _lastSyncAt = new Date().toISOString();
      _lastError = null;
      setConnectivity('api_available');
      notifyRenderer({ status: 'synced', lastSync: _lastSyncAt });
      return { processed: 1 };
    } catch (e) {
      const retryable = isRetryableError(e);
      markFailed(id, e, retryable);
      _lastError = e && e.message ? e.message : String(e);
      if (!retryable) setConnectivity('auth_required');
      else setConnectivity('internet_available_api_unreachable');
      notifyRenderer({ status: 'error', lastError: _lastError, retryable });
      return { processed: 0, error: e };
    }
  }

  /** Main loop: check connectivity, process queue, run pull */
  async function runCycle() {
    if (_inProgress) return;
    _inProgress = true;
    try {
      const conn = await checkConnectivity();
      setConnectivity(conn);
      if (conn !== 'api_available' && conn !== 'auth_required') {
        _inProgress = false;
        return;
      }
      if (conn === 'auth_required') {
        _inProgress = false;
        return;
      }
      await processOne();
      if (ctx.syncPull) {
        const pullResult = await ctx.syncPull().catch(() => ({ pulled: 0 }));
        if (pullResult && pullResult.pulled > 0 && ctx.sendToRenderer) {
          ctx.sendToRenderer('records-updated-from-sync', { count: pullResult.pulled });
        }
      }
    } finally {
      _inProgress = false;
    }
  }

  function start() {
    if (_timer) return;
    runCycle().catch(() => {});
    _timer = setInterval(() => runCycle().catch(() => {}), SYNC_POLL_INTERVAL_MS);
  }

  function stop() {
    if (_timer) clearInterval(_timer);
    _timer = null;
  }

  function scheduleSoon() {
    setTimeout(() => runCycle().catch(() => {}), 1000);
  }

  function getDiagnostics() {
    if (!ctx.db) return {};
    const pending = ctx.dbGet('SELECT COUNT(*) as c FROM sync_queue WHERE status IN (\'pending\',\'syncing\')') || { c: 0 };
    const failed = ctx.dbGet('SELECT COUNT(*) as c FROM sync_queue WHERE status=\'failed\'') || { c: 0 };
    const blocked = ctx.dbGet('SELECT COUNT(*) as c FROM sync_queue WHERE status=\'blocked\'') || { c: 0 };
    const lastSync = ctx.dbGet("SELECT value FROM settings WHERE key='lastSyncPullAt'");
    return {
      queueLength: pending.c || 0,
      failedCount: failed.c || 0,
      blockedCount: blocked.c || 0,
      lastSyncAt: lastSync && lastSync.value !== '1970-01-01T00:00:00.000Z' ? lastSync.value : _lastSyncAt,
      connectivity: _connectivityState,
      lastError: _lastError,
      inProgress: _inProgress,
    };
  }

  return {
    start,
    stop,
    enqueue,
    scheduleSoon,
    runCycle,
    getDiagnostics,
    getConnectivity: () => _connectivityState,
  };
}

module.exports = {
  createSyncWorker,
  generateQueueId,
  isRetryableError,
  RETRY_DELAYS_MS,
  MAX_RETRY_ATTEMPTS,
  SYNC_REQUEST_TIMEOUT_MS,
};
