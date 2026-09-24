'use strict';

/**
 * True when this process is the Microsoft Store / MSIX build (not NSIS Setup.exe, not Mac).
 * @param {{ platform?: string, windowsStore?: boolean, distributionChannel?: string, execPath?: string, isPackaged?: boolean }} [env]
 */
function isWindowsStoreBuild(env) {
  const e = env || {};
  const platform = e.platform != null ? e.platform : process.platform;
  if (platform !== 'win32') return false;

  if (e.windowsStore === true) return true;

  const channel = String(e.distributionChannel || '').trim().toLowerCase();
  if (channel === 'msix' || channel === 'store' || channel === 'microsoft-store' || channel === 'appx') {
    return true;
  }
  if (channel === '1' || channel === 'true' || channel === 'yes') {
    return true;
  }

  const execPath = String(e.execPath || '').replace(/\//g, '\\').toLowerCase();
  if (execPath.includes('\\windowsapps\\')) return true;

  return false;
}

module.exports = {
  isWindowsStoreBuild,
};
