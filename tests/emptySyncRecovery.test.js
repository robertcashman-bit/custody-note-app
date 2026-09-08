'use strict';

/**
 * Regression tests for the 2026-09 empty-Windows-after-cross-device-sync incident.
 *
 * Verified failure modes (not a single root cause):
 * 1. Push ok:true with written:0 / incomplete write must NOT clear sync_dirty.
 * 2. Rate-limit body ("Too many requests") must stay retryable.
 * 3. Local-full / cloud-empty and empty-large-DB heuristics must fire.
 * 4. Re-upload-all path must mark dirty + rebuild queue (raw DB swap does not).
 * 5. Settings / preload / footer wiring for recovery actions must exist.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const {
  createSyncWorker,
  assertPushAccepted,
  isRetryableError,
} = require('../main/syncWorker');
const {
  detectEmptyLargeDb,
  detectLocalFullCloudEmpty,
  EMPTY_LARGE_DB_BYTES,
} = require('../lib/syncRecoveryHints');

const root = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

describe('assertPushAccepted — incomplete cloud write', () => {
  it('rejects ok:true when written is omitted (unconfirmed write)', () => {
    assert.throws(
      () => assertPushAccepted({ ok: true }, 3),
      (err) => err && err.code === 'PUSH_INCOMPLETE' && /omitted written/i.test(err.message)
    );
  });

  it('accepts ok:true when written matches sent count', () => {
    assert.doesNotThrow(() => assertPushAccepted({ ok: true, written: 2 }, 2));
    assert.doesNotThrow(() => assertPushAccepted({ ok: true, written: ['a', 'b'] }, 2));
  });

  it('rejects ok:true with written:0 so dirty is not cleared', () => {
    assert.throws(
      () => assertPushAccepted({ ok: true, written: 0 }, 5),
      (err) => err && err.code === 'PUSH_INCOMPLETE' && /0 records/i.test(err.message)
    );
  });

  it('rejects ok:true with written < sent', () => {
    assert.throws(
      () => assertPushAccepted({ ok: true, written: 1 }, 5),
      (err) => err && err.code === 'PUSH_INCOMPLETE' && /1 of 5/i.test(err.message)
    );
  });

  it('rejects ok:false Too many requests as 429', () => {
    assert.throws(
      () => assertPushAccepted({ ok: false, error: 'Too many requests. Please try again later.' }, 2),
      (err) => err && err.statusCode === 429 && /too many requests/i.test(err.message)
    );
  });
});

describe('isRetryableError — rate limit body', () => {
  it('treats Too many requests message as retryable even without statusCode', () => {
    assert.strictEqual(
      isRetryableError(new Error('Too many requests. Please try again later.')),
      true
    );
  });

  it('treats PUSH_INCOMPLETE as retryable', () => {
    const err = new Error('Push accepted 0 records (cloud write empty)');
    err.code = 'PUSH_INCOMPLETE';
    assert.strictEqual(isRetryableError(err), true);
  });
});

describe('sync recovery heuristics', () => {
  it('flags empty large DB like the Windows 7.5MB / No records yet case', () => {
    assert.strictEqual(
      detectEmptyLargeDb({ dbFileBytes: 7573 * 1024, activeAttendanceCount: 0 }),
      true
    );
    assert.strictEqual(
      detectEmptyLargeDb({ dbFileBytes: EMPTY_LARGE_DB_BYTES - 1, activeAttendanceCount: 0 }),
      false
    );
    assert.strictEqual(
      detectEmptyLargeDb({ dbFileBytes: 7573 * 1024, activeAttendanceCount: 66 }),
      false
    );
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
});

describe('sync worker — written:0 must not clear dirty', () => {
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

  it('keeps sync_dirty=1 when server returns ok:true without written', async () => {
    const db = await initDb();
    const api = dbApi(db);
    const now = new Date().toISOString();
    api.dbRun(
      `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
       VALUES (?,?,?,?,?,?,1,1)`,
      ['sid-omit', '{}', 'draft', now, now, 'Omit Client']
    );
    const row = api.dbGet('SELECT id FROM attendances');
    const attempts = [];
    const worker = createSyncWorker({
      ...api,
      db,
      getSyncApiUrl: () => 'http://127.0.0.1:9',
      readLicenceData: () => ({ key: 'SYNC-TEST-0001-KEY1' }),
      getMachineId: () => 'machine-a',
      getMasterKeyHex: () => 'a'.repeat(64),
      httpPost: async () => ({ ok: true }),
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      syncPull: async () => ({ pulled: 0, received: 0, decryptFailed: 0 }),
      ensureCanonicalKey: async () => ({ ok: true }),
      logSyncAttempt: (id, dir, count, ok, err) => attempts.push({ id, dir, count, ok, err }),
      onStatusChange: () => {},
      sendToRenderer: () => {},
    });
    worker.enqueue(String(row.id), 'upsert', {});
    await worker.runCycle();
    const after = api.dbGet('SELECT sync_dirty FROM attendances WHERE id=?', [row.id]);
    assert.strictEqual(after.sync_dirty, 1);
    assert.ok(attempts.some((a) => a.dir === 'push' && a.ok === false));
  });

  it('keeps sync_dirty=1 when server returns ok:true written:0', async () => {
    const db = await initDb();
    const api = dbApi(db);
    const now = new Date().toISOString();
    api.dbRun(
      `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
       VALUES (?,?,?,?,?,?,1,1)`,
      ['sid-1', '{}', 'draft', now, now, 'Test Client']
    );
    const row = api.dbGet('SELECT id FROM attendances');
    const worker = createSyncWorker({
      ...api,
      db,
      getSyncApiUrl: () => 'http://127.0.0.1:9',
      readLicenceData: () => ({ key: 'SYNC-TEST-0001-KEY1' }),
      getMachineId: () => 'machine-a',
      getMasterKeyHex: () => 'a'.repeat(64),
      httpPost: async () => ({ ok: true, written: 0 }),
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      syncPull: async () => ({ pulled: 0, received: 0, decryptFailed: 0 }),
      ensureCanonicalKey: async () => ({ ok: true }),
      onStatusChange: () => {},
      sendToRenderer: () => {},
    });
    worker.enqueue(String(row.id), 'upsert', {});
    await worker.runCycle();
    const after = api.dbGet('SELECT sync_dirty FROM attendances WHERE id=?', [row.id]);
    assert.strictEqual(after.sync_dirty, 1, 'dirty must remain set after empty cloud write');
    const q = api.dbGet("SELECT status, error FROM sync_queue WHERE record_id=?", [String(row.id)]);
    assert.ok(q, 'queue row exists');
    assert.notStrictEqual(q.status, 'synced');
    assert.match(String(q.error || ''), /0 records|incomplete|Push/i);
  });
});

describe('re-upload-all product wiring', () => {
  it('main.js defines markAllLocalRecordsForCloudReupload and sync-reupload-all IPC', () => {
    assert.match(mainJs, /function markAllLocalRecordsForCloudReupload/);
    assert.match(mainJs, /ipcMain\.handle\('sync-reupload-all'/);
    assert.match(mainJs, /CLOUD_EMPTY_AFTER_PUSH/);
    assert.match(mainJs, /sync_version=COALESCE\(sync_version,1\)\+1 WHERE deleted_at IS NULL/);
    assert.match(mainJs, /function buildSyncRecoveryHints/);
    assert.match(mainJs, /pulledFromEpoch/);
    assert.match(mainJs, /ensureBackupFolderExists\(\)/);
    assert.match(mainJs, /markDbDirty[\s\S]{0,400}ensureBackupFolderExists/);
    assert.match(mainJs, /logSyncAttempt,/);
  });

  it('local restore bumps sync_version and returns marked/queued counts', () => {
    const idx = mainJs.indexOf("ipcMain.handle('local-backup-restore'");
    assert.ok(idx > 0);
    const body = mainJs.slice(idx, idx + 3500);
    assert.match(body, /sync_version=COALESCE\(sync_version,1\)\+1 WHERE deleted_at IS NULL/);
    assert.match(body, /marked,\s*queued/);
  });

  it('preload exposes syncReuploadAll', () => {
    assert.match(preloadJs, /syncReuploadAll:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('sync-reupload-all'\)/);
  });

  it('Settings UI offers Re-upload all local records to cloud', () => {
    assert.match(indexHtml, /id="btn-sync-reupload-all"/);
    assert.match(indexHtml, /Re-upload all local records to cloud/);
    assert.match(indexHtml, /id="home-empty-db-recovery"/);
    assert.match(appJs, /btn-sync-reupload-all/);
    assert.match(appJs, /syncReuploadAll/);
    assert.match(appJs, /Cloud may be empty|DB empty — recover|No remote records/);
    assert.match(appJs, /Backup folder missing/);
  });
});

describe('mark-all-dirty SQL behaviour (mirrors main.js re-upload)', () => {
  it('marks every non-deleted attendance dirty and rebuilds sync_queue', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(`CREATE TABLE attendances (
      id INTEGER PRIMARY KEY AUTOINCREMENT, sync_id TEXT, data TEXT, status TEXT DEFAULT 'draft',
      deleted_at TEXT, sync_dirty INTEGER DEFAULT 0, sync_version INTEGER DEFAULT 1
    );`);
    db.run(`CREATE TABLE sync_queue (
      id TEXT PRIMARY KEY, record_id TEXT, operation TEXT, payload TEXT,
      created_at INTEGER, retry_count INTEGER, last_attempt INTEGER, status TEXT, error TEXT
    );`);
    db.run(`INSERT INTO attendances (sync_id, data, sync_dirty, sync_version) VALUES ('a','{}',0,1)`);
    db.run(`INSERT INTO attendances (sync_id, data, sync_dirty, sync_version) VALUES ('b','{}',0,2)`);
    db.run(`INSERT INTO attendances (sync_id, data, deleted_at, sync_dirty, sync_version)
            VALUES ('c','{}','2026-01-01',0,1)`);

    db.run(
      'UPDATE attendances SET sync_dirty=1, sync_version=COALESCE(sync_version,1)+1 WHERE deleted_at IS NULL'
    );
    const dirty = db.exec('SELECT COUNT(*) FROM attendances WHERE sync_dirty=1 AND deleted_at IS NULL')[0].values[0][0];
    assert.strictEqual(dirty, 2);
    const versions = db.exec('SELECT sync_id, sync_version FROM attendances WHERE deleted_at IS NULL ORDER BY sync_id');
    assert.deepStrictEqual(versions[0].values, [['a', 2], ['b', 3]]);

    db.run('DELETE FROM sync_queue');
    const rows = db.exec('SELECT id FROM attendances WHERE sync_dirty=1')[0].values;
    const now = Date.now();
    for (const [id] of rows) {
      const qid = 'sq-' + id;
      db.run(
        'INSERT INTO sync_queue (id, record_id, operation, payload, created_at, retry_count, last_attempt, status) VALUES (?,?,?,?,?,0,?,?)',
        [qid, String(id), 'upsert', '{}', now, now, 'pending']
      );
    }
    const queued = db.exec('SELECT COUNT(*) FROM sync_queue')[0].values[0][0];
    assert.strictEqual(queued, 2);
  });
});
