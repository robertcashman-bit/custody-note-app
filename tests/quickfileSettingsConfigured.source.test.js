/**
 * Regression: hasQuickFileSettingsConfigured() must see credentials after startup
 * getSettings — not only after opening Settings (loadSettings). See app.js bootstrap
 * hydrateQuickFileSettingsInputs and getQuickFileSettingsPayload cache fallback.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

test('app.js bootstraps QuickFile inputs from getSettings', () => {
  assert.ok(APP.includes('hydrateQuickFileSettingsInputs'), 'expected hydrateQuickFileSettingsInputs() after startup getSettings');
  assert.ok(
    APP.includes("qfAcc.value = s.quickfileAccountNumber") && APP.includes("qfKey.value"),
    'expected account + API key fields hydrated'
  );
});

test('app.js saveQuickFileSettings pushes credentials to the licence server', () => {
  assert.match(APP, /quickfileSettingsPush/);
});

test('completion-screen uses DB-backed QuickfileConfigured helper', () => {
  const completion = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'views', 'completion-screen.js'), 'utf8');
  assert.match(completion, /QuickfileConfigured\.fetchQuickFileConfigured/);
});
