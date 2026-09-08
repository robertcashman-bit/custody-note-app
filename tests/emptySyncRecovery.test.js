'use strict';

/**
 * Comprehensive regression coverage for the 2026-09 Custody Note
 * empty-Windows / empty-cloud data-integrity incident.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const {
  createSyncWorker,
  isRetryableError,
  RATE_LIMIT_COOLDOWN_MS,
} = require('../main/syncWorker');
const {
  assertPushAccepted,
  createRateLimitGate,
} = require('../lib/syncPushAck');
const {
  detectEmptyLargeDb,
  detectLocalFullCloudEmpty,
  shouldSuppressSyncedFooter,
  deriveSyncPhase,
  EMPTY_LARGE_DB_BYTES,
} = require('../lib/syncRecoveryHints');

const root = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const inventoryScript = fs.readFileSync(path.join(root, 'scripts/inventory-sync-storage.mjs'), 'utf8');
const rcaDoc = fs.readFileSync(path.join(root, 'docs/EMPTY_SYNC_INCIDENT_RCA.md'), 'utf8');

describe('PRESERVE — inventory tooling is read-only', () => {
  it('inventory script documents non-destructive behaviour', () => {
    assert.match(inventoryScript, /READ-ONLY/);
    assert.match(inventoryScript, /Does NOT decrypt/);
    assert.doesNotMatch(inventoryScript, /unlinkSync|rmSync|writeFileSync\(.*attendances/);
    assert.match(inventoryScript, /Re-upload all local records/);
  });

  it('RCA documents Mac as primary recovery source', () => {
    assert.match(rcaDoc, /Mac Air/);
    assert.match(rcaDoc, /written/);
    assert.match(rcaDoc, /120\/hour/);
  });
});

describe('Push ack — durable write required before dirty clear', () => {
  it('rejects omitted written / written:0 / partial written', () => {
    assert.throws(() => assertPushAccepted({ ok: true }, 3), (e) => e.code === 'PUSH_INCOMPLETE');
    assert.throws(() => assertPushAccepted({ ok: true, written: 0 }, 3), (e) => e.code === 'PUSH_INCOMPLETE');
    assert.throws(() => assertPushAccepted({ ok: true, written: 1 }, 3), (e) => e.code === 'PUSH_INCOMPLETE');
  });

  it('accepts matching written count and array form', () => {
    assert.doesNotThrow(() => assertPushAccepted({ ok: true, written: 3 }, 3));
    assert.doesNotThrow(() => assertPushAccepted({ ok: true, written: ['a', 'b', 'c'] }, 3));
  });

  it('maps Too many requests body to 429', () => {
    assert.throws(
      () => assertPushAccepted({ ok: false, error: 'Too many requests. Please try again later.' }, 1),
      (e) => e.statusCode === 429
    );
    assert.strictEqual(isRetryableError(new Error('Too many requests. Please try again later.')), true);
  });
});

describe('429 rate-limit gate — do not spam push/pull', () => {
  it('blocks for cooldown after 429 then clears', () => {
    let now = 1_000_000;
    const gate = createRateLimitGate({ cooldownMs: 60_000, now: () => now });
    assert.strictEqual(gate.isBlocked(), false);
    gate.noteError({ statusCode: 429, message: 'Too many requests' });
    assert.strictEqual(gate.isBlocked(), true);
    assert.ok(gate.remainingMs() > 0);
    now += 61_000;
    assert.strictEqual(gate.isBlocked(), false);
  });

  it('exports a multi-minute default cooldown', () => {
    assert.ok(RATE_LIMIT_COOLDOWN_MS >= 60_000);
  });
});

describe('Recovery heuristics', () => {
  it('detects Windows-sized empty DB', () => {
    assert.strictEqual(detectEmptyLargeDb({ dbFileBytes: 7573 * 1024, activeAttendanceCount: 0 }), true);
    assert.strictEqual(detectEmptyLargeDb({ dbFileBytes: EMPTY_LARGE_DB_BYTES - 1, activeAttendanceCount: 0 }), false);
  });

  it('flags local-full cloud-empty only after a from-epoch pull with received=0', () => {
    assert.strictEqual(
      detectLocalFullCloudEmpty({
        totalRecords: 66,
        pendingChanges: 0,
        dirtyPushCount: 0,
        lastPullReceived: 0,
        pullEverCompleted: true,
        pulledFromEpoch: true,
      }),
      true
    );
    assert.strictEqual(
      detectLocalFullCloudEmpty({
        totalRecords: 66,
        pendingChanges: 0,
        dirtyPushCount: 0,
        lastPullReceived: 0,
        pullEverCompleted: true,
        pulledFromEpoch: false,
      }),
      false,
      'incremental pull with no deltas must not look like an empty cloud'
    );
    assert.strictEqual(
      detectLocalFullCloudEmpty({
        totalRecords: 66,
        pendingChanges: 0,
        dirtyPushCount: 0,
        lastPullReceived: 0,
        pullEverCompleted: false,
        pulledFromEpoch: true,
      }),
      false
    );
    assert.strictEqual(
      detectLocalFullCloudEmpty({
        totalRecords: 66,
        pendingChanges: 3,
        dirtyPushCount: 0,
        lastPullReceived: 0,
        pullEverCompleted: true,
        pulledFromEpoch: true,
      }),
      false
    );
  });

  it('detects local-full cloud-empty and suppresses calm Synced footer', () => {
    const args = {
      totalRecords: 66,
      pendingChanges: 0,
      dirtyPushCount: 0,
      lastPullReceived: 0,
      pullEverCompleted: true,
      pulledFromEpoch: true,
      lastVerifiedCloudPushAt: null,
    };
    assert.strictEqual(detectLocalFullCloudEmpty(args), true);
    assert.strictEqual(shouldSuppressSyncedFooter(args), true);
    assert.strictEqual(deriveSyncPhase(args), 'local_saved');
  });

  it('deriveSyncPhase maps pending / rate-limited / synced honestly', () => {
    assert.strictEqual(deriveSyncPhase({ inProgress: true, totalRecords: 1 }), 'syncing');
    assert.strictEqual(deriveSyncPhase({ pendingChanges: 3, totalRecords: 66 }), 'pending');
    assert.strictEqual(deriveSyncPhase({ rateLimited: true, totalRecords: 66 }), 'failed');
    assert.strictEqual(
      deriveSyncPhase({
        totalRecords: 66,
        pendingChanges: 0,
        dirtyPushCount: 0,
        lastPullReceived: 5,
        pullEverCompleted: true,
        lastVerifiedCloudPushAt: '2026-09-08T00:00:00.000Z',
      }),
      'synced'
    );
  });
});

async function initDb() {
  const SQL = await initSqlJs();
  const d = new SQL.Database();
  d.run(`CREATE TABLE sync_queue (
    id TEXT PRIMARY KEY, record_id TEXT NOT NULL, operation TEXT DEFAULT 'upsert',
    payload TEXT, created_at INTEGER NOT NULL, retry_count INTEGER DEFAULT 0,
    last_attempt INTEGER NOT NULL, status TEXT DEFAULT 'pending', error TEXT
  );`);
  d.run(`CREATE TABLE attendances (
    id INTEGER PRIMARY KEY AUTOINCREMENT, sync_id TEXT, data TEXT, status TEXT,
    created_at TEXT, updated_at TEXT, deleted_at TEXT, deletion_reason TEXT,
    client_name TEXT, station_name TEXT, dscc_ref TEXT, attendance_date TEXT,
    supervisor_approved_at TEXT, supervisor_note TEXT, archived_at TEXT,
    sync_dirty INTEGER, sync_version INTEGER
  );`);
  d.run(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);`);
  d.run(`CREATE TABLE sync_conflicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, attendance_id INTEGER, sync_id TEXT,
    reason TEXT, local_version INTEGER, remote_version INTEGER,
    local_updated_at TEXT, remote_updated_at TEXT, remote_status TEXT,
    created_at TEXT, resolved_at TEXT, resolution_note TEXT
  );`);
  return d;
}

function dbApi(db) {
  return {
    dbRun(sql, params = []) { db.run(sql, params); },
    dbGet(sql, params = []) {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      const row = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();
      return row;
    },
    dbAll(sql, params = []) {
      const rows = [];
      const stmt = db.prepare(sql);
      stmt.bind(params);
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
    flushDb() {},
  };
}

describe('Sync worker — dirty retention + push logging + 429 pause', () => {
  it('keeps sync_dirty=1 when ok:true written:0 and logs failed push', async () => {
    const db = await initDb();
    const api = dbApi(db);
    const now = new Date().toISOString();
    api.dbRun(
      `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
       VALUES (?,?,?,?,?,?,1,1)`,
      ['sid-empty-write', '{}', 'draft', now, now, 'Client']
    );
    const row = api.dbGet('SELECT id FROM attendances');
    const attempts = [];
    const worker = createSyncWorker({
      ...api,
      db,
      getSyncApiUrl: () => 'http://127.0.0.1:9',
      readLicenceData: () => ({ key: 'CN-A-TEST-0532' }),
      getMachineId: () => 'machine-a',
      getMasterKeyHex: () => 'a'.repeat(64),
      httpPost: async () => ({ ok: true, written: 0 }),
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      syncPull: async () => ({ pulled: 0, received: 0 }),
      ensureCanonicalKey: async () => ({ ok: true }),
      logSyncAttempt: (_id, dir, count, ok, err) => attempts.push({ dir, count, ok, err }),
      sendToRenderer: () => {},
    });
    worker.enqueue(String(row.id), 'upsert', {});
    await worker.runCycle();
    assert.strictEqual(api.dbGet('SELECT sync_dirty FROM attendances').sync_dirty, 1);
    assert.ok(attempts.some((a) => a.dir === 'push' && a.ok === false));
    const diag = worker.getDiagnostics();
    assert.strictEqual(diag.lastPush.ok, false);
    assert.strictEqual(diag.lastSuccessfulPushAt, null);
  });

  it('429 pauses subsequent cycles without clearing dirty', async () => {
    const db = await initDb();
    const api = dbApi(db);
    const now = new Date().toISOString();
    api.dbRun(
      `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
       VALUES (?,?,?,?,?,?,1,1)`,
      ['sid-429', '{}', 'draft', now, now, 'Client']
    );
    const row = api.dbGet('SELECT id FROM attendances');
    let posts = 0;
    const worker = createSyncWorker({
      ...api,
      db,
      rateLimitCooldownMs: 60_000,
      getSyncApiUrl: () => 'http://127.0.0.1:9',
      readLicenceData: () => ({ key: 'CN-A-TEST-0532' }),
      getMachineId: () => 'machine-a',
      getMasterKeyHex: () => 'a'.repeat(64),
      httpPost: async () => {
        posts++;
        const err = new Error('Too many requests. Please try again later.');
        err.statusCode = 429;
        throw err;
      },
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      syncPull: async () => ({ pulled: 0, received: 0 }),
      ensureCanonicalKey: async () => ({ ok: true }),
      sendToRenderer: () => {},
    });
    worker.enqueue(String(row.id), 'upsert', {});
    await worker.runCycle();
    assert.ok(posts >= 1);
    await worker.runCycle();
    assert.strictEqual(posts, 1, 'second cycle must not hit network while rate-limited');
    assert.strictEqual(api.dbGet('SELECT sync_dirty FROM attendances').sync_dirty, 1);
    assert.strictEqual(worker.getDiagnostics().rateLimit.blocked, true);
  });

  it('successful confirmed write clears dirty and records lastPush', async () => {
    const db = await initDb();
    const api = dbApi(db);
    const now = new Date().toISOString();
    api.dbRun(
      `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
       VALUES (?,?,?,?,?,?,1,1)`,
      ['sid-ok', '{}', 'draft', now, now, 'Client']
    );
    const row = api.dbGet('SELECT id FROM attendances');
    const worker = createSyncWorker({
      ...api,
      db,
      getSyncApiUrl: () => 'http://127.0.0.1:9',
      readLicenceData: () => ({ key: 'CN-A-TEST-0532' }),
      getMachineId: () => 'machine-a',
      getMasterKeyHex: () => 'a'.repeat(64),
      httpPost: async (_url, body) => ({
        ok: true,
        written: body && body.records ? body.records.length : 1,
      }),
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      syncPull: async () => ({ pulled: 0, received: 0 }),
      ensureCanonicalKey: async () => ({ ok: true }),
      sendToRenderer: () => {},
    });
    worker.enqueue(String(row.id), 'upsert');
    await worker.runCycle();
    assert.strictEqual(api.dbGet('SELECT sync_dirty FROM attendances').sync_dirty, 0);
    assert.strictEqual(worker.getDiagnostics().lastPush.ok, true);
    assert.ok(worker.getDiagnostics().lastVerifiedCloudPushAt);
  });

  it('resetRuntimeState clears rate-limit and in-progress flags after DB swap', async () => {
    const db = await initDb();
    const api = dbApi(db);
    const worker = createSyncWorker({
      ...api,
      db,
      rateLimitCooldownMs: 60_000,
      getSyncApiUrl: () => 'http://127.0.0.1:9',
      readLicenceData: () => ({ key: 'CN-A-TEST-0532' }),
      getMachineId: () => 'machine-a',
      getMasterKeyHex: () => 'a'.repeat(64),
      httpPost: async () => {
        const err = new Error('Too many requests');
        err.statusCode = 429;
        throw err;
      },
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      syncPull: async () => ({ pulled: 0, received: 0 }),
      ensureCanonicalKey: async () => ({ ok: true }),
      sendToRenderer: () => {},
    });
    api.dbRun(
      `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
       VALUES (?,?,?,?,?,?,1,1)`,
      ['sid-reset', '{}', 'draft', new Date().toISOString(), new Date().toISOString(), 'Client']
    );
    const row = api.dbGet('SELECT id FROM attendances');
    worker.enqueue(String(row.id), 'upsert');
    await worker.runCycle();
    assert.strictEqual(worker.getDiagnostics().rateLimit.blocked, true);
    worker.resetRuntimeState('local-restore');
    assert.strictEqual(worker.getDiagnostics().rateLimit.blocked, false);
    assert.strictEqual(worker.getDiagnostics().inProgress, false);
    assert.strictEqual(worker.getDiagnostics().lastError, null);
  });
});

describe('Re-upload / restore product wiring', () => {
  it('main exposes reupload, worker reset, CLOUD_EMPTY_AFTER_PUSH, backup ensure', () => {
    assert.match(mainJs, /function markAllLocalRecordsForCloudReupload/);
    assert.match(mainJs, /function resetSyncWorkerAfterDbSwap/);
    assert.match(mainJs, /CLOUD_EMPTY_AFTER_PUSH/);
    assert.match(mainJs, /resetSyncWorkerAfterDbSwap\('local-restore'\)/);
    assert.match(mainJs, /resetSyncWorkerAfterDbSwap\('cloud-restore'\)/);
    assert.match(mainJs, /sync_version=COALESCE\(sync_version,1\)\+1 WHERE deleted_at IS NULL/);
    assert.match(mainJs, /function buildSyncRecoveryHints/);
    assert.match(mainJs, /pulledFromEpoch/);
    assert.match(mainJs, /ensureBackupFolderExists\(\)/);
    assert.match(mainJs, /markDbDirty[\s\S]{0,400}ensureBackupFolderExists/);
    assert.match(mainJs, /logSyncAttempt,/);
    assert.match(mainJs, /scheduleAutoFullResyncIfEmpty/);
    assert.match(mainJs, /emptyLarge/);
  });

  it('UI + preload expose re-upload and recovery surfaces', () => {
    assert.match(preloadJs, /syncReuploadAll/);
    assert.match(indexHtml, /btn-sync-reupload-all/);
    assert.match(indexHtml, /home-empty-db-recovery/);
    assert.match(appJs, /Rate limited/);
    assert.match(appJs, /Cloud may be empty|DB empty/);
    assert.match(appJs, /Backup folder missing/);
  });

  it('restore bumps sync_version for all non-deleted rows', () => {
    const idx = mainJs.indexOf("ipcMain.handle('local-backup-restore'");
    const body = mainJs.slice(idx, idx + 4000);
    assert.match(body, /sync_version=COALESCE\(sync_version,1\)\+1 WHERE deleted_at IS NULL/);
    assert.match(body, /marked,\s*queued/);
  });
});

describe('Mark-all-dirty SQL (re-upload / restore semantics)', () => {
  it('marks every non-deleted attendance and rebuilds queue count', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(`CREATE TABLE attendances (
      id INTEGER PRIMARY KEY AUTOINCREMENT, sync_id TEXT, data TEXT, deleted_at TEXT,
      sync_dirty INTEGER DEFAULT 0, sync_version INTEGER DEFAULT 1
    );`);
    db.run(`CREATE TABLE sync_queue (
      id TEXT PRIMARY KEY, record_id TEXT, operation TEXT, payload TEXT,
      created_at INTEGER, retry_count INTEGER, last_attempt INTEGER, status TEXT, error TEXT
    );`);
    for (let i = 0; i < 66; i++) {
      db.run(`INSERT INTO attendances (sync_id, data, sync_dirty, sync_version) VALUES (?,?,0,1)`, ['s' + i, '{}']);
    }
    db.run(`INSERT INTO attendances (sync_id, data, deleted_at, sync_dirty) VALUES ('gone','{}','2026-01-01',0)`);
    db.run('UPDATE attendances SET sync_dirty=1, sync_version=COALESCE(sync_version,1)+1 WHERE deleted_at IS NULL');
    const dirty = db.exec('SELECT COUNT(*) FROM attendances WHERE sync_dirty=1 AND deleted_at IS NULL')[0].values[0][0];
    assert.strictEqual(dirty, 66);
    db.run('DELETE FROM sync_queue');
    const rows = db.exec('SELECT id FROM attendances WHERE sync_dirty=1')[0].values;
    const now = Date.now();
    for (const [id] of rows) {
      db.run(
        'INSERT INTO sync_queue (id, record_id, operation, payload, created_at, retry_count, last_attempt, status) VALUES (?,?,?,?,?,0,?,?)',
        ['sq-' + id, String(id), 'upsert', '{}', now, now, 'pending']
      );
    }
    assert.strictEqual(db.exec('SELECT COUNT(*) FROM sync_queue')[0].values[0][0], 66);
  });
});
