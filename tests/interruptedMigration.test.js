'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const initSqlJs = require('sql.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { runMigrations, getCurrentVersion, MIGRATIONS } = require('../main/dbMigrations');
const { encryptBuffer, decryptBuffer } = require('../lib/dbCrypto');
const { writeFileAtomicSync } = require('../lib/dbAtomicWrite');

function scalar(db, sql) {
  const stmt = db.prepare(sql);
  const v = stmt.step() ? Object.values(stmt.getAsObject())[0] : null;
  stmt.free();
  return v;
}

describe('Interrupted / failed schema migration', () => {
  it('failed migration rolls back — user rows and schema_version unchanged', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    runMigrations(db);
    db.run("INSERT INTO attendances (data, status, client_name) VALUES ('{\"keep\":1}','draft','Synth Client')");
    const beforeCount = Number(scalar(db, 'SELECT COUNT(*) FROM attendances'));
    const beforeVer = getCurrentVersion(db);
    const plainBefore = Buffer.from(db.export());

    const failing = MIGRATIONS.concat([
      {
        version: 9999,
        name: 'test-only-throws',
        up(ctx) {
          ctx.run("INSERT INTO attendances (data, status) VALUES ('{\"boom\":1}','draft')");
          throw new Error('SIMULATED_MIGRATION_INTERRUPT');
        },
      },
    ]);

    assert.throws(
      () =>
        runMigrations(db, {
          _testMigrations: failing,
          logger: { error: () => {} },
        }),
      /SIMULATED_MIGRATION_INTERRUPT/
    );

    assert.strictEqual(Number(scalar(db, 'SELECT COUNT(*) FROM attendances')), beforeCount);
    assert.strictEqual(
      scalar(db, "SELECT data FROM attendances WHERE client_name='Synth Client'"),
      '{"keep":1}'
    );
    assert.strictEqual(getCurrentVersion(db), beforeVer);
    assert.deepStrictEqual(Buffer.from(db.export()), plainBefore);
    db.close();
  });

  it('pre-migration safety copy pattern preserves plaintext export on disk', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-pre-mig-'));
    const safetyPath = path.join(dir, 'attendance-safety-pre-migration.db');
    const key = crypto.randomBytes(32).toString('hex');
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    runMigrations(db);
    db.run("INSERT INTO attendances (data, status, client_name) VALUES ('{\"mig\":1}','draft','Mig Test')");
    const plain = Buffer.from(db.export());
    writeFileAtomicSync(safetyPath, encryptBuffer(plain, key));

    const failing = MIGRATIONS.concat([
      {
        version: 9998,
        name: 'test-only-throws-2',
        up() {
          throw new Error('MIG_FAIL');
        },
      },
    ]);
    assert.throws(() => runMigrations(db, { _testMigrations: failing }), /MIG_FAIL/);

    const recovered = decryptBuffer(fs.readFileSync(safetyPath), key);
    const db2 = new SQL.Database(recovered);
    assert.strictEqual(
      scalar(db2, "SELECT client_name FROM attendances WHERE client_name='Mig Test'"),
      'Mig Test'
    );
    db.close();
    db2.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
