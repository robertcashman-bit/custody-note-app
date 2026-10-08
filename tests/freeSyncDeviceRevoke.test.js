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
const { bootstrapSyncAfterSignIn } = require('../lib/signedInSyncBootstrap');
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
