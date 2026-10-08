'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createSyncWorker } = require('../main/syncWorker');
const { deriveSyncFooterChip } = require('../lib/footerStatusChips');
const {
  applyFreeSyncSubscription,
  subscriptionIsFreeSync,
  isDeviceRevokedHttpError,
  isFreeQuotaHttpError,
  deviceRevokedUserMessage,
  DEVICE_DEACTIVATED_MESSAGE,
  ADMIN_DEVICE_REVOKED_MESSAGE,
  LOCAL_ONLY_CHIP,
} = require('../lib/syncAccountState');
const { resolveTier, computeLicenceStatus } = require('../main/computeLicenceStatus');
const { bootstrapSyncAfterSignIn, shouldRunFirstSignInMerge } = require('../lib/signedInSyncBootstrap');
const { countTowardFreeQuota } = require('../lib/freeSyncQuota');
const { applyStoredServerTier, isDeviceNotActivatedHttpError } = require('../lib/syncAccountState');
const { emptyCloudPullPolicy } = require('../lib/syncLocalPreserve');
const { describeSkipReason, SYNC_SKIP_REASONS } = require('../lib/syncCycleAudit');

const root = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const licenceJs = fs.readFileSync(path.join(root, 'renderer', 'licence.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function createMockCtx(overrides) {
  const tables = { sync_queue: [], attendances: [], settings: [] };
  function dbAll(sql) {
    if (sql.includes('FROM sync_queue')) {
      let rows = tables.sync_queue.slice();
      if (sql.includes("status = 'pending'") || sql.includes("status IN ('pending','syncing')")) {
        rows = rows.filter((r) => r.status === 'pending' || (sql.includes('syncing') && r.status === 'syncing'));
      }
      if (sql.includes('ORDER BY created_at ASC')) rows.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
      return rows;
    }
    if (sql.includes('FROM attendances')) return tables.attendances.slice();
    return [];
  }
  function dbGet(sql, params) {
    params = params || [];
    if (sql.includes('COUNT(*)') && sql.includes('attendances')) {
      return { c: tables.attendances.length };
    }
    if (sql.includes('COUNT(*)')) {
      let rows = tables.sync_queue.slice();
      if (sql.includes('pending')) rows = rows.filter((r) => r.status === 'pending' || r.status === 'syncing');
      if (sql.includes("status='failed'") || sql.includes('status=\'failed\'')) rows = rows.filter((r) => r.status === 'failed');
      if (sql.includes('blocked')) rows = rows.filter((r) => r.status === 'blocked');
      return { c: rows.length };
    }
    if (sql.includes('retry_count FROM sync_queue')) {
      return tables.sync_queue.find((r) => r.id === params[0]) || null;
    }
    if (sql.includes('FROM sync_queue WHERE id=?')) {
      return tables.sync_queue.find((r) => r.id === params[0]) || null;
    }
    if (sql.includes('FROM attendances WHERE id=?')) {
      return tables.attendances.find((r) => String(r.id) === String(params[0])) || null;
    }
    return null;
  }
  function dbRun(sql, params) {
    params = params || [];
    if (sql.startsWith('DELETE FROM sync_queue WHERE record_id=?')) {
      tables.sync_queue = tables.sync_queue.filter((r) => r.record_id !== String(params[0]));
      return;
    }
    if (sql.startsWith('INSERT INTO sync_queue')) {
      tables.sync_queue.push({
        id: params[0],
        record_id: params[1],
        operation: params[2],
        payload: params[3],
        created_at: params[4],
        retry_count: 0,
        last_attempt: params[5],
        status: params[6],
        error: params[7] || null,
      });
      return;
    }
    if (sql.startsWith('UPDATE sync_queue SET status=?, error=?, retry_count=?, last_attempt=?')) {
      const row = tables.sync_queue.find((r) => r.id === params[4]);
      if (row) {
        row.status = params[0];
        row.error = params[1];
        row.retry_count = params[2];
        row.last_attempt = params[3];
      }
      return;
    }
    if (sql.startsWith('UPDATE sync_queue SET status=?, error=?, last_attempt=?')) {
      const row = tables.sync_queue.find((r) => r.id === params[3]);
      if (row) {
        row.status = params[0];
        row.error = params[1];
        row.last_attempt = params[2];
      }
      return;
    }
    if (sql.startsWith('UPDATE sync_queue SET status=?, last_attempt=?')) {
      const row = tables.sync_queue.find((r) => r.id === params[2]);
      if (row) {
        row.status = params[0];
        row.last_attempt = params[1];
      }
      return;
    }
    if (sql.startsWith('UPDATE sync_queue SET status=?')) {
      const row = tables.sync_queue.find((r) => r.id === params[1]);
      if (row) row.status = params[0];
    }
  }
  function addAttendance(id) {
    tables.attendances.push({
      id: String(id),
      sync_id: 'sid-' + id,
      data: '{}',
      status: 'draft',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
      deletion_reason: null,
      client_name: 'A',
      station_name: '',
      dscc_ref: '',
      attendance_date: '',
      supervisor_approved_at: null,
      supervisor_note: '',
      archived_at: null,
      sync_dirty: 1,
      sync_version: 1,
    });
  }
  const calls = { post: [], get: 0 };
  const ctx = Object.assign({
    db: true,
    dbRun,
    dbGet,
    dbAll,
    flushDb: function () {},
    getSyncApiUrl: function () { return 'https://test.example.com'; },
    readLicenceData: function () { return { key: 'CN-AAAA-BBBB-CCCC-DDDD' }; },
    getMachineId: function () { return 'machine'; },
    getMasterKeyHex: function () { return 'ab'.repeat(32); },
    httpPost: async function (url) {
      calls.post.push(url);
      return { ok: true, written: 1 };
    },
    httpGetWithTimeout: async function () {
      calls.get += 1;
      return { statusCode: 200, ok: true };
    },
    onStatusChange: function () {},
    sendToRenderer: function () {},
    deviceRevokedBackoffMs: 60 * 60 * 1000,
    freeQuotaBackoffMs: 60 * 60 * 1000,
  }, overrides || {});
  return { ctx, tables, addAttendance, calls };
}

describe('synthetic FREE/TRIAL keys do not call sync', () => {
  it('FREE- key makes no health, push, or pull calls and keeps the outbox', async () => {
    const mock = createMockCtx({
      readLicenceData: function () { return { key: 'FREE-ABCDEF0123456789', tier: 'free', isFree: true }; },
    });
    mock.addAttendance(1);
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('1', 'upsert', {});
    const result = await worker.runCycle();
    assert.equal(result.reason, 'local_only');
    assert.equal(mock.calls.post.length, 0);
    assert.equal(mock.calls.get, 0);
    assert.equal(mock.tables.sync_queue.length, 1);
    assert.equal(mock.tables.sync_queue[0].status, 'pending');
    assert.equal(worker.getConnectivity(), 'local_only');
    const chip = deriveSyncFooterChip({
      enabled: true,
      localOnly: true,
      lastSyncSkipReason: 'local_only',
      connectivity: 'local_only',
      pendingChanges: 1,
    });
    assert.equal(chip.text, LOCAL_ONLY_CHIP);
    assert.doesNotMatch(chip.text, /Invalid licence|Activate licence/i);
  });

  it('TRIAL- key is also local-only', async () => {
    const mock = createMockCtx({
      readLicenceData: function () { return { key: 'TRIAL-ABCDEF0123456789', isTrial: true }; },
    });
    mock.addAttendance(1);
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('1', 'upsert', {});
    await worker.runCycle();
    assert.equal(mock.calls.post.length, 0);
    assert.equal(mock.calls.get, 0);
  });
});

describe('403 DEVICE_REVOKED keeps the outbox', () => {
  function revokedError(opts) {
    const err = new Error((opts && opts.message) || 'This device has been revoked');
    err.statusCode = 403;
    if (!opts || opts.bodyCode !== null) err.bodyCode = (opts && opts.bodyCode) || 'DEVICE_REVOKED';
    if (opts && opts.deviceRevokedBy) err.deviceRevokedBy = opts.deviceRevokedBy;
    return err;
  }

  it('does not mark queued notes failed or blocked, and backs off', async () => {
    const mock = createMockCtx({
      httpPost: async function (url) {
        mock.calls.post.push(url);
        throw revokedError();
      },
    });
    mock.addAttendance(7);
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('7', 'upsert', {});
    const first = await worker.runCycle();
    assert.equal(first.reason, 'device_revoked');
    assert.equal(mock.tables.sync_queue.length, 1);
    assert.equal(mock.tables.sync_queue[0].status, 'pending');
    assert.notEqual(mock.tables.sync_queue[0].status, 'failed');
    assert.notEqual(mock.tables.sync_queue[0].status, 'blocked');
    assert.equal(mock.tables.sync_queue[0].retry_count, 0);
    assert.equal(mock.tables.attendances[0].sync_dirty, 1);
    const postsAfterFirst = mock.calls.post.length;
    assert.ok(postsAfterFirst >= 1);
    const second = await worker.runCycle();
    assert.equal(second.reason, 'device_revoked');
    assert.equal(mock.calls.post.length, postsAfterFirst, 'backoff must not hammer push');
    assert.equal(mock.tables.sync_queue[0].status, 'pending');
    const chip = deriveSyncFooterChip({
      enabled: true,
      deviceRevoked: true,
      lastSyncSkipReason: 'device_revoked',
      pendingChanges: 1,
      lastError: 'Server error 403',
    });
    assert.equal(chip.text, DEVICE_DEACTIVATED_MESSAGE);
    assert.equal(chip.action, 'open_licence');
    assert.equal(chip.cursor, 'pointer');
    assert.equal(
      deriveSyncFooterChip({ enabled: true, deviceRevoked: true, deviceRevokedBy: 'admin' }).text,
      ADMIN_DEVICE_REVOKED_MESSAGE
    );
  });

  it('treats the revoked message without a body code as DEVICE_REVOKED', () => {
    const err = new Error('This device has been revoked');
    err.statusCode = 403;
    assert.equal(isDeviceRevokedHttpError(err), true);
    assert.equal(isDeviceRevokedHttpError(Object.assign(new Error('nope'), { statusCode: 403 })), false);
  });

  it('a plain 403 still blocks; it is not retryable', async () => {
    const mock = createMockCtx({
      httpPost: async function () {
        const err = new Error('Server error 403');
        err.statusCode = 403;
        throw err;
      },
    });
    mock.addAttendance(3);
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('3', 'upsert', {});
    await worker.runCycle();
    assert.equal(mock.tables.sync_queue[0].status, 'blocked');
  });
});

describe('FREE_QUOTA_EXCEEDED is visible and non-destructive', () => {
  it('leaves notes pending and dirty', async () => {
    const mock = createMockCtx({
      httpPost: async function () {
        const err = new Error('FREE_QUOTA_EXCEEDED');
        err.statusCode = 409;
        err.bodyCode = 'FREE_QUOTA_EXCEEDED';
        throw err;
      },
    });
    mock.addAttendance(4);
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('4', 'upsert', {});
    const result = await worker.runCycle();
    assert.equal(result.reason, 'free_quota_exceeded');
    assert.equal(mock.tables.sync_queue[0].status, 'pending');
    assert.equal(mock.tables.attendances[0].sync_dirty, 1);
    assert.equal(isFreeQuotaHttpError({ statusCode: 413, bodyCode: 'FREE_QUOTA_EXCEEDED', message: '' }), true);
    const chip = deriveSyncFooterChip({ enabled: true, freeQuotaExceeded: true, pendingChanges: 2, lastPush: { ok: false } });
    assert.match(chip.text, /Free sync limit reached/);
    assert.match(chip.title, /Nothing was deleted/);
  });
});

describe('free sign-in tier', () => {
  it('auth poll free and free_sync set tier free so resolveTier is not Pro', () => {
    const data = { key: 'CN-AAAA-BBBB-CCCC-DDDD', tier: 'pro', isTrial: true, cloudBackup: true, entitlements: { quickfile: {} } };
    assert.equal(subscriptionIsFreeSync({ tier: 'free' }), true);
    assert.equal(subscriptionIsFreeSync({ plan: 'free_sync' }), true);
    assert.equal(applyFreeSyncSubscription(data, { tier: 'free', plan: 'free_sync', licenceKey: data.key }).applied, true);
    assert.equal(data.tier, 'free');
    assert.equal(data.isFree, true);
    assert.equal(data.isTrial, false);
    assert.equal(data.cloudBackup, false);
    assert.equal(data.entitlements, null);
    assert.equal(resolveTier(data), 'free');
    const st = computeLicenceStatus(data);
    assert.equal(st.tier, 'free');
    assert.notEqual(st.tier, 'pro');
  });
});

describe('first sign-in merge order', () => {
  it('enqueues local notes, pulls, then pushes, and an empty cloud does not delete them', async () => {
    const notes = [{ id: 1, client: 'Kept locally' }, { id: 2, client: 'Also kept' }];
    const order = [];
    let deleted = 0;
    const result = await bootstrapSyncAfterSignIn({
      countLocalAttendances: async function () { return notes.length; },
      ensureCanonicalSyncKey: async function () { order.push('canonical'); return { ok: true, action: 'match' }; },
      enqueueAllLocalAttendances: async function () { order.push('enqueue'); return notes.length; },
      pullAndMerge: async function () {
        order.push('pull');
        const policy = emptyCloudPullPolicy({ remoteRecords: [], localActiveCount: notes.length });
        assert.equal(policy.mayWipeLocal, false);
        assert.equal(policy.reason, 'empty_cloud_keeps_local');
        return { pulled: 0, received: 0 };
      },
      pushPending: async function () { order.push('push'); },
      fullResyncFromCloud: async function () { order.push('full'); throw new Error('must not full-resync when local notes exist'); },
    });
    assert.deepEqual(order, ['canonical', 'enqueue', 'pull', 'push']);
    assert.equal(result.mode, 'merge_existing_local');
    assert.equal(result.enqueued, 2);
    assert.equal(result.wipedLocal, false);
    assert.equal(deleted, 0);
    assert.equal(notes.length, 2);
  });

  it('empty computer does escrow then full re-sync', async () => {
    const order = [];
    const result = await bootstrapSyncAfterSignIn({
      countLocalAttendances: async function () { return 0; },
      ensureCanonicalSyncKey: async function () { order.push('canonical'); return { ok: true, action: 'adopted_no_local' }; },
      enqueueAllLocalAttendances: async function () { order.push('enqueue'); return 0; },
      pullAndMerge: async function () { order.push('pull'); return { pulled: 0 }; },
      pushPending: async function () { order.push('push'); },
      fullResyncFromCloud: async function () { order.push('full'); return { pulled: 4, received: 4 }; },
    });
    assert.deepEqual(order, ['canonical', 'full']);
    assert.equal(result.mode, 'full_resync_empty');
    assert.equal(result.wipedLocal, false);
  });
});

describe('explicit activate sends intent and copy is wired', () => {
  it('intent activate is only on licence:activate', () => {
    const activateSlice = mainJs.slice(
      mainJs.indexOf("ipcMain.handle('licence:activate'"),
      mainJs.indexOf("ipcMain.handle('licence:validate'")
    );
    const validateSlice = mainJs.slice(
      mainJs.indexOf("ipcMain.handle('licence:validate'"),
      mainJs.indexOf("ipcMain.handle('licence:deactivate'")
    );
    assert.match(activateSlice, /intent:\s*'activate'/);
    assert.match(activateSlice, /validateLicenceOnline\(normalizedKey,\s*machineId,\s*\{\s*intent:\s*'activate'\s*\}\)/);
    assert.doesNotMatch(validateSlice, /intent:\s*'activate'/);
    assert.doesNotMatch(validateSlice, /body\.intent/);
    const onlineFn = mainJs.slice(mainJs.indexOf('async function validateLicenceOnline'), mainJs.indexOf('async function validateLicenceOnline') + 1800);
    assert.match(onlineFn, /opts && opts\.intent === 'activate'/);
    assert.match(onlineFn, /body\.intent = 'activate'/);
    const backupFn = mainJs.slice(mainJs.indexOf('async function checkCloudBackupEntitlement'), mainJs.indexOf('async function checkCloudBackupEntitlement') + 2200);
    assert.doesNotMatch(backupFn, /intent/);
    assert.match(backupFn, /if \(isFree\)/);
  });

  it('surfaces device revoked copy and free sign-in without removing the free overlay bypass', () => {
    assert.match(indexHtml, /Sign in with email to sync your computers/);
    assert.match(indexHtml, /id="licence-free-sync-signin"/);
    assert.match(indexHtml, /id="home-free-sync-signin-prompt"/);
    assert.match(appJs, /This computer was deactivated for sync — re-enter your key or sign in again to restore\./);
    assert.match(appJs, /This computer's sync access was revoked by the administrator/);
    assert.match(appJs, /goToLicenceSettings/);
    assert.match(licenceJs, /authMagicLink/);
    assert.match(licenceJs, /function shouldBypassLoginOverlay\(status\) \{\s*if \(isFreeTierStatus\(status\) && createAllowed\(status\)\) return true;/);
    assert.match(mainJs, /applyFreeSyncSubscription\(data, resp\.subscription\)/);
    assert.match(mainJs, /bootstrapSyncAfterSignInNow\(\)/);
    assert.match(mainJs, /isSyntheticLocalLicenceKey\(data\.key\)/);
    assert.match(mainJs, /enqueueAllLocalAttendancesForSync/);
    assert.equal(describeSkipReason(SYNC_SKIP_REASONS.DEVICE_REVOKED), DEVICE_DEACTIVATED_MESSAGE);
    assert.equal(deviceRevokedUserMessage({ deviceRevokedBy: 'administrator' }), ADMIN_DEVICE_REVOKED_MESSAGE);
  });
});

describe('first sign-in activates this computer before bootstrap', () => {
  it('auth:poll validates with machineId and intent activate before the merge', () => {
    const poll = mainJs.slice(mainJs.indexOf("ipcMain.handle('auth:poll'"), mainJs.indexOf("ipcMain.handle('auth:logout'"));
    const activateAt = poll.indexOf('activateThisComputerForSync()');
    const bootstrapAt = poll.indexOf('bootstrapSyncAfterSignInNow()');
    assert.ok(activateAt > 0 && bootstrapAt > activateAt);
    const fn = mainJs.slice(mainJs.indexOf('async function activateThisComputerForSync'), mainJs.indexOf("ipcMain.handle('licence:activate'"));
    assert.match(fn, /getMachineId\(\)/);
    assert.match(fn, /intent:\s*'activate'/);
    assert.match(fn, /applyStoredServerTier/);
  });

  it('runs the full enqueue only when the key is new or was local', () => {
    assert.equal(shouldRunFirstSignInMerge('', 'CNF-AAAA-BBBB-CCCC-DDDD'), true);
    assert.equal(shouldRunFirstSignInMerge('FREE-ABCDEF0123456789', 'CNF-AAAA-BBBB-CCCC-DDDD'), true);
    assert.equal(shouldRunFirstSignInMerge('TRIAL-ABCDEF0123456789', 'CN-AAAA-BBBB-CCCC-DDDD'), true);
    assert.equal(shouldRunFirstSignInMerge('CN-AAAA-BBBB-CCCC-DDDD', 'CN-AAAA-BBBB-CCCC-DDDD'), false);
    assert.equal(shouldRunFirstSignInMerge('CN-AAAA-BBBB-CCCC-DDDD', 'CN-1111-2222-3333-4444'), true);
  });

  it('stores the server tier on activate, including a pasted CNF- key', () => {
    const data = { key: 'CNF-AAAA-BBBB-CCCC-DDDD' };
    assert.equal(applyStoredServerTier(data, {}).tier, 'free');
    assert.equal(resolveTier(data), 'free');
    const upgraded = { key: 'CNF-AAAA-BBBB-CCCC-DDDD', tier: 'free', entitlements: { quickfile: {} }, cloudBackup: true };
    assert.equal(applyStoredServerTier(upgraded, { tier: 'pro' }).tier, 'pro');
    assert.equal(upgraded.isFree, false);
    assert.equal(resolveTier(upgraded), 'pro');
    const activateSlice = mainJs.slice(
      mainJs.indexOf("ipcMain.handle('licence:activate'"),
      mainJs.indexOf("ipcMain.handle('licence:validate'")
    );
    assert.match(activateSlice, /applyStoredServerTier\(data, result\)/);
  });
});

describe('DEVICE_NOT_ACTIVATED keeps the outbox and re-validates once', () => {
  function notActivated() {
    const err = new Error('DEVICE_NOT_ACTIVATED');
    err.statusCode = 403;
    err.bodyCode = 'DEVICE_NOT_ACTIVATED';
    return err;
  }

  it('recognises the 403 code', () => {
    assert.equal(isDeviceNotActivatedHttpError(notActivated()), true);
    assert.equal(isDeviceNotActivatedHttpError(Object.assign(new Error('nope'), { statusCode: 403 })), false);
  });

  it('leaves the note pending and dirty, then backs off', async () => {
    let activations = 0;
    const mock = createMockCtx({
      deviceNotActivatedBackoffMs: 60 * 60 * 1000,
      activateDeviceForSync: async function () {
        activations += 1;
        return { ok: false, valid: false };
      },
      httpPost: async function () {
        mock.calls.post.push('push');
        throw notActivated();
      },
    });
    mock.addAttendance(8);
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('8', 'upsert', {});
    const first = await worker.runCycle();
    assert.equal(first.reason, 'device_not_activated');
    assert.equal(mock.tables.sync_queue[0].status, 'pending');
    assert.equal(mock.tables.sync_queue[0].retry_count, 0);
    assert.equal(mock.tables.attendances[0].sync_dirty, 1);
    assert.equal(activations, 1);
    const posts = mock.calls.post.length;
    const second = await worker.runCycle();
    assert.equal(second.reason, 'device_not_activated');
    assert.equal(mock.calls.post.length, posts);
    assert.equal(activations, 1);
  });

  it('retries the push after a successful re-validate', async () => {
    let n = 0;
    const mock = createMockCtx({
      activateDeviceForSync: async function () { return { ok: true, valid: true }; },
      httpPost: async function () {
        n += 1;
        mock.calls.post.push(n);
        if (n === 1) throw notActivated();
        return { ok: true, written: 1 };
      },
    });
    mock.addAttendance(9);
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('9', 'upsert', {});
    const result = await worker.runCycle();
    assert.notEqual(result.reason, 'device_not_activated');
    assert.equal(n, 2);
    assert.equal(mock.tables.sync_queue[0].status, 'synced');
  });
});

describe('first-sign-in lock, purge guard, and non-growing quota pushes', () => {
  it('runExclusive makes a poll cycle skip without calling push', async () => {
    const mock = createMockCtx();
    mock.addAttendance(1);
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('1', 'upsert', {});
    let release;
    const held = worker.runExclusive(function () {
      return new Promise(function (resolve) { release = resolve; });
    });
    const cycle = await worker.runCycle();
    assert.equal(cycle.reason, 'in_progress');
    assert.equal(mock.calls.post.length, 0);
    assert.equal(mock.tables.sync_queue[0].status, 'pending');
    release();
    await held;
  });

  it('purge does not call the cloud for a synthetic key', () => {
    const idx = mainJs.indexOf('/api/sync/purge');
    assert.ok(idx > 0);
    const slice = mainJs.slice(idx - 800, idx + 1400);
    assert.match(slice, /isSyntheticLocalLicenceKey/);
    assert.match(slice, /synthetic_local_key/);
  });

  it('tombstones do not count toward the free quota estimate', () => {
    assert.equal(countTowardFreeQuota([
      { id: 1 },
      { id: 2, deleted_at: '2026-01-01T00:00:00.000Z' },
      { id: 3, deletion_reason: 'user' },
    ]), 1);
  });

  it('a free-quota batch still pushes an edit of a note the server already has', async () => {
    const mock = createMockCtx({
      getCloudPresenceProof: function () { return { cloudSyncIds: ['sid-known'] }; },
      httpPost: async function (url, body) {
        const ids = ((body && body.records) || []).map(function (r) { return r.syncId; });
        mock.calls.post.push(ids.join(','));
        if (ids.indexOf('sid-new') !== -1) {
          const err = new Error('FREE_QUOTA_EXCEEDED');
          err.statusCode = 409;
          err.bodyCode = 'FREE_QUOTA_EXCEEDED';
          throw err;
        }
        return { ok: true, written: ids };
      },
    });
    mock.addAttendance('new');
    mock.addAttendance('known');
    mock.tables.attendances[0].sync_id = 'sid-new';
    mock.tables.attendances[1].sync_id = 'sid-known';
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('new', 'upsert', {});
    worker.enqueue('known', 'upsert', {});
    const result = await worker.runCycle();
    assert.equal(result.reason, 'free_quota_exceeded');
    const known = mock.tables.sync_queue.find(function (r) { return r.record_id === 'known'; });
    const fresh = mock.tables.sync_queue.find(function (r) { return r.record_id === 'new'; });
    assert.equal(known.status, 'synced');
    assert.equal(fresh.status, 'pending');
    assert.equal(fresh.retry_count, 0);
    assert.equal(mock.tables.attendances[0].sync_dirty, 1);
  });
});

describe('duplicate sync rows are folded, not copied again', () => {
  it('collapse backs up and repoints before delete, and does not enqueue a tombstone', () => {
    const fn = mainJs.slice(
      mainJs.indexOf('function collapseDuplicateAttendanceSyncId'),
      mainJs.indexOf('async function syncPull')
    );
    const backupAt = fn.indexOf('backupThenMoveFoldFiles');
    const deleteAt = fn.indexOf('DELETE FROM attendances WHERE id=');
    assert.ok(backupAt > 0 && deleteAt > backupAt);
    assert.match(fn, /repointFoldedAttendanceRows/);
    assert.match(fn, /sync_merge_base/);
    assert.match(fn, /record_revisions/);
    assert.match(fn, /billing_audit_log/);
    assert.match(fn, /UPDATE sync_queue SET record_id=/);
    assert.match(fn, /enqueueSyncForRecord\(keeper\.id, 'upsert'/);
    assert.match(fn, /assignFreshSyncId/);
    assert.match(fn, /encryptBuffer: encryptBuffer/);
    assert.match(fn, /decryptBuffer: decryptBuffer/);
    assert.doesNotMatch(fn, /enqueueSyncForRecord\([^)]*'delete'/);
    assert.match(mainJs, /mergeAttendanceRecords/);
    assert.doesNotMatch(mainJs, /recordSyncConflict\(local\.id, local, remote, 'preserve_local_dirty'\)/);
  });
});

describe('deleted rows push as content-free tombstones', () => {
  it('sends tombstone:true and omits the note body for free and Pro', async () => {
    let pushed = null;
    const mock = createMockCtx({
      httpPost: async function (url, body) {
        pushed = body;
        mock.calls.post.push(url);
        return { ok: true, written: 1 };
      },
    });
    mock.addAttendance(1);
    mock.tables.attendances[0].deleted_at = '2026-04-01T00:00:00.000Z';
    mock.tables.attendances[0].deletion_reason = 'user_delete';
    mock.tables.attendances[0].client_name = 'Secret Client';
    mock.tables.attendances[0].data = JSON.stringify({ surname: 'Secret' });
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('1', 'upsert', {});
    const result = await worker.runCycle();
    assert.notEqual(result.reason, 'local_only');
    assert.ok(pushed && Array.isArray(pushed.records));
    const rec = pushed.records[0];
    assert.equal(rec.tombstone, true);
    assert.equal(rec.syncId, 'sid-1');
    assert.equal(rec.deletedAt, '2026-04-01T00:00:00.000Z');
    assert.equal(rec.envelope, undefined);
    assert.equal(rec.data, undefined);
    assert.equal(rec.clientName, undefined);
    assert.equal(JSON.stringify(rec).includes('Secret'), false);
    assert.equal(mock.tables.sync_queue[0].status, 'synced');
  });
});

describe('activation lock and background revoke', () => {
  it('waitUntilIdle inside runExclusive returns without the 90s stall', async () => {
    const mock = createMockCtx();
    const worker = createSyncWorker(mock.ctx);
    const start = Date.now();
    const idle = await worker.runExclusive(async function () {
      return worker.waitUntilIdle(90000, { insideExclusive: true });
    });
    const elapsed = Date.now() - start;
    assert.equal(idle, true);
    assert.ok(elapsed < 1000, 'elapsed ' + elapsed);
  });

  it('waitUntilIdle still waits for the lock unless insideExclusive is set', async () => {
    const mock = createMockCtx();
    const worker = createSyncWorker(mock.ctx);
    const start = Date.now();
    const idle = await worker.runExclusive(async function () {
      return worker.waitUntilIdle(250);
    });
    assert.equal(idle, false);
    assert.ok(Date.now() - start >= 200);
    assert.match(mainJs, /runFullSyncFromCloud\(\{ insideExclusive: true \}\)/);
  });

  it('waitUntilIdle from outside still waits for the exclusive run', async () => {
    const mock = createMockCtx();
    const worker = createSyncWorker(mock.ctx);
    let release;
    const held = worker.runExclusive(function () {
      return new Promise(function (resolve) { release = resolve; });
    });
    const start = Date.now();
    const pending = worker.waitUntilIdle(2000);
    await new Promise(function (resolve) { setTimeout(resolve, 120); });
    release();
    const idle = await pending;
    await held;
    assert.equal(idle, true);
    assert.ok(Date.now() - start >= 100);
  });

  it('background validate does not retry the queue while the device is revoked', () => {
    const start = mainJs.indexOf("ipcMain.handle('licence:validate'");
    const slice = mainJs.slice(start, start + 2200);
    assert.match(slice, /!result\.deviceRevoked && !\(data && data\.deviceRevoked\)/);
    assert.match(slice, /retrySyncQueueAfterLicenceSuccess\(\)/);
  });

  it('auth poll stays pending until the server returns an access token', () => {
    const start = licenceJs.indexOf('function startPolling');
    const slice = licenceJs.slice(start, start + 1400);
    assert.match(slice, /resp && resp\.ok && resp\.accessToken/);
    assert.doesNotMatch(slice, /if \(resp\.ok\) \{/);
    assert.match(slice, /resp\.status === 'failed'/);
    assert.match(slice, /showError\(resp\.error/);
    assert.match(licenceJs, /Login link sent\. Open it and click Confirm sign-in in your browser\./);
  });
});
