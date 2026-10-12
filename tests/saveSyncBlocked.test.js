'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { interpretForceSaveDrain } = require('../lib/forceSaveDrainPolicy');
const { deriveSaveSyncButton, STATES } = require('../lib/saveSyncButton');

describe('Save & Sync: a note the server rejected is reported, not left "pending"', () => {
  it('blocked drain is not centralConfirmed and carries the server reason', () => {
    const r = interpretForceSaveDrain({ stoppedReason: 'blocked', pending: 1, dirty: 0, lastError: 'HTTP 400 bad record' });
    assert.equal(r.centralConfirmed, false);
    assert.equal(r.syncing, false);
    assert.match(r.syncError, /HTTP 400 bad record/);
  });
  it('button shows "not synced" with the reason when sync stopped', () => {
    const v = deriveSaveSyncButton({ noteDurable: true, backupOk: true, centralConfirmed: false, pullOk: true, pendingCount: 1, syncError: 'Sync failed: HTTP 400' });
    assert.equal(v.state, STATES.PENDING);
    assert.equal(v.label, 'Saved on this computer, not synced');
    assert.match(v.hint, /HTTP 400/);
  });
  it('drain loop checks blocked rows before claiming drained, and pre-count includes blocked', () => {
    const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const fn = main.slice(main.indexOf('async function drainPendingSyncUploads'));
    assert.match(fn.slice(0, 2500), /stoppedReason: 'blocked'/);
    const ipc = main.slice(main.indexOf("ipcMain.handle('persist-and-backup'"));
    assert.match(ipc.slice(0, 9000), /status IN \('pending','syncing','failed','blocked'\)"\);\n    const dirtyRow/);
  });
});
