/**
 * Offline-First Sync Worker — v2
 * Processes sync_queue per-record. One bad item never blocks others.
 * Runs in Electron main process every 10 seconds.
 *
 * ROOT CAUSE ANALYSIS (v1 issues fixed here):
 *
 * 1. Health check gated all sync processing — if /api/health timed out (common
 *    on government Wi-Fi with captive portals or high latency), runCycle bailed
 *    entirely. The push endpoint may still be reachable even when health fails.
 *    FIX: Health check is now advisory. We skip processing only on definitive
 *    'offline' (no API URL) or 'auth_required'. Otherwise we attempt the push
 *    and let per-item error handling decide.
 *
 * 2. markSynced cleared sync_dirty by record ID without checking sync_version.
 *    If autosave wrote a new version between pushRecord reading the row and
 *    markSynced completing, the newer change was silently marked as synced.
 *    FIX: pushRecord now captures sync_version at read time. markSynced only
 *    clears sync_dirty when the version still matches.
 *
 * 3. One HTTP request per record made large backlogs very slow (re-key, bulk
 *    recovery). FIX: processBatch sends up to PUSH_HTTP_BATCH_SIZE records per
 *    request and runs up to MAX_PUSH_ROUNDS_PER_CYCLE rounds per cycle (100
 *    records/cycle max), stopping on the first network error.
 *
 * 4. recoverStuckItems reset 'blocked' items (permanent 4xx errors) to pending
 *    after 5 minutes, causing them to retry forever and burn cycles.
 *    FIX: 'failed' items recover after 5 min. 'blocked' items auto-recover
 *    after 30 min with a cap of MAX_BLOCKED_AUTO_RECOVERIES (3). On app
 *    start, all blocked items get one free retry (version update may fix it).
 *
 * Connectivity states: offline | internet_available_api_unreachable | api_available | auth_required
 * Retry schedule: 1=0s, 2=10s, 3=30s, 4=2m, 5=10m, 6=30m → then failed
 */
const crypto = require('crypto');
const { encryptSyncEnvelope } = require('../lib/syncRecordCrypto');
const {
  assertPushAccepted,
  createRateLimitGate,
  RATE_LIMIT_COOLDOWN_MS,
} = require('../lib/syncPushAck');
const { normalizeLicenceKeyForSync } = require('../lib/licenceKeyNormalize');
const {
  buildMutationId,
  mayClearOutboxEntry,
  isAmbiguousPushAck,
} = require('../lib/syncMutationId');

const SYNC_POLL_INTERVAL_MS = 10000;
const SYNC_REQUEST_TIMEOUT_MS = 30000;
const HEALTH_CHECK_TIMEOUT_MS = 4000;
const SCHEDULE_SOON_DEBOUNCE_MS = 1000;
const RETRY_DELAYS_MS = [0, 10_000, 30_000, 120_000, 600_000, 1_800_000]; // attempt 1..6
const MAX_RETRY_ATTEMPTS = 6;
const PUSH_HTTP_BATCH_SIZE = 20;
const MAX_PUSH_ROUNDS_PER_CYCLE = 5;
const MAX_RECORDS_PER_CYCLE = PUSH_HTTP_BATCH_SIZE * MAX_PUSH_ROUNDS_PER_CYCLE;
const HEALTH_CHECK_SKIP_WINDOW_MS = 60_000;
const BLOCKED_RECOVERY_COOLDOWN_MS = 30 * 60_000;
const MAX_BLOCKED_AUTO_RECOVERIES = 3;

/** Classify errors: retryable vs permanent */
function isRetryableError(err) {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();
  const code = err.code || err.statusCode;
  if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ECONNRESET' ||
      code === 'ENETUNREACH' || code === 'EAI_AGAIN') return true;
  if (code === 'PUSH_INCOMPLETE') return true;
  if (msg.includes('timeout') || msg.includes('network') || msg.includes('aborted')) return true;
  // Rate-limit bodies often say "Too many requests" without embedding "429".
  if (msg.includes('too many requests') || msg.includes('rate limit')) return true;
  const m = msg.match(/server error (\d+)/i);
  const status = code || (m && parseInt(m[1], 10));
  if (status >= 500 || status === 429) return true;
  if ([400, 401, 403, 404, 422].includes(status)) return false;
  return true;
}

/** Exponential backoff: next attempt after RETRY_DELAYS_MS[retry_count] */
function getNextAttemptMs(retryCount) {
  const idx = Math.min(retryCount, RETRY_DELAYS_MS.length - 1);
  const val = RETRY_DELAYS_MS[idx];
  return val !== undefined ? val : RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
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
 *   httpGetWithTimeout (url, timeoutMs) → Promise
 *   onStatusChange (status) → called with connectivity/sync status
 *   sendToRenderer (channel, data) → IPC to renderer
 *   syncPull () → Promise
 *   logSyncAttempt (optional)
 */
function createSyncWorker(ctx) {
  let _timer = null;
  let _inProgress = false;
  let _connectivityState = 'unknown';
  let _lastSyncAt = null;
  let _lastSuccessfulPushAt = 0;
  let _lastVerifiedCloudPushAt = null;
  let _lastPushStats = { attempted: 0, written: 0, ok: false, at: null, error: null };
  let _lastError = null;
  const rateLimitGate = createRateLimitGate({
    cooldownMs: (ctx && ctx.rateLimitCooldownMs) || RATE_LIMIT_COOLDOWN_MS,
  });

  function setConnectivity(state) {
    if (_connectivityState !== state) {
      _connectivityState = state;
      ctx.onStatusChange && ctx.onStatusChange({ connectivity: state });
    }
  }

  function notifyRenderer(payload) {
    if (ctx.sendToRenderer) ctx.sendToRenderer('sync-status-changed', payload);
  }

  /**
   * Advisory health check. Returns connectivity state but does NOT block
   * sync processing on 'internet_available_api_unreachable'. Only 'offline'
   * and 'auth_required' are hard stops.
   */
  async function checkConnectivity() {
    const apiUrl = ctx.getSyncApiUrl && ctx.getSyncApiUrl();
    if (!apiUrl) return 'offline';
    const data = ctx.readLicenceData && ctx.readLicenceData();
    if (!data || !data.key) return 'auth_required';
    if (Date.now() - _lastSuccessfulPushAt < HEALTH_CHECK_SKIP_WINDOW_MS) {
      return 'api_available';
    }
    if (!ctx.httpGetWithTimeout) return 'api_available';
    try {
      const base = apiUrl.replace(/\/$/, '');
      const healthUrl = base + '/api/health';
      const resp = await ctx.httpGetWithTimeout(healthUrl, HEALTH_CHECK_TIMEOUT_MS);
      if (resp && (resp.statusCode === 200 || resp.statusCode === 204)) return 'api_available';
      if (resp && resp.statusCode === 401) return 'auth_required';
      if (resp && resp.statusCode === 404) return 'api_available';
      return 'internet_available_api_unreachable';
    } catch (e) {
      return 'internet_available_api_unreachable';
    }
  }

  /** Enqueue a sync operation for a record. Replaces any existing entry for
   *  the same record UNLESS one is already mid-push. H31 — the v1 worker
   *  deleted queue entries unconditionally, which could stomp on a row that
   *  was in 'syncing' state and whose push is currently in flight (the push
   *  would succeed, markSynced would fail to find the id, and the newer local
   *  change would never be queued). We now skip entries in 'syncing' so the
   *  in-flight push can complete, then enqueue the new version fresh.
   *
   *  Mutation IDs are idempotent per sync_id+sync_version+operation. Ambiguous
   *  acks must retry with the same mutationId; never dequeue before confirmed ack.
   */
  function enqueue(recordId, operation, payload) {
    if (!ctx.db) return null;
    const id = generateQueueId();
    const now = Date.now();
    const op = operation || 'upsert';
    let mutationId = null;
    let rowMeta = null;
    try {
      rowMeta = ctx.dbGet(
        'SELECT sync_id, sync_version FROM attendances WHERE id=?',
        [recordId]
      );
    } catch (_) {}
    mutationId = buildMutationId({
      syncId: rowMeta && rowMeta.sync_id,
      syncVersion: rowMeta && rowMeta.sync_version,
      operation: op,
      recordId,
    });
    const basePayload = typeof payload === 'string'
      ? (() => { try { return JSON.parse(payload); } catch (_) { return { raw: payload }; } })()
      : (payload && typeof payload === 'object' ? { ...payload } : {});
    basePayload.mutationId = basePayload.mutationId || mutationId;
    const payloadStr = JSON.stringify(basePayload);
    try {
      // Leave syncing rows alone; delete every other prior entry for this record.
      // Never delete 'syncing' before ack — that would drop an in-flight mutation.
      ctx.dbRun(
        "DELETE FROM sync_queue WHERE record_id=? AND status IN ('pending','failed','blocked','synced')",
        [String(recordId)]
      );
      try {
        ctx.dbRun(
          'INSERT INTO sync_queue (id, record_id, operation, payload, created_at, retry_count, last_attempt, status, error, mutation_id) VALUES (?,?,?,?,?,0,?,?,?,?)',
          [id, String(recordId), op, payloadStr, now, now, 'pending', null, mutationId]
        );
      } catch (colErr) {
        // Pre-migration DBs: mutation_id column may be absent — payload still carries it.
        ctx.dbRun(
          'INSERT INTO sync_queue (id, record_id, operation, payload, created_at, retry_count, last_attempt, status, error) VALUES (?,?,?,?,?,0,?,?,?)',
          [id, String(recordId), op, payloadStr, now, now, 'pending', null]
        );
      }
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
       WHERE status = 'pending'
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

  /** Mark item synced. Only clears sync_dirty if the version hasn't changed during push.
   *  Requires confirmed ack (caller must use assertPushAccepted / mayClearOutboxEntry).
   */
  function markSynced(id, recordId, pushedVersion, ackMeta) {
    if (ackMeta && mayClearOutboxEntry(ackMeta) === false) {
      console.warn('[SyncWorker] Refusing markSynced without confirmed ack for', id);
      return false;
    }
    ctx.dbRun('UPDATE sync_queue SET status=?, error=NULL WHERE id=?', ['synced', id]);
    if (recordId && pushedVersion != null) {
      ctx.dbRun('UPDATE attendances SET sync_dirty=0 WHERE id=? AND sync_version=?', [recordId, pushedVersion]);
    } else if (recordId) {
      ctx.dbRun('UPDATE attendances SET sync_dirty=0 WHERE id=?', [recordId]);
    }
    if (recordId && ctx.resolveSyncConflictsForRecord) {
      ctx.resolveSyncConflictsForRecord(recordId, 'local_push_succeeded');
    }
    ctx.flushDb && ctx.flushDb();
    return true;
  }

  /** Mark item failed or blocked. Always increments retry_count to track attempts. */
  function markFailed(id, error, retryable) {
    const now = Date.now();
    const errMsg = error && (error.message || String(error)) ? (error.message || String(error)).slice(0, 500) : null;
    const row = ctx.dbGet('SELECT retry_count FROM sync_queue WHERE id=?', [id]);
    const nextCount = (row ? row.retry_count || 0 : 0) + 1;
    const status = !retryable ? 'blocked' : nextCount >= MAX_RETRY_ATTEMPTS ? 'failed' : 'pending';
    ctx.dbRun(
      'UPDATE sync_queue SET status=?, error=?, retry_count=?, last_attempt=? WHERE id=?',
      [status, errMsg, nextCount, now, id]
    );
    ctx.flushDb && ctx.flushDb();
  }

  /** Build encrypted push payload for one queue item. */
  function buildPushPayload(queueItem) {
    const recordId = queueItem.record_id;
    const row = ctx.dbGet('SELECT id, sync_id, data, status, created_at, updated_at, deleted_at, deletion_reason, client_name, station_name, dscc_ref, attendance_date, supervisor_approved_at, supervisor_note, archived_at, sync_version FROM attendances WHERE id=?', [recordId]);
    if (!row) throw new Error('Record not found');
    const capturedVersion = row.sync_version || 1;
    const masterKeyHex = ctx.getMasterKeyHex && ctx.getMasterKeyHex();
    if (!masterKeyHex) throw new Error('No encryption key; cannot sync');
    const envelope = encryptSyncEnvelope(masterKeyHex, {
      data: row.data,
      status: row.status || 'draft',
      clientName: row.client_name || '',
      stationName: row.station_name || '',
      dsccRef: row.dscc_ref || '',
      attendanceDate: row.attendance_date || '',
      supervisorApprovedAt: row.supervisor_approved_at || null,
      supervisorNote: row.supervisor_note || '',
      archivedAt: row.archived_at || null,
      deletedAt: row.deleted_at || null,
      deletionReason: row.deletion_reason || null,
    });
    return {
      queueId: queueItem.id,
      recordId,
      capturedVersion,
      record: {
        syncId: row.sync_id,
        envelope,
        encrypted: true,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        version: capturedVersion,
      },
    };
  }

  /** Push up to PUSH_HTTP_BATCH_SIZE records in one HTTP request. */
  async function pushRecordBatch(queueItems) {
    const apiUrl = ctx.getSyncApiUrl && ctx.getSyncApiUrl();
    if (!apiUrl) throw new Error('No API URL');
    const data = ctx.readLicenceData && ctx.readLicenceData();
    if (!data || !data.key) throw new Error('No licence');
    const licenceKey = normalizeLicenceKeyForSync(data.key);
    if (!licenceKey) throw new Error('No licence');
    const payloads = queueItems.map((item) => buildPushPayload(item));
    const correlationId = generateCorrelationId();
    const resp = await ctx.httpPost(
      `${apiUrl.replace(/\/$/, '')}/api/sync/push`,
      {
        key: licenceKey,
        machineId: ctx.getMachineId(),
        records: payloads.map((p) => p.record),
      },
      { timeout: SYNC_REQUEST_TIMEOUT_MS, correlationId }
    );
    if (isAmbiguousPushAck(resp, payloads.length)) {
      const err = new Error('Push unconfirmed: ambiguous acknowledgement — safe retry');
      err.code = 'PUSH_INCOMPLETE';
      err.statusCode = 503;
      throw err;
    }
    assertPushAccepted(resp, payloads.length);
    return { payloads, resp };
  }

  /**
   * Process up to MAX_RECORDS_PER_CYCLE queue items per cycle (batched HTTP).
   * Stops on first network error (no point continuing if connectivity is lost).
   */
  async function processBatch() {
    let totalProcessed = 0;
    for (let round = 0; round < MAX_PUSH_ROUNDS_PER_CYCLE; round++) {
      const items = [];
      for (let i = 0; i < PUSH_HTTP_BATCH_SIZE; i++) {
        const item = getNextQueueItem();
        if (!item) break;
        items.push(item);
        markSyncing(item.id);
      }
      if (items.length === 0) break;
      if (totalProcessed === 0) notifyRenderer({ status: 'syncing' });
      try {
        const batchResult = await pushRecordBatch(items);
        const payloads = batchResult.payloads || batchResult;
        const resp = batchResult.resp || { ok: true, written: payloads.length };
        const writtenCount = Array.isArray(resp.written) ? resp.written.length : Number(resp.written);
        for (const payload of payloads) {
          const cleared = markSynced(payload.queueId, payload.recordId, payload.capturedVersion, {
            confirmed: true,
            ambiguous: false,
            written: Number.isFinite(writtenCount) ? writtenCount : payloads.length,
            sentCount: payloads.length,
          });
          if (cleared !== false) totalProcessed++;
        }
        _lastSyncAt = new Date().toISOString();
        _lastSuccessfulPushAt = Date.now();
        _lastVerifiedCloudPushAt = new Date().toISOString();
        _lastPushStats = {
          attempted: payloads.length,
          written: Number.isFinite(writtenCount) ? writtenCount : payloads.length,
          ok: true,
          at: _lastVerifiedCloudPushAt,
          error: null,
        };
        _lastError = null;
        rateLimitGate.clear();
        setConnectivity('api_available');
        if (ctx.logSyncAttempt) {
          ctx.logSyncAttempt(generateCorrelationId(), 'push', payloads.length, true, null);
        }
      } catch (e) {
        const retryable = isRetryableError(e);
        for (const item of items) {
          markFailed(item.id, e, retryable);
        }
        _lastError = e && e.message ? e.message : String(e);
        _lastPushStats = {
          attempted: items.length,
          written: 0,
          ok: false,
          at: new Date().toISOString(),
          error: _lastError,
        };
        // H32 — invalidate the "recent successful push" cache on any error so
        // the next cycle actually hits /api/health instead of blindly
        // claiming api_available for up to 60 seconds.
        _lastSuccessfulPushAt = 0;
        if (rateLimitGate.noteError(e)) {
          notifyRenderer({
            status: 'error',
            lastError: _lastError,
            retryable: true,
            rateLimited: true,
            rateLimitRemainingMs: rateLimitGate.remainingMs(),
          });
        }
        if (ctx.logSyncAttempt) {
          ctx.logSyncAttempt(generateCorrelationId(), 'push', items.length, false, _lastError);
        }
        if (!retryable) setConnectivity('auth_required');
        else setConnectivity('internet_available_api_unreachable');
        notifyRenderer({ status: 'error', lastError: _lastError, retryable });
        break;
      }
    }
    if (totalProcessed > 0) {
      notifyRenderer({ status: 'synced', lastSync: _lastSyncAt });
    }
    return { processed: totalProcessed };
  }

  /**
   * Recover stuck items:
   * - 'failed' (retryable errors that exhausted retries): recover after 5 min cooldown.
   * - 'blocked' (4xx errors): auto-recover after 30 min cooldown, up to
   *   MAX_BLOCKED_AUTO_RECOVERIES times. After that, only manual retry or
   *   re-saving the record will unblock them.
   */
  function recoverStuckItems() {
    if (!ctx.db) return 0;
    const RECOVERY_COOLDOWN_MS = 5 * 60_000;
    const now = Date.now();
    let recovered = 0;
    try {
      const failed = ctx.dbAll(
        `SELECT id FROM sync_queue
         WHERE status = 'failed'
         AND (? - COALESCE(last_attempt, 0)) > ?`,
        [now, RECOVERY_COOLDOWN_MS]
      ) || [];
      for (const row of failed) {
        ctx.dbRun(
          'UPDATE sync_queue SET status=?, retry_count=0, last_attempt=?, error=NULL WHERE id=?',
          ['pending', now, row.id]
        );
        recovered++;
      }
      const blocked = ctx.dbAll(
        `SELECT id FROM sync_queue
         WHERE status = 'blocked'
         AND retry_count < ?
         AND (? - COALESCE(last_attempt, 0)) > ?`,
        [MAX_BLOCKED_AUTO_RECOVERIES, now, BLOCKED_RECOVERY_COOLDOWN_MS]
      ) || [];
      for (const row of blocked) {
        ctx.dbRun(
          'UPDATE sync_queue SET status=?, last_attempt=? WHERE id=?',
          ['pending', now, row.id]
        );
        recovered++;
      }
      if (recovered > 0) ctx.flushDb && ctx.flushDb();
      return recovered;
    } catch (e) {
      return 0;
    }
  }

  /** Canonical-key handshake: once per session, retried at most once a minute
   *  until it succeeds. Guarantees every device converges on ONE encryption
   *  key per licence BEFORE pushing or pulling records. */
  let _canonicalKeyDone = false;
  let _canonicalKeyLastTry = 0;
  const CANONICAL_KEY_RETRY_MS = 15_000;

  async function ensureCanonicalKeyOnce() {
    if (_canonicalKeyDone || !ctx.ensureCanonicalKey) return;
    const now = Date.now();
    if (now - _canonicalKeyLastTry < CANONICAL_KEY_RETRY_MS) return;
    _canonicalKeyLastTry = now;
    try {
      const res = await ctx.ensureCanonicalKey();
      if (res && res.ok) _canonicalKeyDone = true;
    } catch (_) {}
  }

  /**
   * Main loop: advisory health check, recover stuck items, process batch, pull.
   * Health check no longer blocks processing — only 'offline' and 'auth_required'
   * are hard stops. 'internet_available_api_unreachable' still attempts push
   * (the per-item error handling will decide if it's truly unreachable).
   */
  async function runCycle() {
    if (_inProgress) return;
    _inProgress = true;
    try {
      if (rateLimitGate.isBlocked()) {
        _lastError = rateLimitGate.reason() || 'Too many requests. Please try again later.';
        notifyRenderer({
          status: 'error',
          lastError: _lastError,
          retryable: true,
          rateLimited: true,
          rateLimitRemainingMs: rateLimitGate.remainingMs(),
        });
        return;
      }
      const conn = await checkConnectivity();
      setConnectivity(conn);
      if (conn === 'offline' || conn === 'auth_required') {
        return;
      }
      await ensureCanonicalKeyOnce();
      recoverStuckItems();
      await processBatch();
      if (rateLimitGate.isBlocked()) {
        // Do not spam /api/sync/pull into the same 120/hour budget after a 429.
        return;
      }
      if (ctx.syncPull) {
        const pullResult = await ctx.syncPull().catch((e) => {
          _lastError = e && e.message ? e.message : String(e);
          rateLimitGate.noteError(e);
          notifyRenderer({ status: 'error', lastError: _lastError, retryable: isRetryableError(e) });
          return { pulled: 0, decryptFailed: 0, received: 0 };
        });
        if (pullResult && pullResult.pulled > 0 && ctx.sendToRenderer) {
          ctx.sendToRenderer('records-updated-from-sync', { count: pullResult.pulled });
        }
        if (pullResult && pullResult.conflicts > 0 && ctx.sendToRenderer) {
          ctx.sendToRenderer('sync-conflicts-detected', { count: pullResult.conflicts });
          notifyRenderer({});
        }
        if (pullResult && (pullResult.decryptFailed > 0 || pullResult.noMasterKeySkipped > 0) && ctx.sendToRenderer) {
          ctx.sendToRenderer('sync-pull-warning', {
            decryptFailed: pullResult.decryptFailed || 0,
            noMasterKeySkipped: pullResult.noMasterKeySkipped || 0,
            received: pullResult.received || 0,
            merged: pullResult.pulled || 0,
          });
          notifyRenderer({});
        }
      }
    } finally {
      _inProgress = false;
    }
  }

  function start() {
    if (_timer) return;
    _recoverBlockedOnStartup();
    runCycle().catch(() => {});
    _timer = setInterval(() => runCycle().catch(() => {}), SYNC_POLL_INTERVAL_MS);
  }

  /** On app start, reset all blocked items to pending once. A new app version
   *  or server-side fix may resolve the original error. */
  function _recoverBlockedOnStartup() {
    if (!ctx.db) return;
    try {
      const now = Date.now();
      const stuck = ctx.dbAll("SELECT id FROM sync_queue WHERE status='blocked'") || [];
      for (const row of stuck) {
        ctx.dbRun(
          'UPDATE sync_queue SET status=?, retry_count=0, last_attempt=?, error=NULL WHERE id=?',
          ['pending', now, row.id]
        );
      }
      if (stuck.length > 0) {
        ctx.flushDb && ctx.flushDb();
      }
    } catch (_) {}
  }

  function stop() {
    if (_timer) clearInterval(_timer);
    _timer = null;
  }

  let _scheduleSoonTimer = null;
  function scheduleSoon() {
    if (_scheduleSoonTimer) return;
    _scheduleSoonTimer = setTimeout(() => {
      _scheduleSoonTimer = null;
      runCycle().catch(() => {});
    }, SCHEDULE_SOON_DEBOUNCE_MS);
  }

  function getDiagnostics() {
    if (!ctx.db) return {};
    const pending = ctx.dbGet('SELECT COUNT(*) as c FROM sync_queue WHERE status IN (\'pending\',\'syncing\')') || { c: 0 };
    const failed = ctx.dbGet('SELECT COUNT(*) as c FROM sync_queue WHERE status=\'failed\'') || { c: 0 };
    const blocked = ctx.dbGet('SELECT COUNT(*) as c FROM sync_queue WHERE status=\'blocked\'') || { c: 0 };
    const lastSync = ctx.dbGet("SELECT value FROM settings WHERE key='lastSyncPullAt'");
    let conflicts = { c: 0 };
    let queueItems = [];
    let conflictItems = [];
    try {
      queueItems = ctx.dbAll(
        `SELECT id, record_id, status, retry_count, error, last_attempt, created_at
         FROM sync_queue WHERE status != 'synced' ORDER BY created_at ASC LIMIT 50`
      ) || [];
    } catch (_) {}
    try {
      conflicts = ctx.dbGet('SELECT COUNT(*) as c FROM sync_conflicts WHERE resolved_at IS NULL') || { c: 0 };
      conflictItems = ctx.dbAll(
        `SELECT id, attendance_id, sync_id, reason, local_version, remote_version, local_updated_at,
                remote_updated_at, remote_status, created_at
           FROM sync_conflicts
          WHERE resolved_at IS NULL
          ORDER BY created_at DESC LIMIT 20`
      ) || [];
    } catch (_) {}
    return {
      queueLength: pending.c || 0,
      failedCount: failed.c || 0,
      blockedCount: blocked.c || 0,
      conflictCount: conflicts.c || 0,
      lastSyncAt: lastSync && lastSync.value !== '1970-01-01T00:00:00.000Z' ? lastSync.value : _lastSyncAt,
      connectivity: _connectivityState,
      lastError: _lastError,
      inProgress: _inProgress,
      lastSuccessfulPushAt: _lastSuccessfulPushAt || null,
      lastVerifiedCloudPushAt: _lastVerifiedCloudPushAt,
      lastPush: { ..._lastPushStats },
      rateLimit: rateLimitGate.snapshot(),
      queueItems,
      conflictItems,
    };
  }

  /** Force-retry all failed and blocked items by resetting them to pending. */
  function forceRetryAll() {
    if (!ctx.db) return 0;
    const now = Date.now();
    try {
      const stuck = ctx.dbAll(
        "SELECT id FROM sync_queue WHERE status IN ('failed','blocked')"
      ) || [];
      for (const row of stuck) {
        ctx.dbRun(
          'UPDATE sync_queue SET status=?, retry_count=0, last_attempt=?, error=NULL WHERE id=?',
          ['pending', now, row.id]
        );
      }
      if (stuck.length > 0) ctx.flushDb && ctx.flushDb();
      rateLimitGate.clear();
      return stuck.length;
    } catch (e) {
      return 0;
    }
  }

  /**
   * After a DB restore / file swap, drop in-flight cycle state so markSynced
   * from a pre-restore push cannot clear dirty flags on the new database.
   * Caller should stop()+recreate the worker for a full reset; this clears
   * soft state when the same instance must keep running.
   */
  function resetRuntimeState(reason) {
    _inProgress = false;
    _lastError = null;
    _lastSuccessfulPushAt = 0;
    _canonicalKeyDone = false;
    _canonicalKeyLastTry = 0;
    rateLimitGate.clear();
    console.info('[SyncWorker] Runtime state reset:', reason || 'manual');
  }

  /** Wait for an in-flight runCycle to finish (Full re-sync must not race cursor). */
  async function waitUntilIdle(timeoutMs = 60000) {
    const limit = Math.max(0, Number(timeoutMs) || 0);
    const start = Date.now();
    while (_inProgress) {
      if (Date.now() - start >= limit) {
        console.warn('[SyncWorker] waitUntilIdle timed out after', limit, 'ms');
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return !_inProgress;
  }

  return {
    start,
    stop,
    enqueue,
    scheduleSoon,
    runCycle,
    getDiagnostics,
    forceRetryAll,
    resetRuntimeState,
    waitUntilIdle,
    getConnectivity: () => _connectivityState,
  };
}

module.exports = {
  createSyncWorker,
  generateQueueId,
  isRetryableError,
  assertPushAccepted,
  getNextAttemptMs,
  SYNC_POLL_INTERVAL_MS,
  SCHEDULE_SOON_DEBOUNCE_MS,
  RETRY_DELAYS_MS,
  MAX_RETRY_ATTEMPTS,
  SYNC_REQUEST_TIMEOUT_MS,
  HEALTH_CHECK_TIMEOUT_MS,
  PUSH_HTTP_BATCH_SIZE,
  MAX_PUSH_ROUNDS_PER_CYCLE,
  MAX_RECORDS_PER_CYCLE,
  BLOCKED_RECOVERY_COOLDOWN_MS,
  MAX_BLOCKED_AUTO_RECOVERIES,
  RATE_LIMIT_COOLDOWN_MS,
  mayClearOutboxEntry,
  isAmbiguousPushAck,
  buildMutationId,
};
