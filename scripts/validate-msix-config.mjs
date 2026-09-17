#!/usr/bin/env node
/**
 * CI / local gate for Microsoft Store (AppX/MSIX) packaging config.
 * Fail closed on missing icons, invalid version, or Partner Center identity mismatch.
 *
 * Does NOT require Windows — config/assets only.
 * Run: npm run validate:msix
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const errors = [];

function fail(msg) {
  errors.push(msg);
}

const version = String(pkg.version || '');
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  fail(`package.json version must be semver X.Y.Z for Store four-part mapping (got "${version}")`);
} else {
  const parts = version.split('.').map((n) => Number(n));
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 65535)) {
    fail(`version components must be 0–65535 for Windows Store (got ${version})`);
  }
}

const winTargets = (((pkg.build || {}).win || {}).target) || [];
const targetNames = winTargets.map((t) => (typeof t === 'string' ? t : t && t.target)).filter(Boolean);
if (!targetNames.includes('nsis')) fail('build.win.target must still include nsis');
if (!targetNames.includes('appx')) {
  fail(
    'build.win.target must include appx (electron-builder 26 Store/MSIX channel — there is no separate "msix" target in this version)'
  );
}

const appx = (pkg.build || {}).appx || {};
if (!appx.identityName) fail('build.appx.identityName is required');
if (!appx.applicationId) fail('build.appx.applicationId is required');
if (!appx.publisher) fail('build.appx.publisher is required');
if (!appx.publisherDisplayName) fail('build.appx.publisherDisplayName is required');
if (!appx.displayName) fail('build.appx.displayName is required');
if (appx.electronUpdaterAware !== false) {
  fail('build.appx.electronUpdaterAware must be false (Store manages updates)');
}
if (!String(appx.artifactName || '').includes('.msix')) {
  fail('build.appx.artifactName should produce a .msix artefact (Store-compatible)');
}

/** Partner Center rejects MSIX packages with TargetDeviceFamily MinVersion ≤ 10.0.17134.0. */
const STORE_MIN_VERSION_FLOOR = '10.0.17763.0';
const WIN_VERSION_RE = /^\d+\.\d+\.\d+\.\d+$/;

function parseWinVersion(v) {
  return String(v).split('.').map((n) => Number(n));
}

function compareWinVersion(a, b) {
  const pa = parseWinVersion(a);
  const pb = parseWinVersion(b);
  for (let i = 0; i < 4; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da - db;
  }
  return 0;
}

const minVersion = String(appx.minVersion || '');
if (!WIN_VERSION_RE.test(minVersion)) {
  fail(
    `build.appx.minVersion must be a four-part Windows version (got "${minVersion || '(missing)'}"); ` +
      `electron-builder x64 default 10.0.14316.0 is rejected by Partner Center`
  );
} else if (compareWinVersion(minVersion, STORE_MIN_VERSION_FLOOR) < 0) {
  fail(
    `build.appx.minVersion must be ≥ ${STORE_MIN_VERSION_FLOOR} for Partner Center ` +
      `(got "${minVersion}"; packages with MinVersion ≤ 10.0.17134.0 are rejected)`
  );
}

const maxVersionTested = String(appx.maxVersionTested || '');
if (maxVersionTested && !WIN_VERSION_RE.test(maxVersionTested)) {
  fail(`build.appx.maxVersionTested must be a four-part Windows version (got "${maxVersionTested}")`);
} else if (maxVersionTested && compareWinVersion(maxVersionTested, minVersion) < 0) {
  fail(
    `build.appx.maxVersionTested (${maxVersionTested}) must be ≥ minVersion (${minVersion})`
  );
}

if (!Array.isArray(appx.capabilities) || !appx.capabilities.includes('runFullTrust')) {
  fail(
    'build.appx.capabilities must include runFullTrust (required for Electron Desktop Bridge / full-trust MSIX)'
  );
}

/** Partner Center Product identity (paste-exact — do not invent). */
const EXPECTED_IDENTITY = {
  identityName: 'PoliceStationAgent.CustodyNoteforWindows',
  publisher: 'CN=E2B27EAF-500B-4615-A55C-DB01E913CBC7',
  publisherDisplayName: 'Police Station Agent',
  /* Package/Properties/DisplayName must equal the reserved Store name exactly. */
  displayName: 'Custody Note for Windows',
};

const publisher = String(appx.publisher);
if (!publisher.startsWith('CN=')) fail('build.appx.publisher must be a CN=… Distinguished Name');
if (/TBD|REPLACE|YOUR_|PLACEHOLDER/i.test(publisher)) {
  fail('publisher still looks like a placeholder — use the Partner Center Publisher CN');
}
if (String(appx.identityName) !== EXPECTED_IDENTITY.identityName) {
  fail(
    `build.appx.identityName must be Partner Center Package/Identity name "${EXPECTED_IDENTITY.identityName}" (got "${appx.identityName}")`
  );
}
if (publisher !== EXPECTED_IDENTITY.publisher) {
  fail(
    `build.appx.publisher must be Partner Center Publisher "${EXPECTED_IDENTITY.publisher}" (got "${publisher}")`
  );
}
if (String(appx.publisherDisplayName) !== EXPECTED_IDENTITY.publisherDisplayName) {
  fail(
    `build.appx.publisherDisplayName must be "${EXPECTED_IDENTITY.publisherDisplayName}" (got "${appx.publisherDisplayName}")`
  );
}
if (String(appx.displayName) !== EXPECTED_IDENTITY.displayName) {
  fail(
    `build.appx.displayName must be reserved Store name "${EXPECTED_IDENTITY.displayName}" ` +
      `(Package/Properties/DisplayName — Partner Center rejects mismatches; got "${appx.displayName}")`
  );
}

const productName = String((pkg.build || {}).productName || '');
if (productName !== 'Custody Note') {
  fail(
    `build.productName must remain "Custody Note" for NSIS/desktop branding ` +
      `(Store DisplayName is build.appx.displayName only; got "${productName}")`
  );
}

const appId = (pkg.build || {}).appId;
if (appId !== 'com.custodynote.app') {
  fail(`Electron appId must remain com.custodynote.app for NSIS data/updater compatibility (got ${appId})`);
}

const requiredAssets = [
  'StoreLogo.png',
  'Square44x44Logo.png',
  'Square150x150Logo.png',
  'Wide310x150Logo.png',
  'SplashScreen.png',
];
const assetDir = path.join(root, 'build', 'appx');
for (const name of requiredAssets) {
  const p = path.join(assetDir, name);
  if (!fs.existsSync(p) || fs.statSync(p).size < 32) {
    fail(`Missing or empty AppX asset: build/appx/${name} (run npm run build:msix:assets)`);
  }
}

const docPath = path.join(root, 'docs', 'MICROSOFT_STORE_RELEASE.md');
if (!fs.existsSync(docPath)) fail('docs/MICROSOFT_STORE_RELEASE.md is required');

const channelLib = path.join(root, 'lib', 'windowsPackageChannel.js');
if (!fs.existsSync(channelLib)) fail('lib/windowsPackageChannel.js is required');

const updaterSrc = fs.readFileSync(path.join(root, 'updater.js'), 'utf8');
if (!/isMsixStoreBuild/.test(updaterSrc) || !/reason === 'msix'/.test(updaterSrc)) {
  fail('updater.js must disable electron-updater for MSIX/Store builds');
}

const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
if (!/windowsPackageChannel/.test(mainSrc) || !/applySharedWindowsUserData/.test(mainSrc)) {
  fail('main.js must apply shared Windows userData resolution for NSIS/MSIX coexistence');
}

const nsis = ((pkg.build || {}).nsis || {});
if (nsis.deleteAppDataOnUninstall === true) {
  fail('nsis.deleteAppDataOnUninstall must remain false (record safety)');
}

if (errors.length) {
  for (const e of errors) console.error('[validate:msix] FAIL:', e);
  process.exit(1);
}

console.log('[validate:msix] OK — AppX/MSIX config, assets, updater gate, and shared userData wiring look valid.');
console.log(`[validate:msix] version ${version} → Windows Store form ${version}.0 (via setBuildNumber)`);
console.log(`[validate:msix] TargetDeviceFamily MinVersion=${minVersion} MaxVersionTested=${maxVersionTested || minVersion}`);
console.log(`[validate:msix] Partner Center identity: ${appx.identityName} / ${publisher}`);
console.log(
  '[validate:msix] NOTE: runFullTrust is a restricted capability — Robert must provide approval/explanation in Partner Center Submission options if prompted (expected for Electron; do not remove).'
);
