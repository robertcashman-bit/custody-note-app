const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const channel = require('../lib/windowsPackageChannel');

describe('windowsPackageChannel — detection', () => {
  it('detects msix via process.windowsStore', () => {
    assert.equal(
      channel.detectWindowsPackageChannel({
        platform: 'win32',
        isPackaged: true,
        windowsStore: true,
        execPath: 'C:\\Program Files\\WindowsApps\\DefenceLegalServices.CustodyNote_1.0.0.0_x64\\app\\Custody Note.exe',
      }),
      'msix'
    );
  });

  it('detects msix via CUSTODYNOTE_CHANNEL override', () => {
    assert.equal(
      channel.detectWindowsPackageChannel({
        platform: 'win32',
        isPackaged: true,
        windowsStore: false,
        env: { CUSTODYNOTE_CHANNEL: 'msix' },
        execPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\custody-note\\Custody Note.exe',
      }),
      'msix'
    );
  });

  it('detects nsis for classic packaged install', () => {
    assert.equal(
      channel.detectWindowsPackageChannel({
        platform: 'win32',
        isPackaged: true,
        windowsStore: false,
        execPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\custody-note\\Custody Note.exe',
      }),
      'nsis'
    );
  });

  it('detects portable and disables updater', () => {
    assert.equal(
      channel.detectWindowsPackageChannel({
        platform: 'win32',
        isPackaged: true,
        isPortable: true,
        windowsStore: false,
      }),
      'portable'
    );
    assert.equal(channel.shouldDisableElectronUpdater('msix'), true);
    assert.equal(channel.shouldDisableElectronUpdater('portable'), true);
    assert.equal(channel.shouldDisableElectronUpdater('nsis'), false);
  });
});

describe('windowsPackageChannel — shared userData', () => {
  let tmp;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-msix-userdata-'));
  });

  after(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (_) {}
  });

  it('prefers classic path when package-local profile is empty', () => {
    const classic = path.join(tmp, 'classic-a');
    const pkgPath = path.join(tmp, 'package-a');
    fs.mkdirSync(classic, { recursive: true });
    fs.mkdirSync(pkgPath, { recursive: true });
    fs.writeFileSync(path.join(classic, 'attendances.db'), Buffer.alloc(4096, 1));
    fs.writeFileSync(path.join(classic, 'licence.dat'), 'x');

    const resolved = channel.resolveSharedWindowsUserData({
      classicPath: classic,
      packagePath: pkgPath,
      channel: 'msix',
    });
    assert.equal(resolved.userDataPath, classic);
    assert.match(resolved.reason, /classic/);
    assert.ok(resolved.classic.hasDb);
    assert.equal(resolved.package.hasDb, false);
  });

  it('never overwrites a newer classic DB when migrating from package', () => {
    const classic = path.join(tmp, 'classic-b');
    const pkgPath = path.join(tmp, 'package-b');
    fs.mkdirSync(classic, { recursive: true });
    fs.mkdirSync(pkgPath, { recursive: true });
    const classicDb = Buffer.alloc(8000, 2);
    const packageDb = Buffer.alloc(2000, 3);
    fs.writeFileSync(path.join(classic, 'attendances.db'), classicDb);
    fs.writeFileSync(path.join(pkgPath, 'attendances.db'), packageDb);
    fs.writeFileSync(path.join(pkgPath, 'licence.dat'), 'pkg-licence');

    const result = channel.migrateUserDataCopy(pkgPath, classic);
    assert.equal(result.verified, true);
    const skippedDb = result.skipped.find((s) => s.name === 'attendances.db');
    assert.ok(skippedDb, 'classic DB must be retained');
    assert.equal(fs.readFileSync(path.join(classic, 'attendances.db')).length, 8000);
    /* licence missing on classic should copy */
    assert.ok(fs.existsSync(path.join(classic, 'licence.dat')));
  });

  it('copies package DB to classic when classic has none, with hash verify', () => {
    const classic = path.join(tmp, 'classic-c');
    const pkgPath = path.join(tmp, 'package-c');
    fs.mkdirSync(classic, { recursive: true });
    fs.mkdirSync(pkgPath, { recursive: true });
    const packageDb = Buffer.alloc(3000, 7);
    fs.writeFileSync(path.join(pkgPath, 'attendances.db'), packageDb);
    fs.writeFileSync(path.join(pkgPath, 'recovery.dat'), 'recovery');

    const resolved = channel.resolveSharedWindowsUserData({
      classicPath: classic,
      packagePath: pkgPath,
      channel: 'msix',
    });
    assert.equal(resolved.migration && resolved.migration.mode, 'copy-before-use');

    const result = channel.migrateUserDataCopy(pkgPath, classic);
    assert.equal(result.verified, true);
    assert.ok(result.copied.some((c) => c.name === 'attendances.db'));
    const dest = path.join(classic, 'attendances.db');
    assert.equal(channel.fileSha256(dest), crypto.createHash('sha256').update(packageDb).digest('hex'));
    /* Source left intact */
    assert.ok(fs.existsSync(path.join(pkgPath, 'attendances.db')));
  });

  it('classic path helper matches NSIS installer ($APPDATA\\custody-note)', () => {
    const p = channel.getClassicUserDataPath({ APPDATA: 'C:\\Users\\Ada\\AppData\\Roaming' }, 'win32');
    assert.equal(p, path.join('C:\\Users\\Ada\\AppData\\Roaming', 'custody-note'));
  });
});

describe('windowsPackageChannel — wiring in app sources', () => {
  it('main.js applies shared userData and passes msix flag to updater', () => {
    const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    assert.match(mainJs, /applySharedWindowsUserData/);
    assert.match(mainJs, /isMsixStoreBuild:\s*IS_MSIX_STORE_BUILD/);
    assert.match(mainJs, /attendances\.db/);
  });

  it('updater.js no-ops electron-updater for msix', () => {
    const updaterJs = fs.readFileSync(path.join(__dirname, '..', 'updater.js'), 'utf8');
    assert.match(updaterJs, /isMsixStoreBuild/);
    assert.match(updaterJs, /Microsoft Store build is updated by the Store/);
    assert.match(updaterJs, /createNoopUpdaterController\(app, 'msix'\)/);
  });
});
