'use strict';

/**
 * Real SIGKILL mid atomic write: prior durable CNDB must survive; reopen verifies magic.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');

const { writeFileAtomicSync, getAtomicTempPath } = require('../lib/dbAtomicWrite');
const { encryptBuffer, decryptBuffer, MAGIC } = require('../lib/dbCrypto');
const { verifyEncryptedBackupFile } = require('../lib/backupVerify');
const { assessEncryptedDbFile } = require('../lib/dbStartupIntegrity');

describe('Kill during atomic write (child process)', () => {
  it('SIGKILL mid-write leaves previous on-disk CNDB intact and readable', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-kill-atomic-'));
    const dbPath = path.join(dir, 'attendances.db');
    const readyPath = path.join(dir, 'child-ready');
    const key = crypto.randomBytes(32).toString('hex');
    const canary = Buffer.from('CANARY-PRE-KILL-v2');
    writeFileAtomicSync(dbPath, encryptBuffer(canary, key));

    const childScript = `
      const fs = require('fs');
      const path = require('path');
      const { getAtomicTempPath } = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'dbAtomicWrite.js'))});
      const dbPath = ${JSON.stringify(dbPath)};
      const tmp = getAtomicTempPath(dbPath, process.pid);
      fs.writeFileSync(${JSON.stringify(readyPath)}, '1');
      fs.writeFileSync(tmp, Buffer.alloc(4096, 9));
      setInterval(() => {}, 500);
    `;
    const child = spawn(process.execPath, ['-e', childScript], { stdio: 'ignore' });
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(readyPath) && Date.now() < deadline) {
      spawnSync(process.execPath, ['-e', ''], { timeout: 30 });
    }
    assert.ok(fs.existsSync(readyPath), 'child should reach write phase');
    child.kill('SIGKILL');
    spawnSync(process.execPath, ['-e', ''], { timeout: 100 });

    const onDisk = fs.readFileSync(dbPath);
    assert.strictEqual(onDisk.slice(0, 4).toString(), MAGIC);
    assert.strictEqual(decryptBuffer(onDisk, key).toString(), canary.toString());
    assert.strictEqual(assessEncryptedDbFile(onDisk).ok, true);
    assert.strictEqual(verifyEncryptedBackupFile(dbPath).ok, true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('orphan tmp after simulated crash does not replace committed file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-tmp-orphan-'));
    const dbPath = path.join(dir, 'attendances.db');
    const key = crypto.randomBytes(32).toString('hex');
    writeFileAtomicSync(dbPath, encryptBuffer(Buffer.from('committed'), key));
    const tmp = getAtomicTempPath(dbPath);
    fs.writeFileSync(tmp, encryptBuffer(Buffer.from('partial-never-renamed'), key));
    assert.ok(fs.existsSync(dbPath));
    const plain = decryptBuffer(fs.readFileSync(dbPath), key);
    assert.strictEqual(plain.toString(), 'committed');
    fs.unlinkSync(tmp);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
