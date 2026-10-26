'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('Electron fuses (packaged builds)', () => {
  it('package.json wires afterPack flip script and @electron/fuses devDependency', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    assert.strictEqual(pkg.build.afterPack, './scripts/flip-electron-fuses.cjs');
    assert.ok(pkg.devDependencies['@electron/fuses'], '@electron/fuses devDependency required');
    const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'flip-electron-fuses.cjs'), 'utf8');
    assert.match(script, /RunAsNode\]: false/);
    assert.match(script, /EnableCookieEncryption\]: true/);
    assert.match(script, /OnlyLoadAppFromAsar\]: true/);
    assert.match(script, /EnableEmbeddedAsarIntegrityValidation\]: true/);
  });
});
