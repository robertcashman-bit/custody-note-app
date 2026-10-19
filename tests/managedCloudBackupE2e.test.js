'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const initSqlJs = require('sql.js');
const crypto = require('crypto');

const { encryptBuffer, decryptBuffer } = require('../lib/dbCrypto');
const { mapBackupError } = require('../lib/backupErrorMap');
const {
  uploadManagedCloudBackupWithRetry,
  downloadManagedCloudBackupObject,
  listManagedCloudBackupKeys,
} = require('../lib/managedCloudBackupOps');
const { createInMemoryS3Store, createInMemoryS3Client } = require('./fixtures/inMemoryS3Client');
const { runMigrations } = require('../main/dbMigrations');
const { mayRestoreBackupOverLive, countActiveAttendancesInPlainDb } = require('../lib/backupIntegrityGate');

const CREDS = {
  region: 'eu-west-2',
  bucket: 'cn-test-bucket',
  prefix: 'user-synthetic-001',
  accessKeyId: 'TEST',
  secretAccessKey: 'TEST',
  sessionToken: 'TEST',
};

function buildSyntheticDb() {
  return initSqlJs().then((sql) => {
    const db = new sql.Database();
    runMigrations(db);
    const data = JSON.stringify({
      client: { surname: 'Synth', forename: 'Cloud' },
      notes: 'Unicode — cloud backup E2E',
    });
    db.run(
      `INSERT INTO attendances (sync_id, sync_version, sync_dirty, data, status, created_at, updated_at, client_name)
       VALUES (?,?,?,?,?,?,?,?)`,
      [crypto.randomUUID(), 1, 0, data, 'draft', '2026-10-19T12:00:00.000Z', '2026-10-19T12:00:00.000Z', 'Synth, Cloud']
    );
    return { db, plain: Buffer.from(db.export()) };
  });
}

describe('Managed cloud backup E2E (in-memory S3)', () => {
  let store;

  beforeEach(() => {
    store = createInMemoryS3Store();
  });

  it('upload → amend → re-upload → restore after primary loss preserves every field', async () => {
    const { db, plain } = await buildSyntheticDb();
    const key = crypto.randomBytes(8).toString('hex') + '.db';
    const encV1 = encryptBuffer(plain, 'ab'.repeat(32));
    const up1 = await uploadManagedCloudBackupWithRetry({
      creds: CREDS,
      buffer: encV1,
      key,
      createClient: () => createInMemoryS3Client(store, CREDS),
      sleep: () => Promise.resolve(),
    });
    assert.equal(up1.ok, true);

    db.run("UPDATE attendances SET data = ?, client_name = 'Synth, Cloud Amended' WHERE id = 1", [
      JSON.stringify({ client: { surname: 'Synth', forename: 'Cloud' }, notes: 'Amended line' }),
    ]);
    const encV2 = encryptBuffer(Buffer.from(db.export()), 'ab'.repeat(32));
    const up2 = await uploadManagedCloudBackupWithRetry({
      creds: CREDS,
      buffer: encV2,
      key: key + '.v2',
      createClient: () => createInMemoryS3Client(store, CREDS),
      sleep: () => Promise.resolve(),
    });
    assert.equal(up2.ok, true);

    const listed = await listManagedCloudBackupKeys({
      creds: CREDS,
      createClient: () => createInMemoryS3Client(store, CREDS),
    });
    assert.ok(listed.length >= 2);

    const dl = await downloadManagedCloudBackupObject({
      creds: CREDS,
      backupKey: key,
      createClient: () => createInMemoryS3Client(store, CREDS),
    });
    assert.equal(dl.ok, true);
    const restoredPlain = decryptBuffer(dl.buffer, 'ab'.repeat(32));
    const SQL = await initSqlJs();
    const restoredDb = new SQL.Database(restoredPlain);
    const row = restoredDb.exec("SELECT data, client_name FROM attendances WHERE id=1")[0].values[0];
    assert.match(String(row[0]), /Unicode/);
    assert.equal(row[1], 'Synth, Cloud');
    restoredDb.close();
    db.close();
  });

  it('auth failure surfaces PERMISSION_DENIED without silent success', async () => {
    const mapped = mapBackupError(new Error('AccessDenied: not authorized'));
    assert.equal(mapped.code, 'PERMISSION_DENIED');
    const client = {
      send() {
        return Promise.reject(new Error('AccessDenied'));
      },
    };
    const result = await uploadManagedCloudBackupWithRetry({
      creds: CREDS,
      buffer: Buffer.from('x'),
      key: 'fail.db',
      createClient: () => client,
      sleep: () => Promise.resolve(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PERMISSION_DENIED');
    assert.match(result.error, /permission denied/i);
  });

  it('quota and 5xx map to user-visible codes', () => {
    assert.equal(mapBackupError(new Error('QuotaExceeded')).code, 'QUOTA_EXCEEDED');
    assert.equal(mapBackupError(new Error('503 Service Unavailable')).code, 'NETWORK_ERROR');
  });

  it('restore gate refuses empty cloud object over live rows', async () => {
    const SQL = await initSqlJs();
    const live = new SQL.Database();
    runMigrations(live);
    live.run("INSERT INTO attendances (data, status) VALUES ('{}','draft')");
    const liveActive = countActiveAttendancesInPlainDb(SQL, Buffer.from(live.export()));
    const empty = new SQL.Database();
    runMigrations(empty);
    const emptyActive = countActiveAttendancesInPlainDb(SQL, Buffer.from(empty.export()));
    const gate = mayRestoreBackupOverLive(
      { readable: true, magicOk: true, verified: true, activeCount: emptyActive },
      { activeCount: liveActive }
    );
    assert.equal(gate.allowed, false);
    live.close();
    empty.close();
  });
});
