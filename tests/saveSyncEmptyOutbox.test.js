const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { deriveSaveSyncButton } = require('../lib/saveSyncButton');

const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const handler = main.slice(main.indexOf("ipcMain.handle('persist-and-backup'"), main.indexOf("ipcMain.handle('flush-and-backup'"));

describe('Save & Sync with an empty outbox (all rows synced, nothing dirty)', () => {
  it('confirms central without needing a push in this session (works after restart)', () => {
    const emptyBranch = handler.slice(handler.indexOf('// Every queue row is'), handler.indexOf('if (!localOnly && !offline && !authRequired)'));
    assert.match(emptyBranch, /centralConfirmed = true;/);
    assert.doesNotMatch(emptyBranch, /if \(diag && diag\.lastVerifiedCloudPushAt\) \{\s*centralConfirmed = true/);
  });

  it('un-confirms if the pull left notes pending or dirty', () => {
    assert.match(handler, /if \(pendingCount \+ dirtyCount > 0\) centralConfirmed = false;/);
  });

  it('no longer reports the no_verified_push skip reason', () => {
    assert.doesNotMatch(handler, /'no_verified_push'/);
  });

  it('button shows Saved & synced for a clear outbox with a good pull', () => {
    const v = deriveSaveSyncButton({ phase: 'result', noteDurable: true, backupOk: true, centralConfirmed: true, pullOk: true, pendingCount: 0, timeLabel: '22:40' });
    assert.strictEqual(v.state, 'synced');
    assert.match(v.label, /Saved & synced 22:40/);
  });

  it('still not synced when the pull failed', () => {
    const v = deriveSaveSyncButton({ phase: 'result', noteDurable: true, backupOk: true, centralConfirmed: true, pullOk: false, pendingCount: 0, syncError: 'pull failed' });
    assert.notStrictEqual(v.state, 'synced');
  });
});
