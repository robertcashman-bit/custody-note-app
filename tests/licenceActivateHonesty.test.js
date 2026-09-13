const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { normalizeLicenceKeyForSync } = require('../lib/licenceKeyNormalize');
const { mapLicenceActivateFailure } = require('../main/licenceActivateResult');

const root = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const licenceJs = fs.readFileSync(path.join(root, 'renderer', 'licence.js'), 'utf8');

describe('normalizeLicenceKeyForSync (activate / validate)', () => {
  it('uppercases and trims without stripping CN-ADMIN hyphens', () => {
    assert.equal(
      normalizeLicenceKeyForSync('  cn-admin-aaaa-bbbb-cccc  '),
      'CN-ADMIN-AAAA-BBBB-CCCC',
    );
    assert.match(normalizeLicenceKeyForSync('CN-ADMIN-AAAA-BBBB-CCCC'), /-/);
    assert.equal(
      normalizeLicenceKeyForSync('CN-ADMIN-AAAA-BBBB-CCCC').split('-').length,
      5,
    );
  });

  it('does not collapse hyphenated keys into a dashed-less form', () => {
    const key = 'CN-A1B2-C3D4-E5F6-G7H8';
    assert.equal(normalizeLicenceKeyForSync(key), key);
    assert.notEqual(normalizeLicenceKeyForSync(key), key.replace(/-/g, ''));
  });
});

describe('mapLicenceActivateFailure', () => {
  it('surfaces server validate message (No valid credentials provided)', () => {
    const mapped = mapLicenceActivateFailure({
      valid: false,
      message: 'No valid credentials provided',
    });
    assert.deepEqual(mapped, {
      success: false,
      message: 'No valid credentials provided',
    });
  });

  it('falls back when message empty', () => {
    assert.deepEqual(mapLicenceActivateFailure({ valid: false, message: '  ' }), {
      success: false,
      message: 'Licence key is not valid',
    });
  });

  it('returns null when not an explicit invalid result', () => {
    assert.equal(mapLicenceActivateFailure({ valid: true }), null);
    assert.equal(mapLicenceActivateFailure({ valid: null, offline: true }), null);
    assert.equal(mapLicenceActivateFailure(null), null);
  });
});

describe('licence activate surfaces validate message (source)', () => {
  it('licence:activate normalises via licenceKeyNormalize then maps validate failure', () => {
    assert.match(mainJs, /mapLicenceActivateFailure/);
    assert.match(mainJs, /normalizeLicenceKeyForSync\(key\)/);
    assert.match(mainJs, /validateLicenceOnline\(normalizedKey/);
    // Must not strip hyphens in activate prep (CN-ADMIN form).
    const activateSlice = mainJs.slice(
      mainJs.indexOf("ipcMain.handle('licence:activate'"),
      mainJs.indexOf("ipcMain.handle('licence:validate'"),
    );
    assert.doesNotMatch(activateSlice, /replace\(\/\[\\s-\]/);
    assert.match(activateSlice, /mapLicenceActivateFailure\(result\)/);
  });

  it('validateLicenceOnline POSTs normalised key', () => {
    assert.match(mainJs, /const normalizedKey = normalizeLicenceKeyForSync\(key\);/);
    assert.match(mainJs, /key: normalizedKey/);
  });

  it('Settings / overlay / trial Activate show result.message on failure', () => {
    assert.match(appJs, /errEl\.textContent = result\.message \|\| 'Activation failed'/);
    assert.match(
      appJs,
      /errEl\.textContent = result\.message \|\| 'Activation failed \\u2014 check the key/,
    );
    assert.match(
      licenceJs,
      /showError\(result && result\.message \? result\.message : 'Activation failed/,
    );
  });

  it('trial upgrade no longer strips hyphens from pasted keys', () => {
    const trialSlice = appJs.slice(
      appJs.indexOf("btn-trial-upgrade-activate"),
      appJs.indexOf("/* ─── Cloud backup event handlers"),
    );
    assert.doesNotMatch(trialSlice, /replace\(\/\[\\s-\]/);
    assert.match(trialSlice, /replace\(\/\\s\/g/);
  });
});
