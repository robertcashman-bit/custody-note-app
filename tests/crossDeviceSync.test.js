/**
 * Cross-device sync simulation: two sync workers + shared mock API.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const initSqlJs = require('sql.js');
const { createSyncWorker } = require('../main/syncWorker');
const { encryptSyncEnvelope } = require('../lib/syncRecordCrypto');
const { encryptMasterKeyForEscrow } = require('../lib/keyEscrow');
const { createMockSyncServer, getTestLicenceKey } = require('./fixtures/mockSyncServer.mjs');

const MASTER_KEY = 'a'.repeat(64);
const LICENCE_KEY = getTestLicenceKey();

async function initTestDb() {
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
  d.run(`CREATE TABLE sync_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, correlation_id TEXT, direction TEXT,
    record_count INTEGER, success INTEGER, error_message TEXT, created_at TEXT
  );`);
  return d;
}

function makeDbApi(db) {
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

function makeWorker(dbApi, apiBase, machineId, syncPullFn) {
  return createSyncWorker({
    ...dbApi,
    db: true,
    getSyncApiUrl: () => apiBase,
    readLicenceData: () => ({ key: LICENCE_KEY }),
    getMachineId: () => machineId,
    getMasterKeyHex: () => MASTER_KEY,
    httpPost: async (url, body, opts) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(opts && opts.headers) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts && opts.timeout ? opts.timeout : 30000),
      });
      return res.json();
    },
    httpGetWithTimeout: async (url) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      return { statusCode: res.status, ok: res.ok };
    },
    syncPull: syncPullFn,
    uploadKeyEscrowIfNeeded: async () => {
      const blob = encryptMasterKeyForEscrow(MASTER_KEY, LICENCE_KEY);
      const res = await fetch(`${apiBase}/api/recovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: LICENCE_KEY, machineId, blob }),
      });
      const json = await res.json();
      return !!(json && json.ok);
    },
    sendToRenderer: () => {},
    onStatusChange: () => {},
  });
}

describe('cross-device sync (mock server)', () => {
  let mock;
  let apiBase;

  before(async () => {
    mock = createMockSyncServer();
    apiBase = await mock.start();
  });

  after(async () => {
    if (mock) await mock.stop();
  });

  it('device A push → device B pull receives created record', async () => {
    const dbA = await initTestDb();
    const apiA = makeDbApi(dbA);
    const workerA = makeWorker(apiA, apiBase, 'machine-a', async () => ({ pulled: 0 }));

    const syncId = 'sync-cross-001';
    const now = new Date().toISOString();
    const data = JSON.stringify({ surname: 'CrossDevice', forename: 'Test' });
    apiA.dbRun(
      `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
       VALUES (?,?,?,?,?,?,1,1)`,
      [syncId, data, 'draft', now, now, 'CrossDevice, Test']
    );
    workerA.enqueue('1', 'upsert', {});
    await workerA.runCycle();
    assert.ok(mock.getRecordCount(LICENCE_KEY) >= 1, 'server should have record after push');

    const dbB = await initTestDb();
    const apiB = makeDbApi(dbB);
    mock.seedEscrow(LICENCE_KEY, MASTER_KEY);

    const { decryptSyncEnvelope } = require('../lib/syncRecordCrypto');
    const pullFn = async () => {
      const res = await fetch(`${apiBase}/api/sync/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: LICENCE_KEY, machineId: 'machine-b', since: '1970-01-01T00:00:00.000Z' }),
      });
      const resp = await res.json();
      let merged = 0;
      for (const raw of resp.records || []) {
        const payload = decryptSyncEnvelope(MASTER_KEY, raw.envelope);
        apiB.dbRun(
          `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
           VALUES (?,?,?,?,?,?,0,?)`,
          [raw.syncId, payload.data, payload.status, raw.createdAt, raw.updatedAt, payload.clientName || '', raw.version || 1]
        );
        merged++;
      }
      return { pulled: merged, received: (resp.records || []).length, decryptFailed: 0, noMasterKeySkipped: 0 };
    };

    const workerB = makeWorker(apiB, apiBase, 'machine-b', pullFn);
    await workerB.runCycle();

    const rowsB = apiB.dbAll('SELECT * FROM attendances WHERE sync_id=?', [syncId]);
    assert.strictEqual(rowsB.length, 1);
    assert.ok(rowsB[0].data.includes('CrossDevice'));
  });

  it('edit on device A updates device B after pull', async () => {
    const dbA = await initTestDb();
    const apiA = makeDbApi(dbA);
    const syncId = 'sync-cross-edit';
    const t1 = new Date().toISOString();
    apiA.dbRun(
      `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, sync_dirty, sync_version)
       VALUES (?,?,?,?,?,1,1)`,
      [syncId, JSON.stringify({ surname: 'Alpha' }), 'draft', t1, t1]
    );
    const workerA = makeWorker(apiA, apiBase, 'machine-a-edit', async () => ({ pulled: 0 }));
    workerA.enqueue('1', 'upsert', {});
    await workerA.runCycle();

    const t2 = new Date(Date.now() + 1000).toISOString();
    apiA.dbRun(
      'UPDATE attendances SET data=?, updated_at=?, sync_dirty=1, sync_version=2 WHERE sync_id=?',
      [JSON.stringify({ surname: 'Beta' }), t2, syncId]
    );
    workerA.enqueue('1', 'upsert', {});
    await workerA.runCycle();

    const res = await fetch(`${apiBase}/api/sync/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: LICENCE_KEY, machineId: 'machine-b-edit', since: '1970-01-01T00:00:00.000Z' }),
    });
    const pull = await res.json();
    const remote = (pull.records || []).find((r) => r.syncId === syncId);
    assert.ok(remote, 'remote record exists');
    const payload = require('../lib/syncRecordCrypto').decryptSyncEnvelope(MASTER_KEY, remote.envelope);
    assert.ok(payload.data.includes('Beta'));
    assert.strictEqual(remote.version, 2);
  });

  it('different licence keys cannot read each other records', async () => {
    const res = await fetch(`${apiBase}/api/sync/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'OTHER-KEY-9999-XXXX', machineId: 'x', since: '1970-01-01T00:00:00.000Z' }),
    });
    const pull = await res.json();
    assert.strictEqual(pull.ok, false);
  });
});
