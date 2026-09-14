'use strict';

/**
 * tests/staleSyncCatchUpRunner.test.js
 * Bulk auto-accept + Fix sync now orchestration (no Electron).
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const initSqlJs = require('sql.js');
const {
  autoAcceptRemoteNewerConflicts,
  runStaleDeviceCatchUp,
  runFixSyncNow,
  stampSeenAppVersion,
  SETTINGS_LAST_SEEN_APP_VERSION,
} = require('../main/staleSyncCatchUpRunner');
const { resolveConflictsBulk, listOpenConflicts } = require('../main/syncConflicts');

let db;

function dbRun(sql, params = []) { db.run(sql, params); }
function dbGet(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}
function dbAll(sql, params = []) {
  const rows = [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

async function makeDb() {
  const SQL = await initSqlJs();
  db = new SQL.Database();
  db.run(`CREATE TABLE attendances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT, status TEXT DEFAULT 'draft',
    created_at TEXT, updated_at TEXT,
    deleted_at TEXT, deletion_reason TEXT,
    client_name TEXT DEFAULT '', station_name TEXT DEFAULT '',
    dscc_ref TEXT DEFAULT '', attendance_date TEXT DEFAULT '',
    supervisor_approved_at TEXT, supervisor_note TEXT DEFAULT '',
    archived_at TEXT, sync_id TEXT, sync_dirty INTEGER DEFAULT 0, sync_version INTEGER DEFAULT 1
  );`);
  db.run(`CREATE TABLE sync_conflicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attendance_id INTEGER, sync_id TEXT, reason TEXT,
    local_version INTEGER DEFAULT 0, remote_version INTEGER DEFAULT 0,
    local_updated_at TEXT, remote_updated_at TEXT, remote_status TEXT,
    local_snapshot TEXT, remote_snapshot TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT DEFAULT NULL, resolution_note TEXT DEFAULT ''
  );`);
  db.run(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);`);
}

function seedAttendance({ status = 'draft', version = 1, data = '{"x":1}', dirty = 0 } = {}) {
  db.run(
    `INSERT INTO attendances (data, status, client_name, updated_at, sync_dirty, sync_version)
     VALUES (?,?,?,?,?,?)`,
    [data, status, 'Local Client', '2026-01-01T00:00:00.000Z', dirty, version]
  );
  return dbGet('SELECT id FROM attendances ORDER BY id DESC LIMIT 1').id;
}

function seedConflict(attendanceId, { reason = 'preserve_local_dirty', remote = {}, localVersion = 1, remoteVersion = 2 } = {}) {
  const remoteSnapshot = JSON.stringify(Object.assign({
    syncId: 'sync-abc',
    data: '{"x":2,"remote":true}',
    status: 'draft',
    updatedAt: '2026-02-01T00:00:00.000Z',
    clientName: 'Remote Client',
    stationName: 'Remote Station',
    dsccRef: 'RM/999',
    version: remoteVersion,
  }, remote));
  const localSnapshot = JSON.stringify({ data: '{"x":1}', status: 'draft', updatedAt: '2026-01-01T00:00:00.000Z', version: localVersion });
  db.run(
    `INSERT INTO sync_conflicts (attendance_id, sync_id, reason, local_version, remote_version,
       local_updated_at, remote_updated_at, remote_status, local_snapshot, remote_snapshot, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [attendanceId, 'sync-abc', reason, localVersion, remoteVersion,
     '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z',
     JSON.parse(remoteSnapshot).status, localSnapshot, remoteSnapshot, '2026-02-01T00:00:00.000Z']
  );
  return dbGet('SELECT id FROM sync_conflicts ORDER BY id DESC LIMIT 1').id;
}

const baseCtx = () => ({
  dbGet,
  dbRun,
  dbAll,
  nowIso: () => '2026-09-14T12:00:00.000Z',
});

describe('resolveConflictsBulk', () => {
  beforeEach(async () => { await makeDb(); });

  it('accept_remote with force resolves a mixed protected batch', () => {
    const a1 = seedAttendance({ status: 'finalised', version: 1 });
    const a2 = seedAttendance({ status: 'draft', version: 1 });
    const a3 = seedAttendance({ status: 'draft', version: 1, dirty: 1 });
    seedConflict(a1, { reason: 'protect_finalised', remote: { status: 'draft' }, remoteVersion: 4 });
    seedConflict(a2, { reason: 'remote_newer', remoteVersion: 3 });
    seedConflict(a3, { reason: 'preserve_local_dirty', remoteVersion: 5 });

    const res = resolveConflictsBulk(baseCtx(), 'accept_remote', { force: true });
    assert.strictEqual(res.resolved, 3);
    assert.strictEqual(res.remaining, 0);
    assert.strictEqual(listOpenConflicts({ dbAll, dbGet }).length, 0);
    assert.strictEqual(dbGet('SELECT client_name FROM attendances WHERE id=?', [a1]).client_name, 'Remote Client');
  });

  it('keep_local bulk never runs unless explicitly requested', () => {
    const a1 = seedAttendance({ version: 1 });
    const a2 = seedAttendance({ version: 1 });
    seedConflict(a1, { remoteVersion: 4 });
    seedConflict(a2, { remoteVersion: 5 });
    const res = resolveConflictsBulk(baseCtx(), 'keep_local');
    assert.strictEqual(res.resolved, 2);
    assert.strictEqual(dbGet('SELECT data FROM attendances WHERE id=?', [a1]).data, '{"x":1}');
    assert.strictEqual(dbGet('SELECT sync_dirty FROM attendances WHERE id=?', [a1]).sync_dirty, 1);
  });

  it('accept_remote without force blocks protected locals', () => {
    const a1 = seedAttendance({ status: 'finalised', version: 1 });
    seedConflict(a1, { reason: 'protect_finalised', remote: { status: 'draft' }, remoteVersion: 9 });
    const res = resolveConflictsBulk(baseCtx(), 'accept_remote', { force: false });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.blocked, 1);
    assert.strictEqual(res.remaining, 1);
  });
});

describe('autoAcceptRemoteNewerConflicts', () => {
  beforeEach(async () => { await makeDb(); });

  it('auto-accepts protect_finalised with force and leaves dirty conflicts for human', () => {
    const a1 = seedAttendance({ status: 'finalised', version: 1 });
    const a2 = seedAttendance({ status: 'draft', version: 2, dirty: 1 });
    seedConflict(a1, { reason: 'protect_finalised', remote: { status: 'draft' }, remoteVersion: 4 });
    seedConflict(a2, { reason: 'preserve_local_dirty', remoteVersion: 5 });

    const res = autoAcceptRemoteNewerConflicts(baseCtx());
    assert.strictEqual(res.accepted, 1);
    assert.strictEqual(res.needsHuman.length, 1);
    assert.strictEqual(res.needsHuman[0].reason, 'preserve_local_dirty');
    assert.strictEqual(listOpenConflicts({ dbAll, dbGet }).length, 1);
  });
});

describe('runStaleDeviceCatchUp', () => {
  beforeEach(async () => { await makeDb(); });

  it('pulls, auto-accepts remote-newer, drains push, never auto keep_local', async () => {
    const a1 = seedAttendance({ status: 'completed', version: 1 });
    const a2 = seedAttendance({ status: 'draft', version: 1, dirty: 1 });
    seedConflict(a1, { reason: 'protect_finalised', remote: { status: 'draft' }, remoteVersion: 3 });
    seedConflict(a2, { reason: 'preserve_local_dirty', remoteVersion: 4 });
    dbRun("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastSyncPullAt', ?)", ['2026-01-01T00:00:00.000Z']);
    dbRun("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [SETTINGS_LAST_SEEN_APP_VERSION, '1.9.18']);

    const progress = [];
    let pullCalled = 0;
    let drainCalled = 0;
    const result = await runStaleDeviceCatchUp({
      ...baseCtx(),
      currentAppVersion: '1.9.100',
      syncEnabled: true,
      now: Date.parse('2026-09-14T12:00:00.000Z'),
      getLastSuccessfulSyncAt: () => '2026-01-01T00:00:00.000Z',
      syncPull: async () => { pullCalled += 1; return { received: 12, pulled: 5, conflicts: 2 }; },
      drainPendingSyncUploads: async () => {
        drainCalled += 1;
        return { cycles: 2, stoppedReason: 'drained', pending: 0, dirty: 0 };
      },
      onProgress: (p) => progress.push(p.phase),
    });

    assert.strictEqual(result.ran, true);
    assert.strictEqual(pullCalled, 1);
    assert.strictEqual(drainCalled, 1);
    assert.strictEqual(result.resolveResult.accepted, 1);
    assert.strictEqual(result.needsHuman.length, 1);
    assert.ok(progress.includes('pulling'));
    assert.ok(progress.includes('pushing'));
    assert.ok(progress.includes('needs_human'));
    // Never silently keep_local — dirty conflict still open.
    assert.strictEqual(listOpenConflicts({ dbAll, dbGet }).length, 1);
    assert.strictEqual(
      dbGet('SELECT value FROM settings WHERE key=?', [SETTINGS_LAST_SEEN_APP_VERSION]).value,
      '1.9.100'
    );
  });

  it('skips when fresh and still stamps app version', async () => {
    dbRun("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastSyncPullAt', ?)", ['2026-09-13T00:00:00.000Z']);
    dbRun("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [SETTINGS_LAST_SEEN_APP_VERSION, '1.9.100']);
    const result = await runStaleDeviceCatchUp({
      ...baseCtx(),
      currentAppVersion: '1.9.100',
      now: Date.parse('2026-09-14T12:00:00.000Z'),
      getLastSuccessfulSyncAt: () => '2026-09-13T00:00:00.000Z',
      syncPull: async () => { throw new Error('should not pull'); },
    });
    assert.strictEqual(result.ran, false);
    assert.strictEqual(result.reason, 'fresh');
  });
});

describe('runFixSyncNow', () => {
  beforeEach(async () => { await makeDb(); });

  it('reports drained when dirty/pending hit zero', async () => {
    const res = await runFixSyncNow({
      ...baseCtx(),
      forceRetryAll: () => 3,
      drainPendingSyncUploads: async () => ({ cycles: 1, stoppedReason: 'drained', pending: 0, dirty: 0 }),
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.code, 'DRAINED');
  });

  it('honestly reports rate-limit pause', async () => {
    const res = await runFixSyncNow({
      ...baseCtx(),
      forceRetryAll: () => 0,
      drainPendingSyncUploads: async () => ({
        cycles: 1,
        stoppedReason: 'rate_limited',
        pending: 40,
        dirty: 40,
        lastError: 'Too many requests',
      }),
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'RATE_LIMITED');
    assert.strictEqual(res.dirtyRemaining, 40);
  });
});

describe('stampSeenAppVersion', () => {
  beforeEach(async () => { await makeDb(); });
  it('persists current app version', () => {
    stampSeenAppVersion({ dbGet, dbRun, currentAppVersion: '1.9.101' });
    assert.strictEqual(
      dbGet('SELECT value FROM settings WHERE key=?', [SETTINGS_LAST_SEEN_APP_VERSION]).value,
      '1.9.101'
    );
  });
});
