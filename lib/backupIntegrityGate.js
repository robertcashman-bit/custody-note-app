'use strict';

/**
 * Independent historical backup integrity gate (client-side PITR layer).
 * Generational CNDB backups are NOT the live central SoT — they must not
 * instantly mirror accidental central damage, and must fail closed on
 * unreadable / empty / checksum / sudden-drop conditions.
 */

const fs = require('fs');
const path = require('path');

/**
 * @param {{
 *   backupFiles?: Array<{ name?: string, path?: string, bytes?: number, readable?: boolean, magicOk?: boolean, activeCount?: number|null }>,
 *   liveActiveCount?: number|null,
 *   lastKnownGoodActiveCount?: number|null,
 *   verifyFn?: Function,
 * }} input
 */
function evaluateBackupSeriesIntegrity(input = {}) {
  const files = Array.isArray(input.backupFiles) ? input.backupFiles : [];
  const live = input.liveActiveCount == null ? null : Number(input.liveActiveCount);
  const lastGood = input.lastKnownGoodActiveCount == null ? null : Number(input.lastKnownGoodActiveCount);
  const findings = [];
  let readableCount = 0;
  let verifiedCount = 0;
  let latestActive = null;

  for (let i = 0; i < files.length; i++) {
    const f = files[i] || {};
    if (f.readable === false) {
      findings.push({
        code: 'backup_unreadable',
        severity: 'error',
        file: f.name || f.path || null,
        failSafe: 'retain_prior_generations',
      });
      continue;
    }
    readableCount++;
    if (f.magicOk === false) {
      findings.push({
        code: 'backup_checksum_or_magic_fail',
        severity: 'error',
        file: f.name || f.path || null,
        failSafe: 'skip_corrupt_keep_others',
      });
      continue;
    }
    if (f.magicOk === true || f.verified === true) verifiedCount++;
    if (f.activeCount != null && Number.isFinite(Number(f.activeCount))) {
      latestActive = Number(f.activeCount);
    }
  }

  if (files.length === 0) {
    findings.push({
      code: 'no_backup_files',
      severity: 'warning',
      failSafe: 'force_quick_backup',
      message: 'No generational backup files found',
    });
  }

  if (Number.isFinite(live) && live > 0 && Number.isFinite(latestActive) && latestActive === 0) {
    findings.push({
      code: 'backup_empty_while_live_has_data',
      severity: 'critical',
      liveActiveCount: live,
      backupActiveCount: latestActive,
      failSafe: 'do_not_restore_empty_over_live',
      message: 'Backup appears empty while live DB has records — refuse empty restore',
    });
  }

  if (Number.isFinite(lastGood) && lastGood >= 5 && Number.isFinite(latestActive)) {
    const drop = lastGood - latestActive;
    if (drop > 0 && (drop / lastGood >= 0.25 || latestActive === 0)) {
      findings.push({
        code: 'backup_count_sudden_drop',
        severity: 'critical',
        lastKnownGoodActiveCount: lastGood,
        backupActiveCount: latestActive,
        failSafe: 'keep_older_generation',
        message: 'Backup series shows sudden count drop — prefer older known-good generation',
      });
    }
  }

  const blocking = findings.some((f) => f.severity === 'error' || f.severity === 'critical');
  return {
    ok: !blocking && files.length > 0,
    independentFromCentralSoT: true,
    readableCount,
    verifiedCount,
    fileCount: files.length,
    latestActiveCount: latestActive,
    liveActiveCount: live,
    findings,
    mayRestoreEmptyOverLive: false,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Refuse restoring a candidate over live when candidate is empty/corrupt and live has data.
 */
function mayRestoreBackupOverLive(candidate = {}, live = {}) {
  const liveCount = Number(live.activeCount);
  const candCount = candidate.activeCount == null ? null : Number(candidate.activeCount);
  if (candidate.readable === false || candidate.magicOk === false || candidate.verified === false) {
    return { allowed: false, reason: 'candidate_corrupt_or_unreadable' };
  }
  if (Number.isFinite(liveCount) && liveCount > 0 && candCount === 0) {
    return { allowed: false, reason: 'refuse_empty_over_live' };
  }
  if (candidate.emptyCloudMirror === true) {
    return { allowed: false, reason: 'backup_must_not_instantly_mirror_central_damage' };
  }
  return { allowed: true, reason: 'ok' };
}

/**
 * List backup file names in a folder (metadata only).
 */
function listBackupFileNames(folder) {
  if (!folder || !fs.existsSync(folder)) return [];
  try {
    return fs.readdirSync(folder)
      .filter((n) => /^attendance-(latest|quick-|backup-)/i.test(n) && /\.db$/i.test(n))
      .sort();
  } catch (_) {
    return [];
  }
}

/**
 * Build file descriptors for integrity evaluation from a folder + verify helper.
 * verifyFn(filePath) → { ok, bytes } | throws
 */
function inspectBackupFolder(folder, verifyFn) {
  const names = listBackupFileNames(folder);
  const files = [];
  for (let i = 0; i < names.length; i++) {
    const full = path.join(folder, names[i]);
    let bytes = 0;
    let readable = true;
    let magicOk = null;
    try {
      bytes = fs.statSync(full).size || 0;
      if (typeof verifyFn === 'function') {
        const v = verifyFn(full);
        magicOk = !!(v && (v.ok === true || v.verified === true));
      }
    } catch (_) {
      readable = false;
      magicOk = false;
    }
    files.push({ name: names[i], path: full, bytes, readable, magicOk });
  }
  return files;
}

module.exports = {
  evaluateBackupSeriesIntegrity,
  mayRestoreBackupOverLive,
  listBackupFileNames,
  inspectBackupFolder,
};
