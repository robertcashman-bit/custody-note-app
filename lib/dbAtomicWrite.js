'use strict';

/**
 * Atomic encrypted-file writes (tmp → rename). Shared by main process and tests.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  restrictOwnerOnlyFile,
  restrictOwnerOnlyDir,
  FILE_MODE_OWNER_RW,
} = require('./secureLocalFiles');

function getAtomicTempPath(destPath, pid = process.pid) {
  return `${destPath}.${pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`;
}

function writeFileAtomicSync(destPath, data) {
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    restrictOwnerOnlyDir(dir);
  }
  const tmpPath = getAtomicTempPath(destPath);
  try {
    fs.writeFileSync(tmpPath, data, { mode: FILE_MODE_OWNER_RW });
    try {
      fs.renameSync(tmpPath, destPath);
    } catch (renameErr) {
      if (!fs.existsSync(tmpPath)) throw renameErr;
      fs.copyFileSync(tmpPath, destPath);
      try {
        fs.unlinkSync(tmpPath);
      } catch (_) {}
    }
    restrictOwnerOnlyFile(destPath);
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (_) {}
  }
}

module.exports = {
  getAtomicTempPath,
  writeFileAtomicSync,
};
