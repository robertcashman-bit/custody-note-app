'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PKG = path.join(ROOT, 'package.json');
const MAIN = path.join(ROOT, 'main.js');
const PRELOAD = path.join(ROOT, 'preload.js');
const LIB = path.join(ROOT, 'lib', 'automatedTestBuild.js');

describe('automatedTestBuild (release vs CI test-hook builds)', () => {
  it('release package.json does not enable cnPackagedTestHooks', () => {
    const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
    assert.notStrictEqual(pkg.cnPackagedTestHooks, true, 'release config must not bake in test hooks');
  });

  it('packaged release ignores automated-test env even when vars are set', () => {
    const prev = process.env.CUSTODYNOTE_TEST_USERDATA;
    process.env.CUSTODYNOTE_TEST_USERDATA = '/tmp/attacker-controlled-userdata';
    try {
      const mod = require(LIB);
      assert.strictEqual(mod.mayHonorAutomatedTestEnv({ isPackaged: true }), false);
      assert.strictEqual(mod.hasPackagedTestHooksBakedIn({ isPackaged: true }), false);
      assert.strictEqual(mod.isAutomatedTestEnvActive({ isPackaged: true }), false);
    } finally {
      if (prev === undefined) delete process.env.CUSTODYNOTE_TEST_USERDATA;
      else process.env.CUSTODYNOTE_TEST_USERDATA = prev;
    }
  });

  it('unpackaged dev runs may still honor automated-test env', () => {
    const mod = require(LIB);
    assert.strictEqual(mod.mayHonorAutomatedTestEnv({ isPackaged: false }), true);
  });
});

describe('automatedTestBuild (main/preload gates — source)', () => {
  it('main.js gates CUSTODYNOTE_TEST_USERDATA on mayHonorAutomatedTestEnv', () => {
    const src = fs.readFileSync(MAIN, 'utf8');
    assert.ok(src.includes('mayHonorAutomatedTestEnv'), 'main must use automated test build gate');
    assert.ok(src.includes('Ignoring CUSTODYNOTE_TEST_USERDATA on packaged release build'));
    assert.ok(src.includes('CUSTODYNOTE_PACKAGED_TEST_HOOKS'));
  });

  it('preload.js exposes __CUSTODYNOTE_E2E__ only with CUSTODYNOTE_PACKAGED_TEST_HOOKS when packaged', () => {
    const src = fs.readFileSync(PRELOAD, 'utf8');
    assert.ok(src.includes('CUSTODYNOTE_PACKAGED_TEST_HOOKS'));
    assert.ok(!src.includes('cnPackagedPlaywrightE2e'), 'env-only packaged bypass removed');
  });
});
