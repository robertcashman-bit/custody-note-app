'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { deriveSaveSyncButton, STATES } = require('../lib/saveSyncButton');

const root = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

const baseOk = {
  phase: 'result',
  dirty: false,
  noteDurable: true,
  backupOk: true,
  centralConfirmed: true,
  pullOk: true,
  pendingCount: 0,
  offline: false,
  localOnly: false,
  timeLabel: '15:04',
};

describe('Save & Sync button states', () => {
  it('shows unsaved, then saving, and does not claim synced early', () => {
    const unsaved = deriveSaveSyncButton({ dirty: true, noteDurable: true, backupOk: true, centralConfirmed: true, pullOk: true });
    assert.equal(unsaved.state, STATES.UNSAVED);
    assert.equal(unsaved.tone, 'unsaved');
    assert.equal(unsaved.label, 'Unsaved changes');

    const saving = deriveSaveSyncButton({ phase: 'saving', dirty: true, noteDurable: true, backupOk: true, centralConfirmed: true, pullOk: true });
    assert.equal(saving.state, STATES.SAVING);
    assert.equal(saving.label, 'Saving\u2026');
    assert.match(saving.title, /keep typing/i);
  });

  it('says saved and synced only when disk, backup, push and pull all succeeded', () => {
    const ok = deriveSaveSyncButton(baseOk);
    assert.equal(ok.state, STATES.SYNCED);
    assert.equal(ok.tone, 'synced');
    assert.equal(ok.label, '\u2713 Saved & synced 15:04');

    const noBackup = deriveSaveSyncButton(Object.assign({}, baseOk, { backupOk: false, backupError: 'Backup folder is not writable' }));
    assert.equal(noBackup.state, STATES.FAILED);
    assert.equal(noBackup.label, 'Saved, backup failed');
    assert.match(noBackup.hint, /not writable/);
    assert.match(noBackup.title, /Saved, backup failed/);
    assert.doesNotMatch(noBackup.label, /synced/i);

    const noDisk = deriveSaveSyncButton(Object.assign({}, baseOk, { noteDurable: false, error: 'Disk flush failed' }));
    assert.equal(noDisk.state, STATES.FAILED);
    assert.match(noDisk.title, /Disk flush failed/);

    const noPush = deriveSaveSyncButton(Object.assign({}, baseOk, { centralConfirmed: false, pendingCount: 2 }));
    assert.equal(noPush.state, STATES.PENDING);
    assert.equal(noPush.label, 'Saved on this computer, sync pending');
    assert.equal(noPush.tone, 'pending');

    const noPull = deriveSaveSyncButton(Object.assign({}, baseOk, { pullOk: false }));
    assert.equal(noPull.state, STATES.PENDING);
    assert.doesNotMatch(noPull.label, /Saved & synced/);
  });

  it('uses the pending state when offline and the local-only hint when the user cannot sync', () => {
    const offline = deriveSaveSyncButton(Object.assign({}, baseOk, { offline: true, centralConfirmed: false, pullOk: false, pendingCount: 1 }));
    assert.equal(offline.state, STATES.PENDING);
    assert.match(offline.title, /offline/i);

    const local = deriveSaveSyncButton(Object.assign({}, baseOk, { localOnly: true, centralConfirmed: true, pullOk: true }));
    assert.equal(local.state, STATES.LOCAL_ONLY);
    assert.equal(local.label, 'Saved on this computer');
    assert.equal(local.hint, 'Sign in to sync');
    assert.doesNotMatch(local.label, /synced/i);
  });

  it('the top-bar control is the only Save & Sync button and stays keyboard focusable', () => {
    const headerIdx = indexHtml.indexOf('class="header-right"');
    const btnIdx = indexHtml.indexOf('id="header-backup-now-btn"');
    assert.ok(headerIdx > 0 && btnIdx > headerIdx);
    assert.ok(indexHtml.indexOf('</header>') > btnIdx);
    assert.match(indexHtml, /aria-keyshortcuts="Control\+S Meta\+S"/);
    assert.match(indexHtml, /class="save-sync-label"/);
    assert.doesNotMatch(indexHtml, /id="form-backup-now-btn"/);
    assert.match(styles, /\.save-sync-btn:focus-visible/);
    assert.match(styles, /data-tone="unsaved"/);
    assert.match(styles, /data-tone="failed"/);
    assert.match(appJs, /aria-busy/);
    assert.doesNotMatch(appJs.slice(appJs.indexOf('function handleSaveNowClick'), appJs.indexOf('function handleSaveNowClick') + 2500), /btn\.disabled\s*=\s*true/);
    const persistIdx = mainJs.indexOf("ipcMain.handle('persist-and-backup'");
    const chunk = mainJs.slice(persistIdx, persistIdx + 12000);
    assert.match(chunk, /flushDbSync\(\)/);
    assert.match(chunk, /runManualVerifiedBackup/);
    assert.match(chunk, /drainPendingSyncUploads/);
    assert.match(chunk, /syncPull\(/);
    assert.match(chunk, /localOnly/);
    assert.match(chunk, /pullOk/);
    const pullAt = chunk.indexOf('syncPull(');
    const recountAt = chunk.indexOf('Recount after pull');
    assert.ok(pullAt > 0 && recountAt > pullAt);
  });
});
