'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const BILLING = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'views', 'billing-screen.js'), 'utf8');

describe('court typeahead source (app.js)', () => {
  it('initCourtAutocomplete shows no-match hint instead of closing dropdown', () => {
    assert.match(APP, /No courts match/);
    assert.match(APP, /showHint\("No courts match/);
  });

  it('retries loadMagistratesCourts on focus when list empty', () => {
    assert.match(APP, /if \(!magistratesCourts\.length/);
    assert.match(APP, /loadMagistratesCourts\(\)\.then\(runSuggestions\)/);
  });

  it('decodes court names when loading list', () => {
    assert.match(APP, /decodeCourtName/);
  });
});

describe('billing QuickFile resilience (billing-screen.js)', () => {
  it('uses Promise.allSettled so optional fetch failures do not block QF check', () => {
    assert.match(BILLING, /Promise\.allSettled/);
  });

  it('still uses DB-backed _wfIsQuickFileConfigured', () => {
    assert.match(BILLING, /_wfIsQuickFileConfigured/);
    assert.match(BILLING, /quickfileConnectionState/);
  });
});
