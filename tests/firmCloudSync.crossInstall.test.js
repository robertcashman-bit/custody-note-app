'use strict';

/**
 * Two devices, same accountId, different licence keys — firms converge via cloud.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const initSqlJs = require('sql.js');
const crypto = require('crypto');
const { createMockSyncServer, getTestLicenceKey, resetMockSyncStores } = require('./fixtures/mockSyncServer.mjs');
const { pullFirmsFromCloud, pushDirtyFirmsToCloud } = require('../lib/firmCloudSync');
const { runMigrations } = require('../main/dbMigrations');

const KEY_A = getTestLicenceKey();
const KEY_B = 'SYNC-TEST-0002-KEY2';
const ACCOUNT_ID = 'acct-firm-sync-001';

async function initFirmDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  runMigrations(db);
  return db;
}

function dbApi(db) {
  return {
    dbRun(sql, params = []) { db.run(sql, params); },
    dbAll(sql, params = []) {
      const rows = [];
      const stmt = db.prepare(sql);
      stmt.bind(params);
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
  };
}

async function httpPostJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  return res.json();
}

describe('firm cloud sync across licence keys', () => {
  let mock;
  let apiBase;

  before(async () => {
    resetMockSyncStores();
    mock = createMockSyncServer();
    apiBase = await mock.start();
  });

  after(async () => {
    await mock.stop();
  });

  it('pushes from device A and merges on device B without losing edits', async () => {
    const masterKey = crypto.randomBytes(32).toString('hex');
    const dbA = await initFirmDb();
    const apiA = dbApi(dbA);
    apiA.dbRun(
      `INSERT INTO firms (sync_id, name, contact_email, updated_at, sync_version, sync_dirty)
       VALUES (?,?,?,?,?,1)`,
      ['firm-sync-1', 'Client Firm', 'a@firm.example', '2026-03-01T12:00:00.000Z', 1]
    );

    const depsA = {
      getSyncApiUrl: () => apiBase,
      readLicenceData: () => ({ key: KEY_A, accountId: ACCOUNT_ID, authToken: 'tok' }),
      normalizeLicenceKeyForSync: (k) => String(k).trim().toUpperCase(),
      getMachineId: () => 'machine-a',
      getMasterKeyHex: () => masterKey,
      httpPost: (url, body) => httpPostJson(url, body),
      dbAll: apiA.dbAll,
      dbRun: apiA.dbRun,
      markDbDirty: () => {},
      generateSyncId: () => 'firm-' + crypto.randomBytes(8).toString('hex'),
      getSetting: () => '1970-01-01T00:00:00.000Z',
      setSetting: () => {},
    };

    const pushA = await pushDirtyFirmsToCloud(depsA);
    assert.ok(pushA.pushed >= 1, pushA.error || 'push failed');

    const dbB = await initFirmDb();
    const apiB = dbApi(dbB);
    apiB.dbRun(
      `INSERT INTO firms (sync_id, name, contact_phone, updated_at, sync_version, sync_dirty)
       VALUES (?,?,?,?,?,0)`,
      ['firm-sync-1', 'Client Firm', 'local-only-phone', '2026-04-01T12:00:00.000Z', 2]
    );

    const depsB = {
      ...depsA,
      readLicenceData: () => ({ key: KEY_B, accountId: ACCOUNT_ID, authToken: 'tok' }),
      getMachineId: () => 'machine-b',
      dbAll: apiB.dbAll,
      dbRun: apiB.dbRun,
    };

    const pullB = await pullFirmsFromCloud(depsB);
    assert.ok(pullB.pulled >= 0);
    const row = apiB.dbAll('SELECT contact_email, contact_phone FROM firms WHERE sync_id=?', ['firm-sync-1'])[0];
    assert.ok(row);
    assert.strictEqual(row.contact_email, 'a@firm.example');
    assert.strictEqual(row.contact_phone, 'local-only-phone');
  });
});
