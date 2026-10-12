const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const L = require('../lib/syncDiagLog');
const { interpretForceSaveDrain } = require('../lib/forceSaveDrainPolicy');
const { deriveSaveSyncButton } = require('../lib/saveSyncButton');

describe('syncDiagLog', () => {
  it('summarizes queue metadata only, never payload', () => {
    const now = 1_000_000;
    const s = L.summarizeQueue([
      { id: 'q1', record_id: 7, operation: 'upsert', status: 'pending', retry_count: 2, last_attempt: now - 5000, created_at: now - 9000, error: 'HTTP 400\nbad', payload: '{"client":"SECRET"}' },
      { id: 'q2', record_id: 8, operation: 'upsert', status: 'syncing', retry_count: 0, last_attempt: 0 },
    ], { now });
    assert.deepStrictEqual(s.counts, { pending: 1, syncing: 1 });
    assert.strictEqual(s.items[0].lastError, 'HTTP 400 bad');
    assert.strictEqual(s.items[0].ageSinceAttemptSec, 5);
    assert.ok(!JSON.stringify(s).includes('SECRET'));
  });

  it('finds syncing rows older than 5 minutes only', () => {
    const now = 10 * 60_000;
    const stuck = L.findStuckSyncing([
      { id: 'a', status: 'syncing', last_attempt: now - 6 * 60_000 },
      { id: 'b', status: 'syncing', last_attempt: now - 60_000 },
      { id: 'c', status: 'pending', last_attempt: 0 },
      { id: 'd', status: 'syncing', last_attempt: null },
    ], { now });
    assert.deepStrictEqual(stuck.map((r) => r.id), ['a', 'd']);
  });

  it('writes and rotates at the size limit', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-synclog-'));
    const log = L.createSyncDiagLog({ dir, maxBytes: 300 });
    for (let i = 0; i < 10; i++) log.write('save-sync-start', { i, pad: 'x'.repeat(50) });
    assert.ok(fs.existsSync(path.join(dir, 'sync.log')));
    assert.ok(fs.existsSync(path.join(dir, 'sync.log.1')));
    assert.ok(fs.statSync(path.join(dir, 'sync.log')).size <= 300);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('maps skip reasons to plain text', () => {
    assert.match(L.skipReasonText('in_progress'), /Another sync/);
    assert.match(L.skipReasonText('weird'), /Sync skipped: weird/);
    assert.strictEqual(L.skipReasonText(null), null);
  });
});

describe('Save & Sync shows skip reasons', () => {
  it('skipped drain is not "syncing" and carries a reason', () => {
    const r = interpretForceSaveDrain({ stoppedReason: 'skipped', skipReason: 'device_not_activated', pending: 1, dirty: 0 });
    assert.strictEqual(r.syncing, false);
    assert.strictEqual(r.centralConfirmed, false);
    assert.match(r.syncError, /not activated/);
  });

  it('max_cycles with no progress surfaces no_progress', () => {
    const r = interpretForceSaveDrain({ stoppedReason: 'max_cycles', skipReason: 'no_progress', pending: 2, dirty: 1 });
    assert.strictEqual(r.syncing, false);
    assert.match(r.syncError, /nothing was uploaded/);
  });

  it('button shows the reason even when offline if a skip reason is set', () => {
    const v = deriveSaveSyncButton({ phase: 'result', noteDurable: true, backupOk: true, centralConfirmed: false, pullOk: false, pendingCount: 1, offline: true, skipReason: 'offline', syncError: L.skipReasonText('offline') });
    assert.strictEqual(v.label, 'Saved on this computer, not synced');
    assert.match(v.hint, /Wi-Fi/);
  });

  it('button keeps plain pending label when offline without a skip reason', () => {
    const v = deriveSaveSyncButton({ phase: 'result', noteDurable: true, backupOk: true, centralConfirmed: false, pendingCount: 1, offline: true, syncError: 'x' });
    assert.strictEqual(v.label, 'Saved on this computer, sync pending');
  });
});
