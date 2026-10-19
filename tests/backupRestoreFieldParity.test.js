'use strict';

/**
 * End-to-end field parity: synthetic attendance → durable DB export → encrypted
 * generational backup → live corruption → restore gate → full row compare.
 * Also pushes to mock central sync SoT and verifies cloud payload after amend.
 *
 * Synthetic data only — no real client identifiers.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const initSqlJs = require('sql.js');
const { runMigrations } = require('../main/dbMigrations');
const { encryptBuffer, decryptBuffer } = require('../lib/dbCrypto');
const { verifyEncryptedBackupFile } = require('../lib/backupVerify');
const {
  mayRestoreBackupOverLive,
  countActiveAttendancesInPlainDb,
} = require('../lib/backupIntegrityGate');
const { createSyncWorker } = require('../main/syncWorker');
const { decryptSyncEnvelope } = require('../lib/syncRecordCrypto');
const {
  createMockSyncServer,
  getTestLicenceKey,
  resetMockSyncStores,
} = require('./fixtures/mockSyncServer.mjs');

const MASTER_KEY = crypto.randomBytes(32).toString('hex');
const LICENCE_KEY = getTestLicenceKey();

/** Rich synthetic JSON blob covering unicode and nested structures. */
function buildHeroData() {
  return {
    client: { surname: 'Synth', forename: 'Test-用户', dob: '1990-01-01' },
    station: 'Synthetic Police Station',
    interviewNotes: 'Line one\nLine two — em dash “quoted”',
    officers: [{ name: 'PC Example', badge: 'SYN-001' }],
    flags: { voluntary: true, interpreter: false },
    nested: { a: [1, 2, { z: 'ω' }] },
  };
}

function makeDbApi(db) {
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

async function openMigratedDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  runMigrations(db);
  return { SQL, db };
}

function rowSnapshot(db, id) {
  const stmt = db.prepare(
    `SELECT id, sync_id, sync_version, sync_dirty, data, status, created_at, updated_at,
            client_name, station_name, dscc_ref, attendance_date, deleted_at
     FROM attendances WHERE id = ?`
  );
  stmt.bind([id]);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function allActiveSnapshots(db) {
  const stmt = db.prepare(
    `SELECT id, sync_id, data, status, client_name, station_name, dscc_ref, attendance_date
     FROM attendances WHERE deleted_at IS NULL ORDER BY id`
  );
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

describe('Backup / restore field parity (local PITR + central sync SoT)', () => {
  let tmpDir;
  let backupPath;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-bkp-parity-'));
    backupPath = path.join(tmpDir, 'attendance-quick-parity-test.db');
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
    resetMockSyncStores();
  });

  it('save → encrypted backup → corrupt live → restore preserves every field; control row unchanged', async () => {
    const { SQL, db } = await openMigratedDb();
    const heroData = buildHeroData();
    const syncId = crypto.randomUUID();
    const created = '2026-10-19T10:00:00.000Z';
    db.run(
      `INSERT INTO attendances (
        sync_id, sync_version, sync_dirty, data, status, created_at, updated_at,
        client_name, station_name, dscc_ref, attendance_date
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        syncId,
        1,
        1,
        JSON.stringify(heroData),
        'draft',
        created,
        created,
        'Synth, Test-用户',
        'Synthetic Police Station',
        'SYN-DSCC-001',
        '2026-10-19',
      ]
    );
    db.run(
      `INSERT INTO attendances (
        sync_id, sync_version, sync_dirty, data, status, created_at, updated_at,
        client_name, station_name, dscc_ref, attendance_date
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        crypto.randomUUID(),
        1,
        0,
        JSON.stringify({ control: true, note: 'unchanged sibling' }),
        'draft',
        created,
        created,
        'Control, Record',
        'Other Station',
        'SYN-CTRL-002',
        '2026-10-18',
      ]
    );

    const beforeHero = rowSnapshot(db, 1);
    const beforeControl = rowSnapshot(db, 2);
    assert.ok(beforeHero);
    assert.ok(beforeControl);

    const plainExport = db.export();
    const encrypted = encryptBuffer(Buffer.from(plainExport), MASTER_KEY);
    fs.writeFileSync(backupPath, encrypted);
    const verified = verifyEncryptedBackupFile(backupPath);
    assert.equal(verified.ok, true);

    // Simulate live corruption / accidental overwrite after backup was taken.
    db.run(
      `UPDATE attendances SET data = ?, client_name = ?, sync_dirty = 1 WHERE id = 1`,
      [JSON.stringify({ corrupted: true }), 'CORRUPTED']
    );
    assert.notDeepEqual(JSON.parse(rowSnapshot(db, 1).data), heroData);

    const backupPlain = decryptBuffer(fs.readFileSync(backupPath), MASTER_KEY);
    assert.ok(backupPlain);
    const candActive = countActiveAttendancesInPlainDb(SQL, backupPlain);
    const liveActive = countActiveAttendancesInPlainDb(SQL, Buffer.from(db.export()));
    const gate = mayRestoreBackupOverLive(
      { readable: true, magicOk: true, verified: true, activeCount: candActive },
      { activeCount: liveActive }
    );
    assert.equal(gate.allowed, true, gate.reason);

    const restoredDb = new SQL.Database(backupPlain);
    const afterHero = rowSnapshot(restoredDb, 1);
    const afterControl = rowSnapshot(restoredDb, 2);
    assert.deepEqual(JSON.parse(afterHero.data), heroData);
    assert.deepEqual(JSON.parse(afterControl.data), JSON.parse(beforeControl.data));
    assert.equal(afterHero.sync_id, beforeHero.sync_id);
    assert.equal(afterHero.dscc_ref, beforeHero.dscc_ref);
    assert.equal(afterHero.attendance_date, beforeHero.attendance_date);
    assert.equal(afterControl.client_name, beforeControl.client_name);

    restoredDb.close();
    db.close();
  });

  it('refuses empty backup over live data (failure case)', async () => {
    const { SQL, db } = await openMigratedDb();
    db.run(
      `INSERT INTO attendances (data, status, client_name) VALUES ('{}','draft','Live row')`
    );
    const livePlain = Buffer.from(db.export());
    const liveActive = countActiveAttendancesInPlainDb(SQL, livePlain);

    const emptyDb = new SQL.Database();
    runMigrations(emptyDb);
    const emptyPlain = Buffer.from(emptyDb.export());
    emptyDb.close();
    const emptyActive = countActiveAttendancesInPlainDb(SQL, emptyPlain);
    assert.equal(emptyActive, 0);

    const gate = mayRestoreBackupOverLive(
      { readable: true, magicOk: true, verified: true, activeCount: emptyActive },
      { activeCount: liveActive }
    );
    assert.equal(gate.allowed, false);
    assert.equal(gate.reason, 'refuse_empty_over_live');
    db.close();
  });

  it('amend after backup → mock central SoT holds updated envelope; restore baseline still matches pre-amend backup', async () => {
    resetMockSyncStores();
    const { SQL, db } = await openMigratedDb();
    const mock = createMockSyncServer();
    const apiBase = await mock.start();

    const syncId = crypto.randomUUID();
    const heroData = buildHeroData();
    db.run(
      `INSERT INTO attendances (
        id, sync_id, sync_version, sync_dirty, data, status, created_at, updated_at, client_name
      ) VALUES (1,?,?,?,?,?,?,?,?)`,
      [
        syncId,
        1,
        1,
        JSON.stringify(heroData),
        'draft',
        '2026-10-19T10:00:00.000Z',
        '2026-10-19T10:00:00.000Z',
        'Synth, Test-用户',
      ]
    );

    const baselinePlain = Buffer.from(db.export());
    fs.writeFileSync(backupPath, encryptBuffer(baselinePlain, MASTER_KEY));

    const helpers = {
      db,
      ...makeDbApi(db),
      flushDb: () => {},
      getSyncApiUrl: () => apiBase,
      readLicenceData: () => ({ key: LICENCE_KEY }),
      getMachineId: () => 'parity-device-a',
      getMasterKeyHex: () => MASTER_KEY,
      httpPost: async (url, body) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
        });
        return res.json();
      },
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      onStatusChange: () => {},
      sendToRenderer: () => {},
    };

    const worker = createSyncWorker(helpers);
    worker.enqueue('1', 'upsert', {});
    await worker.runCycle();
    const q = helpers.dbGet("SELECT status FROM sync_queue WHERE record_id='1'");
    assert.equal(q.status, 'synced');

    const amended = { ...heroData, interviewNotes: heroData.interviewNotes + '\nAmended line' };
    db.run(
      `UPDATE attendances SET data = ?, sync_dirty = 1, sync_version = sync_version + 1, updated_at = ? WHERE id = 1`,
      [JSON.stringify(amended), '2026-10-19T11:00:00.000Z']
    );
    worker.enqueue('1', 'upsert', {});
    await worker.runCycle();

    const pullResp = await fetch(`${apiBase}/api/sync/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: LICENCE_KEY, machineId: 'parity-device-b', since: '1970-01-01T00:00:00.000Z' }),
    }).then((r) => r.json());
    assert.equal(pullResp.ok, true);
    const remote = (pullResp.records || []).find((r) => r.syncId === syncId);
    assert.ok(remote);
    const payload = decryptSyncEnvelope(MASTER_KEY, remote.envelope);
    assert.ok(payload);
    assert.match(payload.data, /Amended line/);

    const restoredPlain = decryptBuffer(fs.readFileSync(backupPath), MASTER_KEY);
    const restoredDb = new SQL.Database(restoredPlain);
    const baselineRow = rowSnapshot(restoredDb, 1);
    assert.deepEqual(JSON.parse(baselineRow.data), heroData);
    assert.doesNotMatch(baselineRow.data, /Amended line/);
    restoredDb.close();
    db.close();
    await mock.stop();
  });

  it('simulated primary DB loss: restore from backup file rebuilds full active set', async () => {
    const { SQL, db } = await openMigratedDb();
    db.run(
      `INSERT INTO attendances (sync_id, sync_version, sync_dirty, data, status, created_at, updated_at, client_name)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        crypto.randomUUID(),
        1,
        0,
        JSON.stringify(buildHeroData()),
        'draft',
        '2026-10-19T10:00:00.000Z',
        '2026-10-19T10:00:00.000Z',
        'Synth, Test-用户',
      ]
    );
    const expected = allActiveSnapshots(db);
    assert.equal(expected.length, 1);
    const enc = encryptBuffer(Buffer.from(db.export()), MASTER_KEY);
    fs.writeFileSync(path.join(tmpDir, 'loss-sim.db'), enc);
    db.close();

    const plain = decryptBuffer(fs.readFileSync(path.join(tmpDir, 'loss-sim.db')), MASTER_KEY);
    const rebuilt = new SQL.Database(plain);
    const after = allActiveSnapshots(rebuilt);
    assert.deepEqual(after, expected);
    assert.equal(countActiveAttendancesInPlainDb(SQL, plain), 1);
    rebuilt.close();
  });
});
