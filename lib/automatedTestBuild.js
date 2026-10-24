'use strict';

/**
 * Packaged release builds must ignore Playwright / automated-test env vars (H27).
 * Only artifacts built with electron-builder extraMetadata.cnPackagedTestHooks=true
 * (CI pdf-viewer-packaged --dir job) may honor them when packaged.
 */

const path = require('path');

let pkgCache = null;

function readAppPackageJson() {
  if (pkgCache) return pkgCache;
  try {
    pkgCache = require(path.join(__dirname, '..', 'package.json'));
  } catch (_) {
    pkgCache = {};
  }
  return pkgCache;
}

/**
 * @param {{ isPackaged?: boolean }} [opts] — inject for unit tests without Electron
 */
function hasPackagedTestHooksBakedIn(opts) {
  const pkg = readAppPackageJson();
  if (pkg.cnPackagedTestHooks !== true) return false;
  const isPackaged = opts && typeof opts.isPackaged === 'boolean'
    ? opts.isPackaged
    : (() => {
      try {
        const { app } = require('electron');
        return !!app.isPackaged;
      } catch (_) {
        return false;
      }
    })();
  return isPackaged;
}

/**
 * Unpackaged dev/test runs may use automated-test env; packaged release may not.
 * @param {{ isPackaged?: boolean }} [opts]
 */
function mayHonorAutomatedTestEnv(opts) {
  const isPackaged = opts && typeof opts.isPackaged === 'boolean'
    ? opts.isPackaged
    : (() => {
      try {
        const { app } = require('electron');
        return !!app.isPackaged;
      } catch (_) {
        return false;
      }
    })();
  if (!isPackaged) return true;
  return hasPackagedTestHooksBakedIn({ isPackaged: true });
}

/** True when test-only IPC / captures should run (honored env + temp userData). */
function isAutomatedTestEnvActive(opts) {
  if (!process.env.CUSTODYNOTE_TEST_USERDATA || !String(process.env.CUSTODYNOTE_TEST_USERDATA).trim()) {
    return false;
  }
  return mayHonorAutomatedTestEnv(opts);
}

/** Packaged CI test build may use stub env vars (print/email). */
function mayUsePackagedTestStubEnv(opts) {
  return mayHonorAutomatedTestEnv(opts);
}

module.exports = {
  readAppPackageJson,
  hasPackagedTestHooksBakedIn,
  mayHonorAutomatedTestEnv,
  isAutomatedTestEnvActive,
  mayUsePackagedTestStubEnv,
};
