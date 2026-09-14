'use strict';

/**
 * tests/staleSyncCatchUp.test.js
 * Triggers + classification for sell-ready stale-device catch-up UX.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  shouldRunStaleCatchUp,
  isLargeVersionJump,
  versionJumpUnits,
  classifyCatchUpConflict,
  partitionConflictsForCatchUp,
  isRemoteNewerConflict,
  STALE_SYNC_MS,
} = require('../lib/staleSyncCatchUp');

describe('staleSyncCatchUp triggers', () => {
  const now = Date.parse('2026-09-14T12:00:00.000Z');

  it('runs when last successful sync is older than 7 days', () => {
    const res = shouldRunStaleCatchUp({
      lastSuccessfulSyncAt: '2026-06-01T00:00:00.000Z',
      lastSeenAppVersion: '1.9.100',
      currentAppVersion: '1.9.100',
      now,
    });
    assert.strictEqual(res.run, true);
    assert.strictEqual(res.reason, 'stale_sync');
    assert.ok(res.daysSinceSync >= 7);
  });

  it('does not run for a recent sync with same version', () => {
    const res = shouldRunStaleCatchUp({
      lastSuccessfulSyncAt: '2026-09-13T12:00:00.000Z',
      lastSeenAppVersion: '1.9.100',
      currentAppVersion: '1.9.100',
      now,
    });
    assert.strictEqual(res.run, false);
    assert.strictEqual(res.reason, 'fresh');
  });

  it('runs on large version jump (1.9.18 → 1.9.100)', () => {
    assert.ok(isLargeVersionJump('1.9.18', '1.9.100'));
    assert.ok(versionJumpUnits('1.9.18', '1.9.100') >= 20);
    const res = shouldRunStaleCatchUp({
      lastSuccessfulSyncAt: '2026-09-13T12:00:00.000Z',
      lastSeenAppVersion: '1.9.18',
      currentAppVersion: '1.9.100',
      now,
    });
    assert.strictEqual(res.run, true);
    assert.strictEqual(res.reason, 'version_jump');
  });

  it('does not treat a tiny patch bump as a large jump', () => {
    assert.strictEqual(isLargeVersionJump('1.9.99', '1.9.100'), false);
  });

  it('runs when never synced (epoch / missing pull cursor)', () => {
    const res = shouldRunStaleCatchUp({
      lastSuccessfulSyncAt: null,
      lastSeenAppVersion: null,
      currentAppVersion: '1.9.100',
      now,
    });
    assert.strictEqual(res.run, true);
    assert.strictEqual(res.reason, 'never_synced');
  });

  it('respects syncEnabled=false', () => {
    const res = shouldRunStaleCatchUp({
      lastSuccessfulSyncAt: '2026-01-01T00:00:00.000Z',
      currentAppVersion: '1.9.100',
      syncEnabled: false,
      now,
    });
    assert.strictEqual(res.run, false);
    assert.strictEqual(res.reason, 'sync_disabled');
  });

  it('exposes STALE_SYNC_MS as 7 days', () => {
    assert.strictEqual(STALE_SYNC_MS, 7 * 24 * 60 * 60 * 1000);
  });
});

describe('staleSyncCatchUp conflict classification', () => {
  it('auto-accepts protect_finalised when remote is newer (force)', () => {
    const cls = classifyCatchUpConflict({
      reason: 'protect_finalised',
      localVersion: 2,
      remoteVersion: 9,
      currentLocalStatus: 'finalised',
    });
    assert.strictEqual(cls.action, 'auto_accept_remote');
    assert.strictEqual(cls.force, true);
  });

  it('pauses for human on preserve_local_dirty (true local edits)', () => {
    const cls = classifyCatchUpConflict({
      reason: 'preserve_local_dirty',
      localVersion: 3,
      remoteVersion: 5,
    });
    assert.strictEqual(cls.action, 'needs_human');
  });

  it('skips when remote is not newer', () => {
    const cls = classifyCatchUpConflict({
      reason: 'revision_backwards',
      localVersion: 10,
      remoteVersion: 4,
    });
    assert.strictEqual(cls.action, 'skip');
  });

  it('partitions a Robsprgr-style mixed batch without auto keep_local', () => {
    const parts = partitionConflictsForCatchUp([
      { id: 1, reason: 'protect_finalised', localVersion: 1, remoteVersion: 4, currentLocalStatus: 'finalised' },
      { id: 2, reason: 'protect_finalised', localVersion: 1, remoteVersion: 3, currentLocalStatus: 'completed' },
      { id: 3, reason: 'preserve_local_dirty', localVersion: 2, remoteVersion: 5 },
      { id: 4, reason: 'preserve_local_dirty', localVersion: 2, remoteVersion: 6 },
      { id: 5, reason: 'remote_newer', localVersion: 1, remoteVersion: 2 },
    ]);
    assert.strictEqual(parts.autoAccept.length, 3);
    assert.strictEqual(parts.needsHuman.length, 2);
    assert.ok(parts.autoAccept.every((x) => x.classify.action === 'auto_accept_remote'));
    assert.ok(parts.needsHuman.every((x) => x.conflict.reason === 'preserve_local_dirty'));
  });

  it('isRemoteNewerConflict uses updatedAt when versions tie', () => {
    assert.strictEqual(
      isRemoteNewerConflict({
        localVersion: 2,
        remoteVersion: 2,
        localUpdatedAt: '2026-01-01T00:00:00.000Z',
        remoteUpdatedAt: '2026-02-01T00:00:00.000Z',
      }),
      true
    );
  });
});
