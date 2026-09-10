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

/**
 * Normalize server `written` to a count + optional syncId set.
 * When `written` is an array of syncIds, callers must only clear matching rows.
 *
 * @param {object} resp
 * @param {number} sentCount
 * @param {{ expectedSyncIds?: string[] }} [opts]
 */
function normalizeWrittenAck(resp, sentCount, opts = {}) {
  const sent = Number(sentCount) || 0;
  if (!resp || resp.ok !== true) {
    return { ok: false, writtenCount: 0, writtenIds: null, reason: 'not_ok' };
  }
  if (sent === 0) {
    return { ok: true, writtenCount: 0, writtenIds: null, reason: 'empty_send' };
  }
  if (resp.written == null) {
    return { ok: false, writtenCount: 0, writtenIds: null, reason: 'omitted' };
  }
  if (Array.isArray(resp.written)) {
    const ids = resp.written.map((v) => String(v)).filter(Boolean);
    const unique = new Set(ids);
    const expected = Array.isArray(opts.expectedSyncIds)
      ? opts.expectedSyncIds.map(String)
      : null;
    if (expected && expected.length > 0) {
      const matched = expected.filter((id) => unique.has(id));
      // Reject padding / wrong-id arrays that only match on length.
      if (matched.length < sent || unique.size < sent) {
        return {
          ok: false,
          writtenCount: matched.length,
          writtenIds: unique,
          reason: matched.length === 0 ? 'written_zero_or_mismatch' : 'partial_or_mismatch',
        };
      }
      return { ok: true, writtenCount: matched.length, writtenIds: unique, reason: 'id_match' };
    }
    if (ids.length < sent || unique.size < sent) {
      return {
        ok: false,
        writtenCount: unique.size,
        writtenIds: unique,
        reason: unique.size === 0 ? 'written_zero' : 'partial_ids',
      };
    }
    return { ok: true, writtenCount: unique.size, writtenIds: unique, reason: 'id_count' };
  }
  const written = Number(resp.written);
  if (!Number.isFinite(written) || written < sent) {
    return {
      ok: false,
      writtenCount: Number.isFinite(written) ? written : 0,
      writtenIds: null,
      reason: written === 0 ? 'written_zero' : 'partial_count',
    };
  }
  return { ok: true, writtenCount: written, writtenIds: null, reason: 'count_ok' };
}

function assertPushAccepted(resp, sentCount, opts = {}) {
  const sent = Number(sentCount) || 0;
  if (!resp || resp.ok !== true) {
    const err = new Error(resp && resp.error ? String(resp.error) : 'Push failed');
    if (resp && /too many requests|rate limit/i.test(String(resp.error || ''))) {
      err.statusCode = 429;
    }
    throw err;
  }
  if (sent === 0) return resp;
  const norm = normalizeWrittenAck(resp, sent, opts);
  if (!norm.ok) {
    let message;
    if (norm.reason === 'omitted') {
      message = 'Push unconfirmed: server omitted written count';
    } else if (norm.writtenCount === 0) {
      message = 'Push accepted 0 records (cloud write empty)';
    } else {
      message =
        `Push incomplete: wrote ${norm.writtenCount} of ${sent}` +
        (norm.reason ? ` (${norm.reason})` : '');
    }
    const err = new Error(message);
    err.code = 'PUSH_INCOMPLETE';
    err.statusCode = 503;
    err.writtenIds = norm.writtenIds;
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
  normalizeWrittenAck,
  createRateLimitGate,
  RATE_LIMIT_COOLDOWN_MS,
};
