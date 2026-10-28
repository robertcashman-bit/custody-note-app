/**
 * Single source of truth for the macOS release asset names.
 *
 * Since v1.9.125 the Mac build is ONE universal (arm64 + x86_64) app, so Apple
 * silicon Macs run natively (no Rosetta, no "Support Ending for Intel-based
 * Apps" warning) and Intel Macs keep working. electron-builder's
 * `${arch}` for a universal target is the literal string "universal".
 *
 * electron-updater (MacUpdater.filterFilesForArch) on an arm64 Mac prefers
 * files whose name contains "arm64"; when none exist it falls back to the
 * remaining files, so a feed that lists only the universal zip updates BOTH
 * arm64 and Intel installs (including legacy x64 copies running under Rosetta).
 */

export const MAC_UNIVERSAL_ARCH = 'universal';

/** dmg + zip (no blockmaps) that every Mac release must carry. */
export function macReleaseAssetNames(version) {
  return [
    `Custody-Note-${version}-${MAC_UNIVERSAL_ARCH}.dmg`,
    `Custody-Note-${version}-${MAC_UNIVERSAL_ARCH}.zip`,
  ];
}

/** Every Mac file the build produces and the uploader pushes (incl. blockmaps + feed). */
export function macUploadAssetNames(version) {
  const out = [];
  for (const name of macReleaseAssetNames(version)) {
    out.push(name, `${name}.blockmap`);
  }
  out.push('latest-mac.yml');
  return out;
}

/** The dmg used as the "Mac assets are present" sentinel. */
export function macSentinelDmg(version) {
  return `Custody-Note-${version}-${MAC_UNIVERSAL_ARCH}.dmg`;
}

/** dist/ sub-directories electron-builder may write a .app into. */
export const MAC_APP_OUT_DIRS = ['mac-universal', 'mac', 'mac-arm64'];

/**
 * Pick the `path:` entry for latest-mac.yml: the universal zip, else (legacy
 * per-arch releases) the arm64 zip, else any zip, else the first entry.
 */
export function pickPrimaryMacFeedEntry(fileEntries) {
  return (
    fileEntries.find((f) => f.url.endsWith(`-${MAC_UNIVERSAL_ARCH}.zip`)) ||
    fileEntries.find((f) => f.url.endsWith('-arm64.zip')) ||
    fileEntries.find((f) => f.url.endsWith('.zip')) ||
    fileEntries[0]
  );
}
