'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { assessEncryptedDbFile } = require('../lib/dbStartupIntegrity');
const { encryptBuffer, MAGIC } = require('../lib/dbCrypto');

describe('dbStartupIntegrity', () => {
  it('accepts valid CNDB magic', () => {
    const buf = encryptBuffer(Buffer.from('plain'), crypto.randomBytes(32).toString('hex'));
    const r = assessEncryptedDbFile(buf);
    assert.equal(r.ok, true);
    assert.equal(r.magicOk, true);
  });

  it('rejects empty and bad magic', () => {
    assert.equal(assessEncryptedDbFile(null).reason, 'missing_buffer');
    assert.equal(assessEncryptedDbFile(Buffer.alloc(10)).reason, 'suspiciously_small');
    const bad = Buffer.from('xxxx' + 'rest');
    bad[0] = MAGIC.charCodeAt(0);
    assert.equal(assessEncryptedDbFile(bad).ok, false);
  });

  it('initDb wires assessEncryptedDbFile before decrypt', () => {
    const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const idx = mainJs.indexOf('async function initDb');
    assert.ok(idx > 0);
    const chunk = mainJs.slice(idx, idx + 3500);
    assert.match(chunk, /assessEncryptedDbFile\(rawBuf\)/);
    assert.match(chunk, /integrity check/);
  });

  it('initDb takes pre-migration safety copy when schema behind latest', () => {
    const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const idx = mainJs.indexOf('const migrationResult = runDbMigrations');
    assert.ok(idx > 0);
    const chunk = mainJs.slice(idx - 1200, idx + 200);
    assert.match(chunk, /createDbSafetyCopy\('pre-migration'\)/);
    assert.match(chunk, /schemaBefore < LATEST_VERSION/);
  });
});
