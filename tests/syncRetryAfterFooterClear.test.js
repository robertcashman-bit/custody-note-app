/**
 * Retry-After propagation from httpPost + footer clear after a 429 window.
 *
 * - httpPost copies Retry-After (or JSON retryAfterSeconds) onto err.retryAfter
 *   so the rate-limit gate waits exactly what the server asks; the 5-minute
 *   fallback applies only when neither is present.
 * - Regression lock: a healthy pull-only / empty-outbox cycle after a
 *   rate-limited one sends status 'synced' with rateLimited:false (via
 *   recordCycleOutcome) so "Safe locally — sync waiting" clears.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  extractRetryAfter,
  createRateLimitGate,
  RATE_LIMIT_COOLDOWN_MS,
} = require('../lib/syncPushAck');
const { createSyncWorker } = require('../main/syncWorker');

describe('extractRetryAfter', () => {
  it('prefers the Retry-After header (delta seconds)', () => {
    assert.strictEqual(extractRetryAfter('60', { retryAfterSeconds: 5 }), '60');
    assert.strictEqual(extractRetryAfter(['42'], null), '42');
  });

  it('accepts an HTTP-date header', () => {
    const d = new Date(Date.now() + 30_000).toUTCString();
    assert.strictEqual(extractRetryAfter(d, null), d);
  });

  it('falls back to JSON retryAfterSeconds', () => {
    assert.strictEqual(extractRetryAfter(undefined, { retryAfterSeconds: 17 }), 17);
    assert.strictEqual(extractRetryAfter('', { retryAfterSeconds: '9' }), 9);
    assert.strictEqual(extractRetryAfter('garbage', { retryAfterSeconds: 3 }), 3);
  });

  it('returns null when nothing usable is present', () => {
    assert.strictEqual(extractRetryAfter(undefined, null), null);
    assert.strictEqual(extractRetryAfter(undefined, { error: 'x' }), null);
    assert.strictEqual(extractRetryAfter('nope', { retryAfterSeconds: -1 }), null);
  });
});

describe('gate honours Retry-After carried by httpPost errors', () => {
  function errWith(retryAfter) {
    const err = new Error('Too many requests. Please try again later.');
    err.statusCode = 429;
    if (retryAfter != null) err.retryAfter = retryAfter;
    return err;
  }

  it('blocks for the server value (60s), not 5 minutes', () => {
    let now = 1_000_000;
    const gate = createRateLimitGate({ now: () => now, random: () => 0 });
    gate.noteError(errWith(extractRetryAfter('60', null)));
    assert.strictEqual(gate.remainingMs(), 60_000);
  });

  it('uses JSON retryAfterSeconds when the header is missing', () => {
    let now = 1_000_000;
    const gate = createRateLimitGate({ now: () => now, random: () => 0 });
    gate.noteError(errWith(extractRetryAfter(undefined, { retryAfterSeconds: 43 })));
    assert.strictEqual(gate.remainingMs(), 43_000);
  });

  it('keeps the 5-minute fallback only when neither is present', () => {
    let now = 1_000_000;
    const gate = createRateLimitGate({ now: () => now, random: () => 0 });
    gate.noteError(errWith(extractRetryAfter(undefined, null)));
    assert.strictEqual(gate.remainingMs(), RATE_LIMIT_COOLDOWN_MS);
  });
});

describe('httpPost source contract', () => {
  it('copies Retry-After / retryAfterSeconds onto err.retryAfter', () => {
    const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const start = mainJs.indexOf('function httpPost(');
    assert.ok(start > 0);
    const body = mainJs.slice(start, start + 4500);
    assert.match(body, /extractRetryAfter\(res\.headers && res\.headers\['retry-after'\], errBody\)/);
    assert.match(body, /err\.retryAfter = retryAfter/);
    assert.match(mainJs, /const \{ extractRetryAfter \} = require\('\.\/lib\/syncPushAck'\)/);
  });
});

function createCtx(clock, overrides = {}) {
  const sent = [];
  let pullImpl = async () => ({ pulled: 0, received: 0, decryptFailed: 0 });
  const ctx = {
    db: true,
    dbRun: () => {},
    dbGet: (sql) => (sql.includes('COUNT(*)') ? { c: 0 } : null),
    dbAll: () => [],
    flushDb: () => {},
    getSyncApiUrl: () => 'https://test.example.com',
    readLicenceData: () => ({ key: 'test-key' }),
    getMachineId: () => 'test-machine',
    getMasterKeyHex: () => 'a'.repeat(64),
    httpPost: async () => ({ ok: true, written: 0 }),
    httpGetWithTimeout: async () => ({ statusCode: 200, ok: true }),
    syncPull: () => pullImpl(),
    onStatusChange: () => {},
    sendToRenderer: (channel, payload) => {
      if (channel === 'sync-status-changed') sent.push(payload);
    },
    rateLimitGateOptions: { now: clock.now, random: () => 0 },
    ...overrides,
  };
  return {
    ctx,
    sent,
    setPull: (fn) => {
      pullImpl = fn;
    },
  };
}

describe('footer clears after the rate-limit window (pull-only cycles)', () => {
  it("sends 'synced' + rateLimited:false on the first healthy cycle after a 429", async () => {
    let t = 5_000_000;
    const clock = { now: () => t };
    const h = createCtx(clock);
    const worker = createSyncWorker(h.ctx);
    try {
      // 1) Pull hits 429 with Retry-After: 60.
      h.setPull(async () => {
        const err = new Error('Too many requests. Please try again later.');
        err.statusCode = 429;
        err.retryAfter = extractRetryAfter('60', null);
        throw err;
      });
      await worker.runCycle();
      const rl = h.sent.filter((p) => p && p.status === 'rate_limited');
      assert.ok(rl.length >= 1, 'renderer told it is rate limited');
      assert.strictEqual(rl[rl.length - 1].rateLimitRemainingMs, 60_000);

      // 2) Still inside the window: cycle is skipped, no 'synced'.
      t += 30_000;
      h.sent.length = 0;
      await worker.runCycle();
      assert.strictEqual(h.sent.some((p) => p && p.status === 'synced'), false);

      // 3) Window over, pull succeeds with nothing new → footer must clear.
      t += 31_000;
      h.setPull(async () => ({ pulled: 0, received: 0, decryptFailed: 0 }));
      h.sent.length = 0;
      await worker.runCycle();
      const synced = h.sent.filter((p) => p && p.status === 'synced');
      assert.ok(synced.length >= 1, 'healthy cycle must notify synced');
      const last = synced[synced.length - 1];
      assert.strictEqual(last.rateLimited, false);
      assert.strictEqual(last.rateLimitRemainingMs, 0);
      assert.strictEqual(last.waitingForSync, false);
      assert.match(String(last.lastSyncSkipReason), /^ok/);
      assert.strictEqual(h.sent.some((p) => p && p.status === 'rate_limited'), false);
    } finally {
      worker.stop();
    }
  });

  it("a pull error marks the footer stale so the next healthy cycle clears it", async () => {
    let t = 12_000_000;
    const h = createCtx({ now: () => t });
    const worker = createSyncWorker(h.ctx);
    try {
      await worker.runCycle(); // healthy → synced
      h.setPull(async () => {
        throw new Error('socket hang up');
      });
      h.sent.length = 0;
      await worker.runCycle();
      assert.ok(h.sent.some((p) => p && p.status === 'error'));
      h.setPull(async () => ({ pulled: 0, received: 0, decryptFailed: 0 }));
      h.sent.length = 0;
      await worker.runCycle();
      assert.ok(h.sent.some((p) => p && p.status === 'synced' && p.rateLimited === false));
    } finally {
      worker.stop();
    }
  });
});
