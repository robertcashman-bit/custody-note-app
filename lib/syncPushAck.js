'use strict';

/**
 * Push acknowledgement rules for /api/sync/push.
 *
 * Production API (custodynote.com) validates the licence key, then
 * syncPushRecords(licence.hash, records) → S3 PutObject per syncId, and
 * returns { ok, written }. Rate limit: checkRateLimit("sync-push", ip, 120/hour)
 * → HTTP/body "Too many requests…".
 *
 * Clearing sync_dirty without a confirmed written count is the empty-cloud
 * failure class (Mac looks synced, Mac/Windows pull received=0).
 */

function assertPushAccepted(resp, sentCount) {
  const sent = Number(sentCount) || 0;
  if (!resp || resp.ok !== true) {
    const err = new Error(resp && resp.error ? String(resp.error) : 'Push failed');
    if (resp && /too many requests|rate limit/i.test(String(resp.error || ''))) {
      err.statusCode = 429;
    }
    throw err;
  }
  if (sent === 0) return resp;
  if (resp.written == null) {
    const err = new Error('Push unconfirmed: server omitted written count');
    err.code = 'PUSH_INCOMPLETE';
    err.statusCode = 503;
    throw err;
  }
  const written = Array.isArray(resp.written)
    ? resp.written.length
    : Number(resp.written);
  if (!Number.isFinite(written) || written < sent) {
    const err = new Error(
      written === 0
        ? 'Push accepted 0 records (cloud write empty)'
        : `Push incomplete: wrote ${written} of ${sent}`
    );
    err.code = 'PUSH_INCOMPLETE';
    err.statusCode = 503;
    throw err;
  }
  return resp;
}

/** Default pause after a 429 so the 10s poll does not burn the 120/hour budget. */
const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;

function createRateLimitGate(options = {}) {
  const cooldownMs = options.cooldownMs != null ? options.cooldownMs : RATE_LIMIT_COOLDOWN_MS;
  const nowFn = typeof options.now === 'function' ? options.now : () => Date.now();
  let blockedUntil = 0;
  let lastReason = null;

  return {
    noteError(err) {
      const msg = err && (err.message || String(err)) ? String(err.message || err) : '';
      const code = err && (err.statusCode || err.code);
      if (code === 429 || /too many requests|rate limit/i.test(msg)) {
        blockedUntil = nowFn() + cooldownMs;
        lastReason = msg || 'Too many requests';
        return true;
      }
      return false;
    },
    isBlocked() {
      return nowFn() < blockedUntil;
    },
    remainingMs() {
      return Math.max(0, blockedUntil - nowFn());
    },
    reason() {
      return this.isBlocked() ? lastReason : null;
    },
    clear() {
      blockedUntil = 0;
      lastReason = null;
    },
    snapshot() {
      return {
        blocked: this.isBlocked(),
        remainingMs: this.remainingMs(),
        reason: this.reason(),
        cooldownMs,
      };
    },
  };
}

module.exports = {
  assertPushAccepted,
  createRateLimitGate,
  RATE_LIMIT_COOLDOWN_MS,
};
