'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const initSqlJs = require('sql.js');
const {
  resolveOpenSyncConflictsIfAny,
  SETTINGS_LEGACY_OPEN_CONFLICTS_MIGRATED,
} = require('../main/openConflictAutoResolve');
const { listOpenConflicts } = require('../main/syncConflicts');
const {
  SETTINGS_CATCH_UP_PENDING,
  getSetting,
  runStaleDeviceCatchUp,
} = require('../main/staleSyncCatchUpRunner');
const { shouldRunStaleCatchUp } = require('../lib/staleSyncCatchUp');

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

function seedAttendance({
  status = 'draft',
  version = 1,
  data = '{}',
  archivedAt = null,
  updatedAt = '2026-03-01T10:00:00.000Z',
} = {}) {
  db.run(
    `INSERT INTO attendances (data, status, client_name, updated_at, sync_dirty, sync_version, archived_at)
     VALUES (?,?,?,?,?,?,?)`,
    [data, status, 'Synthetic Client', updatedAt, 0, version, archivedAt]
  );
  return dbGet('SELECT id FROM attendances ORDER BY id DESC LIMIT 1').id;
}

function seedProtectFinalisedConflict(attendanceId, {
  localVersion = 655,
  remoteVersion = 658,
  localData = '{"caseNote":"local finalised text"}',
  remoteData = '{"caseNote":"local finalised text"}',
  remoteArchivedAt = '2026-04-10T16:00:00.000Z',
} = {}) {
  const localSnapshot = JSON.stringify({
    data: localData,
    status: 'finalised',
    updatedAt: '2026-03-01T10:00:00.000Z',
    version: localVersion,
    archivedAt: null,
  });
  const remoteSnapshot = JSON.stringify({
    syncId: 'sync-synthetic-001',
    data: remoteData,
    status: 'completed',
    updatedAt: '2026-04-10T15:00:00.000Z',
    clientName: 'Synthetic Client',
    archivedAt: remoteArchivedAt,
    version: remoteVersion,
  });
  db.run(
    `INSERT INTO sync_conflicts (attendance_id, sync_id, reason, local_version, remote_version,
       local_updated_at, remote_updated_at, remote_status, local_snapshot, remote_snapshot, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      attendanceId, 'sync-synthetic-001', 'protect_finalised', localVersion, remoteVersion,
      '2026-03-01T10:00:00.000Z', '2026-04-10T15:00:00.000Z', 'completed',
      localSnapshot, remoteSnapshot, '2026-04-11T00:00:00.000Z',
    ]
  );
}

const baseCtx = () => ({
  dbGet,
  dbRun,
  dbAll,
  nowIso: () => '2026-09-14T12:00:00.000Z',
});

describe('resolveOpenSyncConflictsIfAny', () => {
  beforeEach(async () => { await makeDb(); });

  it('finalised v655 vs cloud completed+archived v658 ends archived with no field loss', () => {
    const att = seedAttendance({
      status: 'finalised',
      version: 655,
      data: '{"caseNote":"local finalised text"}',
    });
    seedProtectFinalisedConflict(att);

    const res = resolveOpenSyncConflictsIfAny(baseCtx(), { source: 'test' });
    assert.equal(res.merged, 1);
    assert.equal(listOpenConflicts({ dbAll, dbGet }).length, 0);

    const row = dbGet('SELECT status, archived_at, sync_version, data FROM attendances WHERE id=?', [att]);
    assert.equal(row.status, 'completed');
    assert.equal(row.archived_at, '2026-04-10T16:00:00.000Z');
    assert.equal(row.sync_version, 658);
    const parsed = JSON.parse(row.data);
    assert.equal(parsed.caseNote, 'local finalised text');
    assert.ok(getSetting(dbGet, SETTINGS_LEGACY_OPEN_CONFLICTS_MIGRATED));
  });

  it('both-sides-edited conflict keeps a copy in _cnConflictHistory', () => {
    const att = seedAttendance({
      status: 'draft',
      version: 10,
      data: '{"note":"alpha"}',
      updatedAt: '2026-05-01T00:00:00.000Z',
    });
    const localSnapshot = JSON.stringify({
      data: '{"note":"alpha"}',
      status: 'draft',
      updatedAt: '2026-05-01T00:00:00.000Z',
      version: 10,
    });
    const remoteSnapshot = JSON.stringify({
      syncId: 'sync-synthetic-002',
      data: '{"note":"beta"}',
      status: 'draft',
      updatedAt: '2026-06-01T00:00:00.000Z',
      version: 12,
    });
    db.run(
      `INSERT INTO sync_conflicts (attendance_id, sync_id, reason, local_version, remote_version,
         local_updated_at, remote_updated_at, remote_status, local_snapshot, remote_snapshot, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        att, 'sync-synthetic-002', 'preserve_local_dirty', 10, 12,
        '2026-05-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', 'draft',
        localSnapshot, remoteSnapshot, '2026-06-02T00:00:00.000Z',
      ]
    );

    resolveOpenSyncConflictsIfAny(baseCtx());
    const row = dbGet('SELECT data FROM attendances WHERE id=?', [att]);
    const parsed = JSON.parse(row.data);
    assert.equal(parsed.note, 'beta');
    const history = parsed._cnConflictHistory || [];
    assert.ok(history.some((h) => h.field === 'note' && h.lost === 'alpha' && h.kept === 'beta'));
  });
});

describe('stale catch-up pending retry', () => {
  beforeEach(async () => { await makeDb(); });

  it('pending flag forces catch-up on next launch even when sync is fresh', async () => {
    dbRun("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastSyncPullAt', ?)", ['2026-09-13T00:00:00.000Z']);
    dbRun("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [SETTINGS_CATCH_UP_PENDING, '1']);

    assert.equal(
      shouldRunStaleCatchUp({
        lastSuccessfulSyncAt: '2026-09-13T00:00:00.000Z',
        lastSeenAppVersion: '1.9.116',
        currentAppVersion: '1.9.116',
        now: Date.parse('2026-09-14T12:00:00.000Z'),
        pendingCatchUp: true,
      }).reason,
      'pending_retry'
    );

    let pullCalled = 0;
    const result = await runStaleDeviceCatchUp({
      ...baseCtx(),
      currentAppVersion: '1.9.116',
      now: Date.parse('2026-09-14T12:00:00.000Z'),
      getLastSuccessfulSyncAt: () => '2026-09-13T00:00:00.000Z',
      syncPull: async () => { pullCalled += 1; return { received: 0, pulled: 0, conflicts: 0 }; },
      drainPendingSyncUploads: async () => ({ cycles: 1, stoppedReason: 'drained', pending: 0, dirty: 0 }),
    });

    assert.equal(result.ran, true);
    assert.equal(pullCalled, 1);
    assert.equal(getSetting(dbGet, SETTINGS_CATCH_UP_PENDING), null);
  });

  it('interrupted catch-up leaves pending set for retry', async () => {
    dbRun("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastSyncPullAt', ?)", ['2026-01-01T00:00:00.000Z']);

    const result = await runStaleDeviceCatchUp({
      ...baseCtx(),
      currentAppVersion: '1.9.116',
      now: Date.parse('2026-09-14T12:00:00.000Z'),
      getLastSuccessfulSyncAt: () => '2026-01-01T00:00:00.000Z',
      syncPull: async () => { throw new Error('simulated interrupt'); },
    });

    assert.equal(result.code, 'PULL_FAILED');
    assert.equal(getSetting(dbGet, SETTINGS_CATCH_UP_PENDING), '1');
  });
});
