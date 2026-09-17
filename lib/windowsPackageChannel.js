/**
 * Windows packaging channel detection and shared userData resolution.
 *
 * Custody Note ships two Windows channels from the same source:
 *   - NSIS (.exe) — GitHub Releases + electron-updater
 *   - AppX/MSIX (Microsoft Store) — Store-managed updates
 *
 * Data safety invariant: both channels must resolve to the same classic
 * userData root (%APPDATA%\custody-note) so attendances.db / licence.dat /
 * recovery.dat / Backups are never split into an empty "second" database.
 *
 * Electron appId (com.custodynote.app) is intentionally unchanged — it does
 * not drive the Windows folder name; package.json "name" (custody-note) does.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const CLASSIC_USERDATA_DIRNAME = 'custody-note';

/** Files that indicate a real Custody Note profile (not an empty illusion). */
const PROFILE_MARKERS = [
  'attendances.db',
  'licence.dat',
  'recovery.dat',
  'licences.db.enc',
  'encryption.key',
];

function getClassicAppDataRoot(env = process.env, platform = process.platform) {
  if (platform === 'win32') {
    return env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support');
  }
  return env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

function getClassicUserDataPath(env = process.env, platform = process.platform) {
  return path.join(getClassicAppDataRoot(env, platform), CLASSIC_USERDATA_DIRNAME);
}

/**
 * Detect Windows Store / AppX / MSIX package identity.
 * Prefer Electron's process.windowsStore; also accept execPath heuristics and
 * an explicit build/runtime override (CUSTODYNOTE_CHANNEL=msix|store|appx).
 */
function detectWindowsPackageChannel(opts = {}) {
  const platform = opts.platform != null ? opts.platform : process.platform;
  const env = opts.env || process.env;
  const windowsStore =
    opts.windowsStore != null ? !!opts.windowsStore : !!(typeof process !== 'undefined' && process.windowsStore);
  const execPath = opts.execPath != null ? String(opts.execPath) : String(process.execPath || '');
  const isPackaged = opts.isPackaged != null ? !!opts.isPackaged : false;
  const isPortable = !!opts.isPortable;

  const forced = String(env.CUSTODYNOTE_CHANNEL || '')
    .trim()
    .toLowerCase();
  if (forced === 'msix' || forced === 'store' || forced === 'appx') {
    return 'msix';
  }
  if (forced === 'nsis' || forced === 'portable' || forced === 'dev') {
    return forced;
  }

  if (platform !== 'win32') {
    if (!isPackaged) return 'dev';
    return 'other';
  }
  if (!isPackaged) return 'dev';
  if (isPortable) return 'portable';

  if (windowsStore) return 'msix';

  const normalized = execPath.replace(/\//g, '\\').toLowerCase();
  if (
    normalized.includes('\\windowsapps\\') ||
    normalized.includes('\\program files\\windowsapps\\') ||
    /\.exe$/i.test(execPath) && /\\app\\[^\\]+\.exe$/i.test(normalized)
  ) {
    /* Desktop Bridge packages often live under WindowsApps\<Family>\...\app\*.exe */
    if (normalized.includes('windowsapps')) return 'msix';
  }

  return 'nsis';
}

function isMsixChannel(channel) {
  return channel === 'msix';
}

function shouldDisableElectronUpdater(channel) {
  return channel === 'msix' || channel === 'portable' || channel === 'dev';
}

function pathExists(p) {
  try {
    return !!(p && fs.existsSync(p));
  } catch (_) {
    return false;
  }
}

function safeStat(p) {
  try {
    return fs.statSync(p);
  } catch (_) {
    return null;
  }
}

function fileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function scoreUserDataProfile(dir) {
  if (!pathExists(dir)) return { score: 0, markers: [], dbBytes: 0, hasDb: false };
  const markers = [];
  for (const name of PROFILE_MARKERS) {
    if (pathExists(path.join(dir, name))) markers.push(name);
  }
  const dbPath = path.join(dir, 'attendances.db');
  const st = safeStat(dbPath);
  const dbBytes = st && st.isFile() ? st.size : 0;
  /* Prefer profiles with a non-trivial DB; empty/tiny files score lower. */
  const dbScore = dbBytes >= 64 ? Math.min(dbBytes, 50 * 1024 * 1024) : dbBytes > 0 ? 1 : 0;
  const score = markers.length * 1_000_000 + dbScore;
  return { score, markers, dbBytes, hasDb: dbBytes > 0 };
}

/**
 * Choose the durable Windows userData directory.
 * Never prefer an empty package-local profile when the classic NSIS path has data.
 */
function resolveSharedWindowsUserData(opts = {}) {
  const classicPath = opts.classicPath || getClassicUserDataPath(opts.env, opts.platform || 'win32');
  const packagePath = opts.packagePath || null;
  const channel = opts.channel || 'nsis';
  const log = typeof opts.log === 'function' ? opts.log : () => {};

  const classic = scoreUserDataProfile(classicPath);
  const pkg = packagePath ? scoreUserDataProfile(packagePath) : { score: 0, markers: [], dbBytes: 0, hasDb: false };

  if (!packagePath || path.resolve(packagePath) === path.resolve(classicPath)) {
    return {
      userDataPath: classicPath,
      reason: 'classic-only',
      classic,
      package: pkg,
      migration: null,
    };
  }

  /* Store / MSIX: always anchor on classic path when possible. */
  if (isMsixChannel(channel) || classic.score > 0) {
    if (pkg.score > classic.score && pkg.hasDb && !classic.hasDb) {
      log(
        '[WindowsUserData] Package-local profile has DB but classic path does not — will migrate copy→classic before use'
      );
      return {
        userDataPath: classicPath,
        reason: 'migrate-package-to-classic',
        classic,
        package: pkg,
        migration: {
          from: packagePath,
          to: classicPath,
          mode: 'copy-before-use',
        },
      };
    }
    if (pkg.score > 0 && classic.score > 0 && pkg.score !== classic.score) {
      log(
        `[WindowsUserData] Both profiles present (classic dbBytes=${classic.dbBytes}, package dbBytes=${pkg.dbBytes}) — using higher-score profile root without deleting the other`
      );
    }
    if (classic.score >= pkg.score) {
      return {
        userDataPath: classicPath,
        reason: classic.hasDb || classic.markers.length ? 'prefer-classic-with-data' : 'prefer-classic-shared',
        classic,
        package: pkg,
        migration: null,
      };
    }
  }

  return {
    userDataPath: classicPath,
    reason: 'fallback-classic',
    classic,
    package: pkg,
    migration: null,
  };
}

/**
 * Safe copy of profile files from → to.
 * - Creates destination directory
 * - Never overwrites a newer/larger attendances.db
 * - Never deletes source
 * - Hash-verifies copied files
 */
function migrateUserDataCopy(fromDir, toDir, opts = {}) {
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const results = { copied: [], skipped: [], errors: [], verified: true };

  if (!pathExists(fromDir)) {
    results.verified = false;
    results.errors.push('source-missing');
    return results;
  }

  fs.mkdirSync(toDir, { recursive: true });

  const names = fs.readdirSync(fromDir);
  for (const name of names) {
    /* Do not recurse into nested package caches blindly; copy top-level durable files + known dirs. */
    const src = path.join(fromDir, name);
    const dest = path.join(toDir, name);
    let st;
    try {
      st = fs.statSync(src);
    } catch (err) {
      results.errors.push({ name, error: String(err && err.message) });
      results.verified = false;
      continue;
    }

    if (st.isDirectory()) {
      if (name === 'Backups' || name === 'photos' || name === 'laa-official-forms' || name === 'outlook-drafts') {
        copyDirRecursiveSafe(src, dest, results, log);
      } else {
        results.skipped.push({ name, reason: 'directory-not-in-allowlist' });
      }
      continue;
    }

    if (!st.isFile()) {
      results.skipped.push({ name, reason: 'not-a-file' });
      continue;
    }

    if (pathExists(dest)) {
      const destSt = safeStat(dest);
      if (name === 'attendances.db' && destSt && destSt.size >= st.size) {
        results.skipped.push({ name, reason: 'dest-db-same-or-newer', destBytes: destSt.size, srcBytes: st.size });
        continue;
      }
      if (name === 'attendances.db' && destSt && destSt.size > 0 && destSt.size < st.size) {
        /* Keep dest; copy source aside as recovery sibling — never overwrite. */
        const aside = dest + '.from-msix-package.' + Date.now() + '.bak';
        try {
          fs.copyFileSync(src, aside);
          const h1 = fileSha256(src);
          const h2 = fileSha256(aside);
          if (h1 !== h2) {
            results.verified = false;
            results.errors.push({ name, error: 'aside-hash-mismatch' });
          } else {
            results.copied.push({ name, dest: aside, mode: 'aside-not-overwrite' });
          }
        } catch (err) {
          results.verified = false;
          results.errors.push({ name, error: String(err && err.message) });
        }
        continue;
      }
      if (destSt && destSt.size > 0) {
        results.skipped.push({ name, reason: 'dest-exists' });
        continue;
      }
    }

    try {
      fs.copyFileSync(src, dest);
      const h1 = fileSha256(src);
      const h2 = fileSha256(dest);
      if (h1 !== h2) {
        results.verified = false;
        results.errors.push({ name, error: 'hash-mismatch' });
        try {
          fs.unlinkSync(dest);
        } catch (_) {}
      } else {
        results.copied.push({ name, dest, mode: 'copy' });
      }
    } catch (err) {
      results.verified = false;
      results.errors.push({ name, error: String(err && err.message) });
    }
  }

  log(
    `[WindowsUserData] migrateUserDataCopy from=${fromDir} to=${toDir} copied=${results.copied.length} skipped=${results.skipped.length} errors=${results.errors.length} verified=${results.verified}`
  );
  return results;
}

function copyDirRecursiveSafe(srcDir, destDir, results, log) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    const src = path.join(srcDir, name);
    const dest = path.join(destDir, name);
    const st = fs.statSync(src);
    if (st.isDirectory()) {
      copyDirRecursiveSafe(src, dest, results, log);
    } else if (st.isFile()) {
      if (pathExists(dest)) {
        results.skipped.push({ name: path.relative(destDir, dest), reason: 'dest-exists' });
        continue;
      }
      try {
        fs.copyFileSync(src, dest);
        results.copied.push({ name: path.join(path.basename(srcDir), name), dest, mode: 'copy' });
      } catch (err) {
        results.verified = false;
        results.errors.push({ name, error: String(err && err.message) });
      }
    }
  }
}

/**
 * Apply shared userData for packaged Windows builds.
 * Returns the resolution record (for logging / tests).
 */
function applySharedWindowsUserData(app, opts = {}) {
  const log = typeof opts.log === 'function' ? opts.log : (msg) => console.info(msg);
  const env = opts.env || process.env;
  const platform = opts.platform != null ? opts.platform : process.platform;
  const isPackaged = opts.isPackaged != null ? !!opts.isPackaged : !!(app && app.isPackaged);
  const isPortable = !!opts.isPortable;
  const windowsStore = opts.windowsStore != null ? !!opts.windowsStore : !!(process.windowsStore);
  const execPath = opts.execPath != null ? opts.execPath : process.execPath;

  if (platform !== 'win32') {
    return { applied: false, reason: 'not-windows' };
  }
  if (env.CUSTODYNOTE_TEST_USERDATA && String(env.CUSTODYNOTE_TEST_USERDATA).trim()) {
    return { applied: false, reason: 'test-userdata-override' };
  }
  if (isPortable) {
    return { applied: false, reason: 'portable' };
  }
  if (!isPackaged) {
    return { applied: false, reason: 'not-packaged' };
  }

  const channel = detectWindowsPackageChannel({
    platform,
    env,
    windowsStore,
    execPath,
    isPackaged,
    isPortable,
  });

  let packagePath = null;
  try {
    packagePath = app.getPath('userData');
  } catch (_) {
    packagePath = null;
  }

  const classicPath = getClassicUserDataPath(env, platform);
  const resolved = resolveSharedWindowsUserData({
    classicPath,
    packagePath,
    channel,
    env,
    platform,
    log,
  });

  try {
    fs.mkdirSync(resolved.userDataPath, { recursive: true });
  } catch (err) {
    log('[WindowsUserData] mkdir failed: ' + (err && err.message));
  }

  let migrationResult = null;
  if (resolved.migration && resolved.migration.from && resolved.migration.to) {
    migrationResult = migrateUserDataCopy(resolved.migration.from, resolved.migration.to, { log });
    if (!migrationResult.verified) {
      log('[WindowsUserData] Migration verification failed — continuing with classic path; source left intact');
    }
  }

  try {
    if (path.resolve(app.getPath('userData')) !== path.resolve(resolved.userDataPath)) {
      app.setPath('userData', resolved.userDataPath);
      log(
        `[WindowsUserData] setPath userData → ${resolved.userDataPath} (channel=${channel}, reason=${resolved.reason})`
      );
    } else {
      log(`[WindowsUserData] userData already classic ${resolved.userDataPath} (channel=${channel})`);
    }
  } catch (err) {
    log('[WindowsUserData] setPath failed: ' + (err && err.message));
    return { applied: false, reason: 'setPath-failed', channel, resolved, migrationResult, error: String(err && err.message) };
  }

  return {
    applied: true,
    channel,
    resolved,
    migrationResult,
    userDataPath: resolved.userDataPath,
  };
}

module.exports = {
  CLASSIC_USERDATA_DIRNAME,
  PROFILE_MARKERS,
  getClassicAppDataRoot,
  getClassicUserDataPath,
  detectWindowsPackageChannel,
  isMsixChannel,
  shouldDisableElectronUpdater,
  scoreUserDataProfile,
  resolveSharedWindowsUserData,
  migrateUserDataCopy,
  applySharedWindowsUserData,
  fileSha256,
};
