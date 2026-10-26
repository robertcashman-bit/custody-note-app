'use strict';

/**
 * electron-builder afterPack: flip Electron fuses on the packaged binary.
 * Dev (`electron .`) is unaffected — only packaged artefacts are hardened.
 */
const path = require('path');

module.exports = async function afterPack(context) {
  const extra =
    (context.packager.config && context.packager.config.extraMetadata) || {};
  if (extra.cnPackagedTestHooks === true) {
    console.log('[fuses] skip: cnPackagedTestHooks packaged test build (Playwright needs inspect/CDP)');
    return;
  }

  const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

  const product = context.packager.appInfo.productFilename;
  const platform = context.electronPlatformName;
  let appPath;
  if (platform === 'darwin') {
    appPath = path.join(context.appOutDir, `${product}.app`);
  } else if (platform === 'win32') {
    appPath = path.join(context.appOutDir, `${product}.exe`);
  } else {
    console.log('[fuses] skip: unsupported platform', platform);
    return;
  }

  const isArm64 = context.arch === 'arm64' || context.arch === 3;
  const resetAdHocDarwinSignature = platform === 'darwin' && isArm64;

  await flipFuses(appPath, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    // Omit OnlyLoadAppFromAsar + embedded ASAR integrity: this app unpacks
    // resources/fonts for PDF @font-face; enabling those fuses risks breaking
    // packaged loads and in-place auto-updates until validated on signed builds.
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
  });

  console.log('[fuses] applied V1 fuses to', appPath);
};
