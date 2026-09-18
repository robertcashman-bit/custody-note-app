'use strict';

/**
 * Cross-platform restrictive file modes for secrets and local DB artefacts.
 * Mac: chmod 0o600 / 0o700 works as expected (POSIX).
 * Windows: Node fs.chmod is best-effort (ACL differs); we still attempt it and
 * never invent a weaker path for Win. Paths must stay under userData on both.
 */

const fs = require('fs');
const path = require('path');

const FILE_MODE_OWNER_RW = 0o600;
const DIR_MODE_OWNER_RWX = 0o700;

/**
 * Restrict a file to owner read/write when the OS allows it.
 * Never throws — security best-effort after a successful write.
 * @param {string} filePath
 * @param {{ mode?: number, fsApi?: typeof fs }} [opts]
 * @returns {{ ok: boolean, platform: string, mode: number|null, reason?: string }}
 */
function restrictOwnerOnlyFile(filePath, opts) {
  const o = opts || {};
  const fsApi = o.fsApi || fs;
  const mode = o.mode != null ? o.mode : FILE_MODE_OWNER_RW;
  const platform = process.platform;
  if (!filePath || typeof filePath !== 'string') {
    return { ok: false, platform, mode: null, reason: 'empty_path' };
  }
  try {
    if (!fsApi.existsSync(filePath)) {
      return { ok: false, platform, mode: null, reason: 'missing' };
    }
    fsApi.chmodSync(filePath, mode);
    return { ok: true, platform, mode };
  } catch (err) {
    return {
      ok: false,
      platform,
      mode: null,
      reason: err && err.message ? String(err.message).slice(0, 120) : 'chmod_failed',
    };
  }
}

/**
 * Restrict a directory to owner rwx when the OS allows it.
 * @param {string} dirPath
 * @param {{ mode?: number, fsApi?: typeof fs }} [opts]
 */
function restrictOwnerOnlyDir(dirPath, opts) {
  const o = opts || {};
  const fsApi = o.fsApi || fs;
  const mode = o.mode != null ? o.mode : DIR_MODE_OWNER_RWX;
  return restrictOwnerOnlyFile(dirPath, { mode, fsApi });
}

/**
 * Write UTF-8 / buffer with restrictive mode (atomic-ish via write then chmod).
 * Same behaviour on win32 and darwin/linux.
 * @param {string} filePath
 * @param {string|Buffer} data
 * @param {{ encoding?: string, mode?: number, fsApi?: typeof fs }} [opts]
 */
function writeRestrictedFile(filePath, data, opts) {
  const o = opts || {};
  const fsApi = o.fsApi || fs;
  const mode = o.mode != null ? o.mode : FILE_MODE_OWNER_RW;
  const encoding = o.encoding;
  if (encoding) {
    fsApi.writeFileSync(filePath, data, { encoding, mode });
  } else {
    fsApi.writeFileSync(filePath, data, { mode });
  }
  // Re-apply after write — some platforms ignore mode on writeFileSync.
  restrictOwnerOnlyFile(filePath, { mode, fsApi });
  return filePath;
}

/**
 * Refuse writing sensitive dumps outside userData / explicit allow-roots.
 * Shared Win+Mac path — uses path.resolve + realpath when possible.
 *
 * @param {string} targetPath
 * @param {string[]} allowedRoots
 * @param {{ fsApi?: typeof fs, pathApi?: typeof path }} [opts]
 * @returns {{ allowed: boolean, reason?: string, resolved?: string }}
 */
function assertPathInsideAllowedRoots(targetPath, allowedRoots, opts) {
  const o = opts || {};
  const fsApi = o.fsApi || fs;
  const pathApi = o.pathApi || path;
  if (!targetPath || typeof targetPath !== 'string') {
    return { allowed: false, reason: 'empty_path' };
  }
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) {
    return { allowed: false, reason: 'no_roots' };
  }
  let resolved;
  try {
    resolved = pathApi.resolve(targetPath);
    try {
      if (fsApi.existsSync(resolved)) resolved = fsApi.realpathSync(resolved);
    } catch (_) { /* keep resolve */ }
  } catch (_) {
    return { allowed: false, reason: 'unresolvable' };
  }
  for (let i = 0; i < allowedRoots.length; i++) {
    let root = allowedRoots[i];
    if (!root) continue;
    try {
      root = pathApi.resolve(String(root));
      try {
        if (fsApi.existsSync(root)) root = fsApi.realpathSync(root);
      } catch (_) { /* keep */ }
    } catch (_) {
      continue;
    }
    if (resolved === root || resolved.startsWith(root + pathApi.sep)) {
      return { allowed: true, resolved };
    }
  }
  return { allowed: false, reason: 'outside_allowed_roots', resolved };
}

module.exports = {
  FILE_MODE_OWNER_RW,
  DIR_MODE_OWNER_RWX,
  restrictOwnerOnlyFile,
  restrictOwnerOnlyDir,
  writeRestrictedFile,
  assertPathInsideAllowedRoots,
};
