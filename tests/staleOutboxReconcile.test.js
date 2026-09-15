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

  /**
   * Robsprgr 1.9.102 field miss:
   * - cloudSyncIdCount 114, localOnly 0, inventory 114
   * - queueLength ~99 with thrash backoff on oldest rows
   * - dirtyPushCount ~40 (migrate refreshes these to newer created_at)
   * - every push written:0; Fix sync 40 cycles → UPLOAD_INCOMPLETE
   *
   * Root causes covered:
   * 1) getNextQueueItem LIMIT 20 before due-filter hid due dirty behind backoff heads
   * 2) forceRetryAll ignored pending backoff (Fix sync never cleared thrash delays)
   */
  it('Robsprgr-scale: cloud id set covers records, written:0, Fix sync clears dirty+outbox', async () => {
    const db = await initDb();
    const api = dbApi(db);
    const now = new Date().toISOString();
    const cloudIds = [];

    for (let i = 0; i < 69; i++) {
      const sid = 'active-' + i;
      cloudIds.push(sid);
      api.dbRun(
        `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
         VALUES (?,?,?,?,?,?,?,1)`,
        [sid, '{}', 'completed', now, now, 'C' + i, i < 40 ? 1 : 0]
      );
    }
    for (let i = 0; i < 45; i++) {
      const sid = 'tomb-' + i;
      cloudIds.push(sid);
      api.dbRun(
        `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, deleted_at, client_name, sync_dirty, sync_version)
         VALUES (?,?,?,?,?,?,?,?,1)`,
        [sid, '{}', 'draft', now, now, '2026-01-01', 'T' + i, 0]
      );
    }

    api.dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [
      'lastVerifiedCloudSyncIds',
      JSON.stringify(cloudIds),
    ]);
    api.dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [
      'lastVerifiedCloudInventory',
      String(cloudIds.length),
    ]);

    const dirtyRows = api.dbAll('SELECT id FROM attendances WHERE sync_dirty=1');
    const cleanRows = api.dbAll('SELECT id FROM attendances WHERE sync_dirty=0 LIMIT 59');
    let qi = 0;
    const seedAt = Date.now();
    for (const row of dirtyRows.concat(cleanRows)) {
      api.dbRun(
        `INSERT INTO sync_queue (id, record_id, operation, payload, created_at, retry_count, last_attempt, status)
         VALUES (?,?,?,?,?,?,?,?)`,
        ['sq-old-' + qi++, String(row.id), 'upsert', '{}', seedAt - 200000 + qi, 3, seedAt, 'pending']
      );
    }

    function migrateSyncDirtyToQueue() {
      const rows = api.dbAll('SELECT id FROM attendances WHERE sync_dirty=1');
      const t = Date.now();
      for (const row of rows) {
        const rid = String(row.id);
        api.dbRun('DELETE FROM sync_queue WHERE record_id=?', [rid]);
        api.dbRun(
          `INSERT INTO sync_queue (id, record_id, operation, payload, created_at, retry_count, last_attempt, status)
           VALUES (?,?,?,?,?,0,?,?)`,
          ['sq-m-' + rid + '-' + t, rid, 'upsert', '{}', t + 1, t, 'pending']
        );
      }
    }

    function getCloudPresenceProof() {
      const ids = JSON.parse(
        api.dbGet('SELECT value FROM settings WHERE key=?', ['lastVerifiedCloudSyncIds']).value
      );
      const inv = Number(
        api.dbGet('SELECT value FROM settings WHERE key=?', ['lastVerifiedCloudInventory']).value
      );
      const rows = api.dbAll('SELECT sync_id, sync_dirty, deleted_at, status FROM attendances');
      const report = buildLocalCloudIntegrityReport({
        localRows: rows.map((r) => ({
          syncId: r.sync_id,
          syncDirty: r.sync_dirty === 1,
          status: r.status,
          deletedAt: r.deleted_at,
        })),
        cloudInventoryCount: inv,
        cloudSyncIds: ids,
      });
      return {
        cloudSyncIds: ids,
        cloudInventoryCount: inv,
        localOnly: report.localOnly,
        cloudEmptyProven: !!report.cloudEmptyProven,
        discrepancies: report.discrepancies,
      };
    }

    const proof0 = getCloudPresenceProof();
    assert.strictEqual(proof0.cloudSyncIds.length, 114);
    assert.strictEqual(proof0.localOnly, 0);
    assert.strictEqual(proof0.cloudInventoryCount, 114);

    let pushCount = 0;
    const worker = createSyncWorker({
      ...api,
      db,
      getSyncApiUrl: () => 'http://127.0.0.1:9',
      readLicenceData: () => ({ key: 'CN-A-TEST-0532' }),
      getMachineId: () => 'machine-robsprgr',
      getMasterKeyHex: () => 'a'.repeat(64),
      httpPost: async () => {
        pushCount++;
        return { ok: true, written: 0 };
      },
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      syncPull: async () => ({ pulled: 0, received: 0 }),
      ensureCanonicalKey: async () => ({ ok: true }),
      getCloudPresenceProof,
      sendToRenderer: () => {},
    });

    const result = await runFixSyncNow({
      forceRetryAll: () => worker.forceRetryAll(),
      drainPendingSyncUploads: async ({ maxCycles }) => {
        let cycles = 0;
        for (; cycles < (maxCycles || 40); cycles++) {
          migrateSyncDirtyToQueue();
          const pending = api.dbGet(
            "SELECT COUNT(*) as c FROM sync_queue WHERE status IN ('pending','syncing','failed')"
          ).c || 0;
          const dirty = api.dbGet('SELECT COUNT(*) as c FROM attendances WHERE sync_dirty=1').c || 0;
          if (pending === 0 && dirty === 0) {
            return { cycles, stoppedReason: 'drained', pending: 0, dirty: 0 };
          }
          worker.forceRetryAll();
          await worker.runCycle({ skipHeal: true });
        }
        return {
          cycles,
          stoppedReason: 'max_cycles',
          pending:
            api.dbGet(
              "SELECT COUNT(*) as c FROM sync_queue WHERE status IN ('pending','syncing','failed')"
            ).c || 0,
          dirty: api.dbGet('SELECT COUNT(*) as c FROM attendances WHERE sync_dirty=1').c || 0,
          lastError: worker.getDiagnostics().lastError || null,
        };
      },
    });

    assert.ok(pushCount > 0, 'Fix sync must actually push (not stall on backoff heads)');
    assert.strictEqual(result.ok, true, 'expected DRAINED, got ' + JSON.stringify(result));
    assert.strictEqual(
      api.dbGet('SELECT COUNT(*) as c FROM attendances WHERE sync_dirty=1').c,
      0
    );
    assert.strictEqual(
      api.dbGet(
        "SELECT COUNT(*) as c FROM sync_queue WHERE status IN ('pending','syncing','failed','blocked')"
      ).c,
      0
    );
    assert.strictEqual(worker.getDiagnostics().lastPush.alreadyPresent, true);
  });

  it('getNextQueueItem reaches due dirty behind oldest backoff-pending heads', async () => {
    const db = await initDb();
    const api = dbApi(db);
    const now = new Date().toISOString();
    const cloudIds = [];
    for (let i = 0; i < 25; i++) {
      const sid = 'old-' + i;
      cloudIds.push(sid);
      api.dbRun(
        `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
         VALUES (?,?,?,?,?,?,0,1)`,
        [sid, '{}', 'draft', now, now, 'C']
      );
      const id = api.dbGet('SELECT id FROM attendances WHERE sync_id=?', [sid]).id;
      api.dbRun(
        `INSERT INTO sync_queue (id, record_id, operation, payload, created_at, retry_count, last_attempt, status)
         VALUES (?,?,?,?,?,?,?,?)`,
        ['old-' + i, String(id), 'upsert', '{}', Date.now() - 100000 + i, 3, Date.now(), 'pending']
      );
    }
    cloudIds.push('fresh-1');
    api.dbRun(
      `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
       VALUES ('fresh-1','{}','draft',?,?, 'F',1,1)`,
      [now, now]
    );
    const fid = api.dbGet('SELECT id FROM attendances WHERE sync_id=?', ['fresh-1']).id;
    api.dbRun(
      `INSERT INTO sync_queue (id, record_id, operation, payload, created_at, retry_count, last_attempt, status)
       VALUES ('fresh',?,?, '{}', ?, 0, ?, 'pending')`,
      [String(fid), 'upsert', Date.now() + 5000, Date.now()]
    );

    let posts = 0;
    const worker = createSyncWorker({
      ...api,
      db,
      getSyncApiUrl: () => 'http://127.0.0.1:9',
      readLicenceData: () => ({ key: 'CN-A-TEST-0532' }),
      getMachineId: () => 'm',
      getMasterKeyHex: () => 'a'.repeat(64),
      httpPost: async () => {
        posts++;
        return { ok: true, written: 0 };
      },
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      syncPull: async () => ({ pulled: 0, received: 0 }),
      ensureCanonicalKey: async () => ({ ok: true }),
      getCloudPresenceProof: () => ({
        cloudSyncIds: cloudIds,
        localOnly: 0,
        cloudEmptyProven: false,
        cloudInventoryCount: cloudIds.length,
        discrepancies: [],
      }),
      sendToRenderer: () => {},
    });

    await worker.runCycle({ skipHeal: true });
    assert.ok(posts > 0, 'must push despite 25 oldest rows in backoff');
    assert.strictEqual(
      api.dbGet('SELECT sync_dirty FROM attendances WHERE sync_id=?', ['fresh-1']).sync_dirty,
      0
    );
  });

  it('partial empty-write batch clears cloud-proven ids and retains local-only', async () => {
    const db = await initDb();
    const api = dbApi(db);
    const now = new Date().toISOString();
    api.dbRun(
      `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
       VALUES ('in-cloud','{}','draft',?,?, 'A',1,1)`,
      [now, now]
    );
    api.dbRun(
      `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, deleted_at, client_name, sync_dirty, sync_version)
       VALUES ('local-tomb','{}','draft',?,?, '2026-01-01', 'B',1,1)`,
      [now, now]
    );
    const a = api.dbGet('SELECT id FROM attendances WHERE sync_id=?', ['in-cloud']).id;
    const b = api.dbGet('SELECT id FROM attendances WHERE sync_id=?', ['local-tomb']).id;
    const worker = createSyncWorker({
      ...api,
      db,
      getSyncApiUrl: () => 'http://127.0.0.1:9',
      readLicenceData: () => ({ key: 'CN-A-TEST-0532' }),
      getMachineId: () => 'm',
      getMasterKeyHex: () => 'a'.repeat(64),
      httpPost: async () => ({ ok: true, written: 0 }),
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      syncPull: async () => ({ pulled: 0, received: 0 }),
      ensureCanonicalKey: async () => ({ ok: true }),
      getCloudPresenceProof: () => ({
        cloudSyncIds: ['in-cloud'],
        localOnly: 1,
        cloudEmptyProven: false,
        cloudInventoryCount: 1,
        discrepancies: [{ code: 'local_only_sync_ids' }],
      }),
      sendToRenderer: () => {},
    });
    worker.enqueue(String(a), 'upsert', {});
    worker.enqueue(String(b), 'upsert', {});
    await worker.runCycle({ skipHeal: true });
    assert.strictEqual(
      api.dbGet('SELECT sync_dirty FROM attendances WHERE sync_id=?', ['in-cloud']).sync_dirty,
      0
    );
    assert.strictEqual(
      api.dbGet('SELECT sync_dirty FROM attendances WHERE sync_id=?', ['local-tomb']).sync_dirty,
      1
    );
    assert.strictEqual(
      api.dbGet('SELECT status FROM sync_queue WHERE record_id=?', [String(a)]).status,
      'synced'
    );
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

  it('soft-deleted missing sync ids count as localOnly (outbox-relevant)', () => {
    const report = buildLocalCloudIntegrityReport({
      localRows: [
        { syncId: 'active-ok', syncDirty: false },
        { syncId: 'tomb-missing', syncDirty: true, deletedAt: '2026-01-01' },
      ],
      cloudInventoryCount: 1,
      cloudSyncIds: ['active-ok'],
    });
    assert.strictEqual(report.localActive, 1);
    assert.strictEqual(report.localSoftDeleted, 1);
    assert.strictEqual(report.localOnly, 1);
    assert.strictEqual(report.localOnlySample[0].softDeleted, true);
  });

  it('main/preload/worker wire stale reconcile + cloud id persistence', () => {
    const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    const workerJs = fs.readFileSync(path.join(root, 'main/syncWorker.js'), 'utf8');
    const healthJs = fs.readFileSync(path.join(root, 'lib/syncHealth.js'), 'utf8');
    assert.match(mainJs, /staleOutboxReconcile|getLastVerifiedCloudSyncIds|persistCloudSyncIdsAfterPull/);
    assert.match(mainJs, /cloudIdsWritten|flushDbSync/);
    assert.match(workerJs, /shouldConfirmAlreadyPresent|alreadyPresentInCloud|getCloudPresenceProof/);
    assert.match(workerJs, /partitionOutboxForReconcile|partial_already_present/);
    assert.match(workerJs, /LIMIT 500/);
    assert.match(workerJs, /status IN \('pending','syncing','failed','blocked'\)/);
    assert.match(healthJs, /pendingCaseCount/);
  });
});
