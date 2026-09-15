'use strict';

/**
 * Regression: Robsprgr 1.9.101 fake "N not confirmed" after dirty/outbox desync.
 * Integrity clean + empty-write push must dequeue; localOnly / real failures must not.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const {
  isEmptyWritePushResponse,
  countUniquePendingSyncCases,
  buildPendingUploadStats,
  shouldConfirmAlreadyPresent,
  ackMetaForAlreadyPresent,
  partitionOutboxForReconcile,
  nextCloudSyncIdSet,
} = require('../lib/staleOutboxReconcile');
const { mayClearOutboxEntry } = require('../lib/syncMutationId');
const { assertPushAccepted } = require('../lib/syncPushAck');
const { buildLocalCloudHealth } = require('../lib/syncHealth');
const { buildLocalCloudIntegrityReport } = require('../lib/localCloudIntegrity');
const { createSyncWorker } = require('../main/syncWorker');
const { runFixSyncNow } = require('../main/staleSyncCatchUpRunner');

const root = path.join(__dirname, '..');

describe('staleOutboxReconcile — pure decision helpers', () => {
  it('detects empty-write responses only', () => {
    assert.strictEqual(isEmptyWritePushResponse({ ok: true, written: 0 }, 3), true);
    assert.strictEqual(isEmptyWritePushResponse({ ok: true, written: [] }, 2), true);
    assert.strictEqual(isEmptyWritePushResponse({ ok: true, written: 3 }, 3), false);
    assert.strictEqual(isEmptyWritePushResponse({ ok: true }, 3), false);
    assert.strictEqual(isEmptyWritePushResponse({ ok: false, written: 0 }, 3), false);
    assert.strictEqual(isEmptyWritePushResponse({ ok: true, written: 0 }, 0), false);
  });

  it('counts unique pending cases (no dirty+queue double-count)', () => {
    assert.strictEqual(
      countUniquePendingSyncCases({
        dirtyRecordIds: ['1', '2', '3'],
        queueRecordIds: ['2', '3', '4'],
      }),
      4
    );
    const stats = buildPendingUploadStats({
      dirtyCount: 40,
      queuePendingCount: 99,
      dirtyRecordIds: Array.from({ length: 40 }, (_, i) => String(i + 1)),
      queueRecordIds: Array.from({ length: 99 }, (_, i) => String(i + 1)),
    });
    assert.strictEqual(stats.pendingUploads, 99);
    assert.strictEqual(stats.doubleCountedSum, 139);
    assert.strictEqual(stats.wasDoubleCounting, true);
  });

  it('confirms already-present only with cloud id set covering pushed ids', () => {
    const ok = shouldConfirmAlreadyPresent({
      resp: { ok: true, written: 0 },
      sentCount: 2,
      pushedSyncIds: ['a', 'b'],
      cloudSyncIds: ['a', 'b', 'c'],
      localOnly: 0,
      cloudEmptyProven: false,
      cloudInventoryCount: 3,
      discrepancies: [],
    });
    assert.strictEqual(ok.confirm, true);
    assert.strictEqual(ok.reason, 'already_present_in_cloud');
  });

  it('refuses when localOnly>0, empty cloud, missing ids, or no id set', () => {
    assert.strictEqual(
      shouldConfirmAlreadyPresent({
        resp: { ok: true, written: 0 },
        sentCount: 1,
        pushedSyncIds: ['a'],
        cloudSyncIds: ['b'],
        localOnly: 0,
        cloudEmptyProven: false,
        cloudInventoryCount: 1,
      }).confirm,
      false
    );
    assert.strictEqual(
      shouldConfirmAlreadyPresent({
        resp: { ok: true, written: 0 },
        sentCount: 1,
        pushedSyncIds: ['a'],
        cloudSyncIds: ['a'],
        localOnly: 1,
        cloudEmptyProven: false,
        cloudInventoryCount: 10,
      }).reason,
      'local_only_present'
    );
    assert.strictEqual(
      shouldConfirmAlreadyPresent({
        resp: { ok: true, written: 0 },
        sentCount: 1,
        pushedSyncIds: ['a'],
        cloudSyncIds: ['a'],
        localOnly: 0,
        cloudEmptyProven: true,
        cloudInventoryCount: 0,
      }).reason,
      'cloud_empty_proven'
    );
    assert.strictEqual(
      shouldConfirmAlreadyPresent({
        resp: { ok: true, written: 0 },
        sentCount: 1,
        pushedSyncIds: ['a'],
        cloudSyncIds: null,
        localOnly: 0,
        cloudEmptyProven: false,
        cloudInventoryCount: 114,
      }).reason,
      'cloud_id_set_required'
    );
    assert.strictEqual(
      shouldConfirmAlreadyPresent({
        resp: { ok: true, written: 2 },
        sentCount: 2,
        pushedSyncIds: ['a', 'b'],
        cloudSyncIds: ['a', 'b'],
        localOnly: 0,
      }).reason,
      'not_empty_write'
    );
  });

  it('mayClearOutboxEntry allows integrity-proven already-present; refuses bare written:0', () => {
    assert.strictEqual(mayClearOutboxEntry({ confirmed: true, written: 0, sentCount: 3 }), false);
    assert.strictEqual(
      mayClearOutboxEntry(ackMetaForAlreadyPresent(3)),
      true
    );
    assert.strictEqual(
      mayClearOutboxEntry({
        confirmed: true,
        alreadyPresentInCloud: true,
        integrityClean: false,
        written: 0,
        sentCount: 3,
      }),
      false
    );
  });

  it('assertPushAccepted still refuses written:0 (heal is separate)', () => {
    assert.throws(() => assertPushAccepted({ ok: true, written: 0 }, 2), (e) => e.code === 'PUSH_INCOMPLETE');
  });

  it('partitions confirmable vs retain by cloud id set', () => {
    const parts = partitionOutboxForReconcile({
      candidates: [
        { recordId: 1, syncId: 'in-cloud' },
        { recordId: 2, syncId: 'local-only' },
        { recordId: 3, syncId: null },
      ],
      cloudSyncIds: ['in-cloud'],
    });
    assert.strictEqual(parts.confirmable.length, 1);
    assert.strictEqual(parts.retain.length, 2);
    assert.strictEqual(parts.canReconcileAny, true);
  });

  it('nextCloudSyncIdSet replaces on from-epoch and merges incremental', () => {
    assert.deepStrictEqual(
      nextCloudSyncIdSet({ previousIds: ['a'], pulledIds: ['b', 'c'], pulledFromEpoch: true }).sort(),
      ['b', 'c']
    );
    assert.deepStrictEqual(
      nextCloudSyncIdSet({ previousIds: ['a'], pulledIds: ['b'], pulledFromEpoch: false }).sort(),
      ['a', 'b']
    );
  });
});

describe('pendingUploads health — unique cases not dirty+queue sum', () => {
  it('buildLocalCloudHealth uses pendingCaseCount when provided', () => {
    const h = buildLocalCloudHealth({
      localCount: 69,
      lastPullReceived: 114,
      pulledFromEpoch: true,
      dirtyPushCount: 40,
      pendingChanges: 99,
      pendingCaseCount: 99,
      lastVerifiedCloudInventory: 114,
      lastVerifiedCloudPushAt: '2026-09-15T00:00:00.000Z',
      pullEverCompleted: true,
    });
    assert.strictEqual(h.pendingUploads, 99);
    assert.strictEqual(h.pendingCaseCount, 99);
    assert.notStrictEqual(h.pendingUploads, 139);
  });
});

async function initDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`CREATE TABLE attendances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_id TEXT,
    data TEXT,
    status TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT,
    client_name TEXT,
    station_name TEXT,
    dscc_ref TEXT,
    attendance_date TEXT,
    supervisor_approved_at TEXT,
    supervisor_note TEXT,
    archived_at TEXT,
    deletion_reason TEXT,
    sync_dirty INTEGER DEFAULT 1,
    sync_version INTEGER DEFAULT 1
  )`);
  db.run(`CREATE TABLE sync_queue (
    id TEXT PRIMARY KEY,
    record_id TEXT NOT NULL,
    operation TEXT DEFAULT 'upsert',
    payload TEXT,
    created_at INTEGER NOT NULL,
    retry_count INTEGER DEFAULT 0,
    last_attempt INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    error TEXT,
    mutation_id TEXT
  )`);
  db.run(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)`);
  return db;
}

function dbApi(db) {
  return {
    dbRun(sql, params = []) {
      db.run(sql, params);
    },
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

describe('Sync worker — empty-write already-present clears dirty when integrity proves cloud', () => {
  it('clears dirty/outbox on written:0 when cloud id set covers pushed ids', async () => {
    const db = await initDb();
    const api = dbApi(db);
    const now = new Date().toISOString();
    api.dbRun(
      `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
       VALUES (?,?,?,?,?,?,1,2)`,
      ['sid-already', '{}', 'draft', now, now, 'Client']
    );
    const row = api.dbGet('SELECT id FROM attendances');
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
      getCloudPresenceProof: () => ({
        cloudSyncIds: ['sid-already'],
        localOnly: 0,
        cloudEmptyProven: false,
        cloudInventoryCount: 1,
        discrepancies: [],
      }),
      sendToRenderer: () => {},
    });
    worker.enqueue(String(row.id), 'upsert', {});
    await worker.runCycle({ skipHeal: true });
    assert.strictEqual(api.dbGet('SELECT sync_dirty FROM attendances').sync_dirty, 0);
    const q = api.dbGet("SELECT status FROM sync_queue WHERE record_id=?", [String(row.id)]);
    assert.strictEqual(q.status, 'synced');
    assert.strictEqual(worker.getDiagnostics().lastPush.ok, true);
    assert.strictEqual(worker.getDiagnostics().lastPush.alreadyPresent, true);
  });

  it('keeps dirty when written:0 but sync id absent from cloud set (localOnly class)', async () => {
    const db = await initDb();
    const api = dbApi(db);
    const now = new Date().toISOString();
    api.dbRun(
      `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
       VALUES (?,?,?,?,?,?,1,1)`,
      ['sid-local-only', '{}', 'draft', now, now, 'Client']
    );
    const row = api.dbGet('SELECT id FROM attendances');
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
      getCloudPresenceProof: () => ({
        cloudSyncIds: ['other-id'],
        localOnly: 1,
        cloudEmptyProven: false,
        cloudInventoryCount: 1,
        discrepancies: [{ code: 'local_only_sync_ids' }],
      }),
      sendToRenderer: () => {},
    });
    worker.enqueue(String(row.id), 'upsert', {});
    await worker.runCycle({ skipHeal: true });
    assert.strictEqual(api.dbGet('SELECT sync_dirty FROM attendances').sync_dirty, 1);
    assert.strictEqual(worker.getDiagnostics().lastPush.ok, false);
  });

  it('keeps dirty on real write failure (ok:false)', async () => {
    const db = await initDb();
    const api = dbApi(db);
    const now = new Date().toISOString();
    api.dbRun(
      `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
       VALUES (?,?,?,?,?,?,1,1)`,
      ['sid-fail', '{}', 'draft', now, now, 'Client']
    );
    const row = api.dbGet('SELECT id FROM attendances');
    const worker = createSyncWorker({
      ...api,
      db,
      getSyncApiUrl: () => 'http://127.0.0.1:9',
      readLicenceData: () => ({ key: 'CN-A-TEST-0532' }),
      getMachineId: () => 'machine-a',
      getMasterKeyHex: () => 'a'.repeat(64),
      httpPost: async () => ({ ok: false, error: 'server error' }),
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      syncPull: async () => ({ pulled: 0, received: 0 }),
      ensureCanonicalKey: async () => ({ ok: true }),
      getCloudPresenceProof: () => ({
        cloudSyncIds: ['sid-fail'],
        localOnly: 0,
        cloudEmptyProven: false,
        cloudInventoryCount: 1,
        discrepancies: [],
      }),
      sendToRenderer: () => {},
    });
    worker.enqueue(String(row.id), 'upsert', {});
    await worker.runCycle({ skipHeal: true });
    assert.strictEqual(api.dbGet('SELECT sync_dirty FROM attendances').sync_dirty, 1);
  });
});

describe('Fix sync now — reconciles stale outbox when integrity clean', () => {
  it('runFixSyncNow drains via already-present confirm without reuploadAll', async () => {
    const db = await initDb();
    const api = dbApi(db);
    const now = new Date().toISOString();
    api.dbRun(
      `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
       VALUES (?,?,?,?,?,?,1,3)`,
      ['sid-fix', '{}', 'completed', now, now, 'Client']
    );
    const row = api.dbGet('SELECT id FROM attendances');
    const worker = createSyncWorker({
      ...api,
      db,
      getSyncApiUrl: () => 'http://127.0.0.1:9',
      readLicenceData: () => ({ key: 'CN-A-TEST-0532' }),
      getMachineId: () => 'machine-a',
      getMasterKeyHex: () => 'a'.repeat(64),
      httpPost: async () => ({ ok: true, written: 0 }),
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      syncPull: async () => ({ pulled: 0, received: 1 }),
      ensureCanonicalKey: async () => ({ ok: true }),
      getCloudPresenceProof: () => ({
        cloudSyncIds: ['sid-fix'],
        localOnly: 0,
        cloudEmptyProven: false,
        cloudInventoryCount: 1,
        discrepancies: [],
      }),
      sendToRenderer: () => {},
    });
    worker.enqueue(String(row.id), 'upsert', {});

    const result = await runFixSyncNow({
      forceRetryAll: () => worker.forceRetryAll(),
      drainPendingSyncUploads: async () => {
        await worker.runCycle({ skipHeal: true });
        const dirty = api.dbGet('SELECT COUNT(*) as c FROM attendances WHERE sync_dirty=1');
        const pending = api.dbGet(
          "SELECT COUNT(*) as c FROM sync_queue WHERE status IN ('pending','syncing','failed','blocked')"
        );
        return {
          cycles: 1,
          stoppedReason: (dirty.c || 0) === 0 && (pending.c || 0) === 0 ? 'drained' : 'max_cycles',
          pending: pending.c || 0,
          dirty: dirty.c || 0,
        };
      },
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(api.dbGet('SELECT sync_dirty FROM attendances').sync_dirty, 0);
  });
});

describe('Integrity report + product wiring for cloud id set', () => {
  it('localOnly fires only when cloudSyncIds provided', () => {
    const withIds = buildLocalCloudIntegrityReport({
      localRows: [
        { syncId: 'a', syncDirty: true },
        { syncId: 'b', syncDirty: false },
      ],
      cloudInventoryCount: 1,
      cloudSyncIds: ['b'],
    });
    assert.strictEqual(withIds.localOnly, 1);
    const noIds = buildLocalCloudIntegrityReport({
      localRows: [{ syncId: 'a', syncDirty: true }],
      cloudInventoryCount: 114,
      cloudSyncIds: null,
    });
    assert.strictEqual(noIds.localOnly, 0);
  });

  it('main/preload/worker wire stale reconcile + cloud id persistence', () => {
    const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    const workerJs = fs.readFileSync(path.join(root, 'main/syncWorker.js'), 'utf8');
    const healthJs = fs.readFileSync(path.join(root, 'lib/syncHealth.js'), 'utf8');
    assert.match(mainJs, /staleOutboxReconcile|getLastVerifiedCloudSyncIds|persistCloudSyncIdsAfterPull/);
    assert.match(workerJs, /shouldConfirmAlreadyPresent|alreadyPresentInCloud|getCloudPresenceProof/);
    assert.match(healthJs, /pendingCaseCount/);
  });
});
