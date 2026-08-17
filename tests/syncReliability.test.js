/**
 * Sync reliability: in-cycle retry with exponential backoff (real withRetry from syncWorker).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  withRetry,
  isRetryableError,
  IN_CYCLE_MAX_ATTEMPTS,
  IN_CYCLE_RETRY_BASE_MS,
  IN_CYCLE_RETRY_JITTER_MS,
  createSyncWorker,
} = require('../main/syncWorker');

const instantSleep = async () => {};

describe('sync reliability — withRetry', () => {
  it('returns result on first success', async () => {
    const result = await withRetry(() => Promise.resolve({ pushed: 5 }), {
      sleep: instantSleep,
      direction: 'push',
    });
    assert.strictEqual(result.pushed, 5);
  });

  it('retries and succeeds on second attempt without throwing', async () => {
    let calls = 0;
    const result = await withRetry(
      () => {
        calls++;
        if (calls === 1) {
          const e = new Error('Timeout');
          e.code = 'ETIMEDOUT';
          return Promise.reject(e);
        }
        return Promise.resolve({ pushed: 1 });
      },
      { sleep: instantSleep, direction: 'push' }
    );
    assert.strictEqual(result.pushed, 1);
    assert.strictEqual(calls, 2);
  });

  it('retries up to IN_CYCLE_MAX_ATTEMPTS then throws', async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry(
          () => {
            calls++;
            const e = new Error('Always fail');
            e.code = 'ETIMEDOUT';
            return Promise.reject(e);
          },
          { sleep: instantSleep, direction: 'push' }
        ),
      /Always fail/
    );
    assert.strictEqual(calls, IN_CYCLE_MAX_ATTEMPTS);
  });

  it('does not retry permanent 4xx errors', async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry(
          () => {
            calls++;
            const e = new Error('Server error 400');
            e.statusCode = 400;
            return Promise.reject(e);
          },
          { sleep: instantSleep, direction: 'push' }
        ),
      /Server error 400/
    );
    assert.strictEqual(calls, 1);
  });

  it('backoff delay shape is exponential (attempt 1: ~2s, attempt 2: ~4s)', () => {
    const d1 = IN_CYCLE_RETRY_BASE_MS * Math.pow(2, 0);
    const d2 = IN_CYCLE_RETRY_BASE_MS * Math.pow(2, 1);
    assert.strictEqual(d1, 2000);
    assert.strictEqual(d2, 4000);
    assert.ok(IN_CYCLE_RETRY_JITTER_MS >= 0);
    assert.strictEqual(IN_CYCLE_MAX_ATTEMPTS, 3);
  });

  it('classifies 429 and 5xx as retryable', () => {
    assert.strictEqual(isRetryableError(new Error('Server error 429')), true);
    assert.strictEqual(isRetryableError(new Error('Server error 503')), true);
    assert.strictEqual(isRetryableError(new Error('Too many requests')), true);
  });
});

describe('sync reliability — worker absorbs transient push blip in-cycle', () => {
  function createMiniCtx(httpPost) {
    const tables = { sync_queue: [], attendances: [] };
    return {
      tables,
      ctx: {
        db: true,
        sleep: instantSleep,
        inCycleRetryBaseMs: 0,
        inCycleRetryJitterMs: 0,
        dbRun(sql, params = []) {
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
          if (sql.startsWith('UPDATE sync_queue SET status=?')) {
            if (sql.includes('error=?') && sql.includes('retry_count=?')) {
              const row = tables.sync_queue.find((r) => r.id === params[4]);
              if (row) {
                row.status = params[0];
                row.error = params[1];
                row.retry_count = params[2];
                row.last_attempt = params[3];
              }
            } else if (sql.includes('error=NULL')) {
              const row = tables.sync_queue.find((r) => r.id === params[1]);
              if (row) {
                row.status = params[0];
                row.error = null;
              }
            } else {
              const row = tables.sync_queue.find((r) => r.id === params[2]);
              if (row) {
                row.status = params[0];
                row.last_attempt = params[1];
              }
            }
            return;
          }
          if (sql.startsWith('UPDATE attendances SET sync_dirty=0')) {
            const row = tables.attendances.find((r) => String(r.id) === String(params[0]));
            if (row) row.sync_dirty = 0;
          }
        },
        dbGet(sql, params = []) {
          if (sql.includes('COUNT(*)')) return { c: tables.sync_queue.filter((r) => r.status === 'pending' || r.status === 'syncing').length };
          if (sql.includes('FROM sync_queue WHERE id=?')) return tables.sync_queue.find((r) => r.id === params[0]) || null;
          if (sql.includes('FROM attendances WHERE id=?')) return tables.attendances.find((r) => String(r.id) === String(params[0])) || null;
          return null;
        },
        dbAll(sql) {
          if (sql.includes("status = 'pending'")) {
            return tables.sync_queue.filter((r) => r.status === 'pending').sort((a, b) => a.created_at - b.created_at);
          }
          return [];
        },
        flushDb() {},
        getSyncApiUrl: () => 'https://test.example.com',
        readLicenceData: () => ({ key: 'test-key' }),
        getMachineId: () => 'm1',
        getMasterKeyHex: () => 'a'.repeat(64),
        httpPost,
        httpGetWithTimeout: async () => ({ statusCode: 200 }),
        onStatusChange() {},
        sendToRenderer() {},
        syncPull: async () => ({ pulled: 0 }),
      },
    };
  }

  it('clears dirty / marks synced when push fails once then succeeds', async () => {
    let calls = 0;
    const statuses = [];
    const { ctx, tables } = createMiniCtx(async () => {
      calls++;
      if (calls === 1) {
        const e = new Error('Timeout');
        e.code = 'ETIMEDOUT';
        throw e;
      }
      return { ok: true };
    });
    ctx.sendToRenderer = (ch, data) => {
      if (ch === 'sync-status-changed') statuses.push(data && data.status);
    };
    tables.attendances.push({
      id: '1',
      sync_id: 'sid-1',
      data: '{}',
      status: 'draft',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      deleted_at: null,
      deletion_reason: null,
      client_name: '',
      station_name: '',
      dscc_ref: '',
      attendance_date: '',
      supervisor_approved_at: null,
      supervisor_note: '',
      archived_at: null,
      sync_dirty: 1,
      sync_version: 1,
    });
    const worker = createSyncWorker(ctx);
    worker.enqueue('1', 'upsert', {});
    await worker.runCycle();
    assert.strictEqual(calls, 2, 'should HTTP twice (fail then success)');
    assert.strictEqual(tables.sync_queue[0].status, 'synced');
    assert.strictEqual(tables.attendances[0].sync_dirty, 0);
    assert.ok(!statuses.includes('error'), 'must not surface Sync error after recovered blip');
    assert.ok(statuses.includes('synced') || statuses.includes('syncing'));
  });

  it('surfaces error only after in-cycle retries exhausted', async () => {
    let calls = 0;
    const statuses = [];
    const { ctx, tables } = createMiniCtx(async () => {
      calls++;
      const e = new Error('Timeout');
      e.code = 'ETIMEDOUT';
      throw e;
    });
    ctx.sendToRenderer = (ch, data) => {
      if (ch === 'sync-status-changed') statuses.push(data && data.status);
    };
    tables.attendances.push({
      id: '1',
      sync_id: 'sid-1',
      data: '{}',
      status: 'draft',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      deleted_at: null,
      deletion_reason: null,
      client_name: '',
      station_name: '',
      dscc_ref: '',
      attendance_date: '',
      supervisor_approved_at: null,
      supervisor_note: '',
      archived_at: null,
      sync_dirty: 1,
      sync_version: 1,
    });
    const worker = createSyncWorker(ctx);
    worker.enqueue('1', 'upsert', {});
    await worker.runCycle();
    assert.strictEqual(calls, IN_CYCLE_MAX_ATTEMPTS);
    assert.ok(tables.sync_queue[0].retry_count >= 1);
    assert.ok(statuses.includes('error'));
  });

  it('retries pull in-cycle before notifying Sync error', async () => {
    let pulls = 0;
    const statuses = [];
    const { ctx, tables } = createMiniCtx(async () => ({ ok: true }));
    ctx.syncPull = async () => {
      pulls++;
      if (pulls === 1) {
        const e = new Error('Pull failed');
        e.code = 'ETIMEDOUT';
        throw e;
      }
      return { pulled: 2, received: 2 };
    };
    ctx.sendToRenderer = (ch, data) => {
      if (ch === 'sync-status-changed') statuses.push(data && data.status);
      if (ch === 'records-updated-from-sync') statuses.push('records:' + data.count);
    };
    const worker = createSyncWorker(ctx);
    await worker.runCycle();
    assert.strictEqual(pulls, 2);
    assert.ok(!statuses.includes('error'));
    assert.ok(statuses.includes('records:2'));
  });
});
