/**
 * Immediate sync kick after outbox enqueue + trailing debounce behaviour (v1.9.94).
 *
 * Verifies:
 * - enqueue with scheduleOpts kicks runCycle promptly (no 10s poll wait)
 * - rapid scheduleSoon calls coalesce (trailing debounce)
 * - { immediate: true } bypasses debounce
 * - save mid-cycle re-kicks when the in-progress cycle finishes
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  createSyncWorker,
  SCHEDULE_SOON_DEBOUNCE_MS,
  SCHEDULE_IMMEDIATE_MS,
} = require('../main/syncWorker');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createMockCtx(overrides = {}) {
  const tables = {
    sync_queue: [],
    attendances: [],
    settings: [],
  };
  let cycleCount = 0;

  function dbAll(sql) {
    if (sql.includes('FROM sync_queue')) {
      let rows = [...tables.sync_queue];
      if (sql.includes("status = 'pending'")) rows = rows.filter((r) => r.status === 'pending');
      if (sql.includes("status = 'blocked'")) rows = rows.filter((r) => r.status === 'blocked');
      if (sql.includes("status != 'synced'")) rows = rows.filter((r) => r.status !== 'synced');
      if (sql.includes('ORDER BY created_at ASC')) rows.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
      const limitMatch = sql.match(/LIMIT\s+(\d+)/);
      if (limitMatch) rows = rows.slice(0, parseInt(limitMatch[1], 10));
      return rows;
    }
    return [];
  }

  function dbGet(sql, params = []) {
    if (sql.includes('COUNT(*)')) {
      let rows = [...tables.sync_queue];
      if (sql.includes("status IN ('pending','syncing')") || sql.includes("status = 'pending'")) {
        rows = rows.filter((r) => r.status === 'pending' || (sql.includes('syncing') && r.status === 'syncing'));
      }
      if (sql.includes("status='failed'")) rows = rows.filter((r) => r.status === 'failed');
      if (sql.includes("status='blocked'")) rows = rows.filter((r) => r.status === 'blocked');
      if (sql.includes('FROM attendances') && sql.includes('sync_dirty')) {
        return { c: tables.attendances.filter((r) => r.sync_dirty).length };
      }
      return { c: rows.length };
    }
    if (sql.includes('FROM sync_queue WHERE id=?')) {
      return tables.sync_queue.find((r) => r.id === params[0]) || null;
    }
    if (sql.includes('FROM attendances WHERE id=?')) {
      return tables.attendances.find((r) => String(r.id) === String(params[0])) || null;
    }
    if (sql.includes('FROM settings')) {
      return tables.settings.find((r) => r.key === params[0]) || null;
    }
    return null;
  }

  function dbRun(sql, params = []) {
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
        mutation_id: params[8] || null,
      });
      return;
    }
    if (sql.startsWith('UPDATE sync_queue SET status=?')) {
      if (sql.includes('retry_count=?')) {
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
  }

  tables.attendances.push({
    id: '1',
    sync_id: 'sid-1',
    data: '{}',
    status: 'draft',
    sync_dirty: 1,
    sync_version: 1,
  });

  let pullDelayMs = 0;
  let httpPostCalls = 0;

  const ctx = {
    db: true,
    dbRun,
    dbGet,
    dbAll,
    flushDb: () => {},
    getSyncApiUrl: () => 'https://test.example.com',
    readLicenceData: () => ({ key: 'test-key' }),
    getMachineId: () => 'test-machine',
    getMasterKeyHex: () => 'a'.repeat(64),
    scheduleSoonDebounceMs: 50,
    httpPost: async (url, body) => {
      httpPostCalls += 1;
      const writtenCount = body && Array.isArray(body.records) ? body.records.length : 1;
      return { ok: true, written: writtenCount };
    },
    httpGetWithTimeout: async () => ({ statusCode: 200, ok: true }),
    syncPull: async () => {
      cycleCount += 1;
      if (pullDelayMs > 0) await sleep(pullDelayMs);
      return { pulled: 0, received: 0, decryptFailed: 0 };
    },
    onStatusChange: () => {},
    sendToRenderer: () => {},
    ...overrides,
  };

  return {
    ctx,
    tables,
    getCycleCount: () => cycleCount,
    getHttpPostCalls: () => httpPostCalls,
    setPullDelay: (ms) => {
      pullDelayMs = ms;
    },
    resetCounters: () => {
      cycleCount = 0;
      httpPostCalls = 0;
    },
  };
}

describe('scheduleSoon debounce constants', () => {
  it('uses a light trailing debounce (250–500ms) and zero immediate delay', () => {
    assert.ok(SCHEDULE_SOON_DEBOUNCE_MS >= 250 && SCHEDULE_SOON_DEBOUNCE_MS <= 500);
    assert.strictEqual(SCHEDULE_IMMEDIATE_MS, 0);
  });
});

describe('enqueue → sync kicked promptly', () => {
  it('kicks a cycle after enqueue when scheduleOpts is provided (no poll start)', async () => {
    const mock = createMockCtx({ scheduleSoonDebounceMs: 40 });
    const worker = createSyncWorker(mock.ctx);
    // Do not call start() — only the enqueue kick should run a cycle.
    const qid = worker.enqueue('1', 'upsert', {}, {});
    assert.ok(qid);
    assert.strictEqual(mock.getCycleCount(), 0);
    await sleep(120);
    assert.ok(mock.getCycleCount() >= 1, 'runCycle should have been kicked after debounce');
    assert.ok(mock.getHttpPostCalls() >= 1, 'push should have started');
    worker.stop();
  });

  it('does not auto-kick when enqueue is called without scheduleOpts (unit-test path)', async () => {
    const mock = createMockCtx({ scheduleSoonDebounceMs: 20 });
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('1', 'upsert', {});
    await sleep(80);
    assert.strictEqual(mock.getCycleCount(), 0);
    worker.stop();
  });
});

describe('scheduleSoon debounce coalescing', () => {
  it('trailing-debounces rapid calls into one cycle', async () => {
    const mock = createMockCtx({ scheduleSoonDebounceMs: 80 });
    const worker = createSyncWorker(mock.ctx);
    worker.scheduleSoon();
    worker.scheduleSoon();
    worker.scheduleSoon();
    await sleep(40);
    assert.strictEqual(mock.getCycleCount(), 0, 'must not fire before debounce window');
    await sleep(80);
    assert.strictEqual(mock.getCycleCount(), 1, 'rapid calls coalesce to a single cycle');
    worker.stop();
  });

  it('immediate bypasses debounce with no meaningful delay', async () => {
    const mock = createMockCtx({ scheduleSoonDebounceMs: 500 });
    const worker = createSyncWorker(mock.ctx);
    worker.scheduleSoon({ immediate: true });
    await sleep(40);
    assert.ok(mock.getCycleCount() >= 1, 'immediate kick must not wait for debounce');
    worker.stop();
  });

  it('immediate wins over a pending debounced timer', async () => {
    const mock = createMockCtx({ scheduleSoonDebounceMs: 400 });
    const worker = createSyncWorker(mock.ctx);
    worker.scheduleSoon();
    await sleep(20);
    assert.strictEqual(mock.getCycleCount(), 0);
    worker.scheduleSoon({ immediate: true });
    await sleep(40);
    assert.ok(mock.getCycleCount() >= 1, 'immediate should clear debounce and fire now');
    worker.stop();
  });
});

describe('in-progress re-kick', () => {
  it('re-kicks after a save lands while a cycle is in progress', async () => {
    const mock = createMockCtx({ scheduleSoonDebounceMs: 20 });
    mock.setPullDelay(150);
    const worker = createSyncWorker(mock.ctx);

    const first = worker.runCycle();
    await sleep(20);
    // Mid-cycle enqueue (as Force Save / autosave would after durable write).
    worker.enqueue('1', 'upsert', {}, { immediate: true });
    await first;
    // Allow flushPendingKick setTimeout(0) + immediate timer + second cycle.
    await sleep(100);
    assert.ok(
      mock.getCycleCount() >= 2,
      'expected a follow-up cycle after in-progress kick, got ' + mock.getCycleCount()
    );
    worker.stop();
  });
});

describe('main.js wiring source guards', () => {
  it('enqueueSyncForRecord passes scheduleOpts through to worker.enqueue', () => {
    const fs = require('fs');
    const path = require('path');
    const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    assert.match(
      mainJs,
      /function enqueueSyncForRecord\(recordId, operation = 'upsert', scheduleOpts\)/
    );
    assert.match(mainJs, /w\.enqueue\(String\(recordId\), operation, \{\}, scheduleOpts \|\| \{\}\)/);
    assert.match(mainJs, /scheduleSyncSoon\(opts\)/);
    assert.match(mainJs, /enqueueSyncForRecord\(id, st === 'finalised' \? 'finalise' : 'upsert', syncKick\)/);
    assert.match(mainJs, /immediate: true/);
  });
});
