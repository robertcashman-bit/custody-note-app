'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const RECIPIENT_ROWS_SRC = fs.readFileSync(path.join(ROOT, 'renderer/lib/officerEmailRecipientRows.js'), 'utf8');

describe('officer email Outlook signature preference', () => {
  it('reads from _appSettingsCache and writes with setSettings', () => {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'http://localhost',
      runScripts: 'outside-only',
    });
    const win = dom.window;
    win._appSettingsCache = { officerEmailOutlookSignatureIncludesName: 'true' };
    const setCalls = [];
    win.api = {
      setSettings: (patch) => {
        setCalls.push(patch);
        return Promise.resolve(true);
      },
    };
    win.eval(RECIPIENT_ROWS_SRC);
    assert.strictEqual(win.OfficerEmailRecipientRows.readOutlookSigPreference(), true);

    win.OfficerEmailRecipientRows.writeOutlookSigPreference(false);
    assert.strictEqual(win._appSettingsCache.officerEmailOutlookSignatureIncludesName, 'false');
    assert.strictEqual(setCalls.length, 1);
    assert.strictEqual(setCalls[0].officerEmailOutlookSignatureIncludesName, 'false');
    assert.strictEqual(win.OfficerEmailRecipientRows.readOutlookSigPreference(), false);
  });
});
