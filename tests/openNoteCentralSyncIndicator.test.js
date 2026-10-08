'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { deriveOpenNoteCentralSyncState } = require('../lib/openNoteCentralSyncIndicator');

describe('openNoteCentralSyncIndicator', () => {
  it('dirty form never claims central', () => {
    const r = deriveOpenNoteCentralSyncState({
      dirty: true,
      durable: true,
      syncDirty: false,
      queuePending: false,
      savedSyncVersion: 3,
      currentSyncVersion: 3,
    });
    assert.strictEqual(r.centralConfirmed, false);
    assert.strictEqual(r.pendingSync, false);
  });

  it('not durable never claims central', () => {
    const r = deriveOpenNoteCentralSyncState({ durable: false, syncDirty: false, queuePending: false });
    assert.strictEqual(r.centralConfirmed, false);
    assert.strictEqual(r.pendingSync, false);
  });

  it('central confirmed when sync_dirty clear and queue empty', () => {
    const r = deriveOpenNoteCentralSyncState({
      durable: true,
      syncDirty: false,
      queuePending: false,
      savedSyncVersion: 4,
      currentSyncVersion: 4,
    });
    assert.strictEqual(r.centralConfirmed, true);
    assert.strictEqual(r.pendingSync, false);
  });

  it('pending when sync_dirty or queue still outstanding', () => {
    assert.deepStrictEqual(
      deriveOpenNoteCentralSyncState({
        durable: true,
        syncDirty: true,
        queuePending: false,
        savedSyncVersion: 2,
        currentSyncVersion: 2,
      }),
      { centralConfirmed: false, pendingSync: true }
    );
    assert.deepStrictEqual(
      deriveOpenNoteCentralSyncState({
        durable: true,
        syncDirty: false,
        queuePending: true,
        savedSyncVersion: 2,
        currentSyncVersion: 2,
      }),
      { centralConfirmed: false, pendingSync: true }
    );
  });

  it('stale ack: DB version ahead of last saved revision stays pending', () => {
    const r = deriveOpenNoteCentralSyncState({
      durable: true,
      syncDirty: false,
      queuePending: false,
      savedSyncVersion: 3,
      currentSyncVersion: 4,
    });
    assert.strictEqual(r.centralConfirmed, false);
    assert.strictEqual(r.pendingSync, true);
  });

  it('renderer wires refresh on background sync-status-changed', () => {
    const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    assert.match(appJs, /function refreshOpenNoteCentralSyncIndicator/);
    assert.match(appJs, /attendanceSyncAckState/);
    assert.match(appJs, /data\.status === 'synced'/);
    assert.match(appJs, /noteSaveIndicatorFromNormalizedSave/);
  });

  it('main exposes attendance-sync-ack-state IPC', () => {
    const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    assert.match(mainJs, /attendance-sync-ack-state/);
    assert.match(mainJs, /sync_version/);
  });

  it('save result includes syncVersion for revision tracking', () => {
    const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const idx = mainJs.indexOf('function finishAttendanceSaveResult');
    assert.ok(idx > 0);
    const end = mainJs.indexOf('\nipcMain.handle', idx);
    const chunk = mainJs.slice(idx, end > idx ? end : idx + 4000);
    assert.match(chunk, /syncVersion/);
  });
});
