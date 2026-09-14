'use strict';

/**
 * main/staleSyncCatchUpRunner.js
 * ----------------------------------------------------------------------------
 * Orchestrates stale-device / long-gap sync catch-up against real DB + sync APIs.
 * Decision logic lives in lib/staleSyncCatchUp.js (pure / unit-tested).
 *
 * Steps:
 *  1. Pull cloud
 *  2. Auto accept_remote (force when needed) for remote-newer non-dirty conflicts
 *  3. Drain push until dirty→0 (honest rate-limit stop)
 *  4. Leave preserve_local_dirty conflicts for human + bulk "Use cloud"
 */

const {
  shouldRunStaleCatchUp,
  partitionConflictsForCatchUp,
} = require('../lib/staleSyncCatchUp');
const { listOpenConflicts, resolveConflict } = require('./syncConflicts');

const SETTINGS_LAST_SEEN_APP_VERSION = 'lastSeenAppVersion';
const SETTINGS_CATCH_UP_BANNER = 'staleCatchUpBannerAt';

function getSetting(dbGet, key) {
  try {
    const row = dbGet('SELECT value FROM settings WHERE key=?', [key]);
    return row && row.value != null ? String(row.value) : null;
  } catch (_) {
    return null;
  }
}

function setSetting(dbRun, key, value) {
  if (value == null || value === '') {
    try { dbRun('DELETE FROM settings WHERE key=?', [key]); } catch (_) {}
    return;
  }
  dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
}

function readCatchUpTrigger(ctx) {
  const lastSuccessfulSyncAt = ctx.getLastSuccessfulSyncAt
    ? ctx.getLastSuccessfulSyncAt()
    : getSetting(ctx.dbGet, 'lastSyncPullAt');
  const lastSeenAppVersion = getSetting(ctx.dbGet, SETTINGS_LAST_SEEN_APP_VERSION);
  const currentAppVersion = ctx.currentAppVersion || null;
  const syncEnabled = ctx.syncEnabled != null ? !!ctx.syncEnabled : true;
  return shouldRunStaleCatchUp({
    lastSuccessfulSyncAt,
    lastSeenAppVersion,
    currentAppVersion,
    now: ctx.now != null ? ctx.now : Date.now(),
    syncEnabled,
  });
}

function stampSeenAppVersion(ctx) {
  if (!ctx.currentAppVersion) return;
  setSetting(ctx.dbRun, SETTINGS_LAST_SEEN_APP_VERSION, ctx.currentAppVersion);
}

function emitProgress(ctx, payload) {
  if (typeof ctx.onProgress === 'function') {
    try { ctx.onProgress(payload); } catch (_) {}
  }
}

/**
 * Auto-resolve catch-up conflicts that are safe to accept remotely.
 * Does NOT auto keep_local. Does NOT auto-resolve preserve_local_dirty.
 */
function autoAcceptRemoteNewerConflicts(ctx) {
  const open = listOpenConflicts(ctx);
  const parts = partitionConflictsForCatchUp(open);
  let accepted = 0;
  let forced = 0;
  const failures = [];

  for (let i = 0; i < parts.autoAccept.length; i++) {
    const { conflict, classify } = parts.autoAccept[i];
    const res = resolveConflict(ctx, conflict.id, 'accept_remote', {
      force: !!classify.force,
    });
    if (res && res.ok) {
      accepted += 1;
      if (res.forced || classify.force) forced += 1;
      if (typeof ctx.afterResolve === 'function') {
        try { ctx.afterResolve(res); } catch (_) {}
      }
    } else if (res && res.blocked) {
      // Retry once with force for protected locals during catch-up (cloud SoT).
      const forcedRes = resolveConflict(ctx, conflict.id, 'accept_remote', { force: true });
      if (forcedRes && forcedRes.ok) {
        accepted += 1;
        forced += 1;
        if (typeof ctx.afterResolve === 'function') {
          try { ctx.afterResolve(forcedRes); } catch (_) {}
        }
      } else {
        failures.push({ conflictId: conflict.id, error: (forcedRes && forcedRes.error) || 'blocked' });
      }
    } else {
      failures.push({ conflictId: conflict.id, error: (res && res.error) || 'failed' });
    }
  }

  return {
    accepted,
    forced,
    needsHuman: parts.needsHuman.map((x) => x.conflict),
    skipped: parts.skipped.map((x) => x.conflict),
    failures,
    remainingOpen: listOpenConflicts(ctx).length,
  };
}

/**
 * Full catch-up: pull → auto-accept → drain push.
 *
 * @param {object} ctx
 *   dbGet, dbRun, dbAll, nowIso?, appendAuditLog?,
 *   syncPull(), drainPendingSyncUploads({ maxCycles }),
 *   currentAppVersion, getLastSuccessfulSyncAt?, syncEnabled?,
 *   onProgress?, afterResolve?, saveDb?, force?
 */
async function runStaleDeviceCatchUp(ctx, opts) {
  const options = opts || {};
  const trigger = options.force
    ? { run: true, reason: 'forced' }
    : readCatchUpTrigger(ctx);

  if (!trigger.run) {
    stampSeenAppVersion(ctx);
    return { ok: true, ran: false, reason: trigger.reason, trigger };
  }

  emitProgress(ctx, {
    phase: 'starting',
    message: 'Catching up with other devices…',
    trigger,
  });

  let pullResult = { received: 0, pulled: 0, conflicts: 0 };
  emitProgress(ctx, { phase: 'pulling', message: 'Pulling cloud records…' });
  try {
    if (typeof ctx.syncPull === 'function') {
      pullResult = (await ctx.syncPull({ correlationId: ctx.correlationId || null })) || pullResult;
    }
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    emitProgress(ctx, { phase: 'error', message: msg });
    stampSeenAppVersion(ctx);
    return { ok: false, ran: true, reason: trigger.reason, trigger, error: msg, code: 'PULL_FAILED' };
  }

  emitProgress(ctx, {
    phase: 'resolving',
    message: 'Applying newer cloud versions…',
    pullReceived: pullResult.received || 0,
  });

  const resolveResult = autoAcceptRemoteNewerConflicts(ctx);
  if (typeof ctx.saveDb === 'function') {
    try { ctx.saveDb(); } catch (_) {}
  }

  emitProgress(ctx, {
    phase: 'pushing',
    message: 'Uploading pending local records…',
    autoAccepted: resolveResult.accepted,
    needsHumanCount: resolveResult.needsHuman.length,
  });

  let drain = { cycles: 0, stoppedReason: 'skipped', pending: 0, dirty: 0 };
  if (typeof ctx.drainPendingSyncUploads === 'function') {
    drain = await ctx.drainPendingSyncUploads({ maxCycles: options.maxCycles != null ? options.maxCycles : 40 });
  }

  stampSeenAppVersion(ctx);

  if (drain.stoppedReason === 'rate_limited') {
    emitProgress(ctx, {
      phase: 'paused_rate_limit',
      message: 'Safe locally — cloud sync paused briefly (rate limit). Will continue automatically.',
      autoAccepted: resolveResult.accepted,
      needsHumanCount: resolveResult.needsHuman.length,
      dirtyRemaining: drain.dirty || 0,
      pendingRemaining: drain.pending || 0,
    });
    return {
      ok: false,
      ran: true,
      reason: trigger.reason,
      trigger,
      code: 'RATE_LIMITED',
      pullResult,
      resolveResult,
      drain,
      needsHuman: resolveResult.needsHuman,
      banner: false,
    };
  }

  const dirtyLeft = drain.dirty || 0;
  const pendingLeft = drain.pending || 0;
  const humanLeft = resolveResult.needsHuman.length;
  const caughtUp = dirtyLeft === 0 && pendingLeft === 0;

  if (caughtUp && humanLeft === 0) {
    setSetting(ctx.dbRun, SETTINGS_CATCH_UP_BANNER, new Date().toISOString());
    if (typeof ctx.saveDb === 'function') {
      try { ctx.saveDb(); } catch (_) {}
    }
  }

  emitProgress(ctx, {
    phase: humanLeft > 0 ? 'needs_human' : (caughtUp ? 'done' : 'incomplete'),
    message: humanLeft > 0
      ? (humanLeft + ' record' + (humanLeft === 1 ? '' : 's') + ' need a choice — this PC and the cloud both changed them.')
      : (caughtUp
        ? 'Caught up with other devices.'
        : 'Catch-up paused with ' + (dirtyLeft + pendingLeft) + ' still pending upload.'),
    autoAccepted: resolveResult.accepted,
    needsHumanCount: humanLeft,
    dirtyRemaining: dirtyLeft,
    pendingRemaining: pendingLeft,
  });

  return {
    ok: caughtUp || humanLeft > 0,
    ran: true,
    reason: trigger.reason,
    trigger,
    pullResult,
    resolveResult,
    drain,
    needsHuman: resolveResult.needsHuman,
    banner: caughtUp && humanLeft === 0,
    dirtyRemaining: dirtyLeft,
    pendingRemaining: pendingLeft,
  };
}

/**
 * Drain pending/dirty uploads with progress (Fix sync now).
 */
async function runFixSyncNow(ctx, opts) {
  const options = opts || {};
  emitProgress(ctx, { phase: 'pushing', message: 'Fixing sync — uploading pending records…' });

  if (typeof ctx.forceRetryAll === 'function') {
    try { ctx.forceRetryAll(); } catch (_) {}
  }

  let drain = { cycles: 0, stoppedReason: 'no_drain', pending: 0, dirty: 0 };
  if (typeof ctx.drainPendingSyncUploads === 'function') {
    drain = await ctx.drainPendingSyncUploads({
      maxCycles: options.maxCycles != null ? options.maxCycles : 40,
    });
  }

  if (drain.stoppedReason === 'rate_limited') {
    emitProgress(ctx, {
      phase: 'paused_rate_limit',
      message: 'Safe locally — sync waiting on rate limit. Nothing was dropped.',
      dirtyRemaining: drain.dirty || 0,
      pendingRemaining: drain.pending || 0,
    });
    return {
      ok: false,
      code: 'RATE_LIMITED',
      drain,
      dirtyRemaining: drain.dirty || 0,
      pendingRemaining: drain.pending || 0,
    };
  }

  const dirtyRemaining = drain.dirty || 0;
  const pendingRemaining = drain.pending || 0;
  const ok = dirtyRemaining === 0 && pendingRemaining === 0;
  emitProgress(ctx, {
    phase: ok ? 'done' : 'incomplete',
    message: ok
      ? 'All pending records confirmed in cloud.'
      : ((dirtyRemaining + pendingRemaining) + ' still waiting — try again shortly.'),
    dirtyRemaining,
    pendingRemaining,
  });

  return {
    ok,
    code: ok ? 'DRAINED' : 'UPLOAD_INCOMPLETE',
    drain,
    dirtyRemaining,
    pendingRemaining,
  };
}

function consumeCatchUpBanner(ctx) {
  const at = getSetting(ctx.dbGet, SETTINGS_CATCH_UP_BANNER);
  if (!at) return null;
  setSetting(ctx.dbRun, SETTINGS_CATCH_UP_BANNER, null);
  if (typeof ctx.saveDb === 'function') {
    try { ctx.saveDb(); } catch (_) {}
  }
  return { shownAt: at, message: 'Caught up with other devices.' };
}

module.exports = {
  SETTINGS_LAST_SEEN_APP_VERSION,
  SETTINGS_CATCH_UP_BANNER,
  getSetting,
  setSetting,
  readCatchUpTrigger,
  stampSeenAppVersion,
  autoAcceptRemoteNewerConflicts,
  runStaleDeviceCatchUp,
  runFixSyncNow,
  consumeCatchUpBanner,
};
