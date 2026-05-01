/**
 * UI/source checks — compose fallback, continue draft, validation wiring.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

describe('Email compose UI (source)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const officerJs = fs.readFileSync(path.join(ROOT, 'renderer', 'officerEmails.js'), 'utf8');

  it('index has Continue opening draft and fallback panel controls', () => {
    assert.ok(html.includes('id="officerContinueDraftBtn"'));
    assert.ok(html.includes('id="officerEmailFallbackPanel"'));
    assert.ok(html.includes('id="officerFbContinueBtn"'));
    assert.ok(html.includes('id="officerClearPendingDraftBtn"'));
    assert.ok(html.includes('Email Compose Diagnostics'));
  });

  it('officerEmails wires pending resume and clears pending on full clear', () => {
    assert.ok(officerJs.includes('resumePendingEmailDraft'));
    assert.ok(officerJs.includes('clearPendingEmailDraft'));
    assert.ok(officerJs.includes('officerClearPendingDraftBtn'));
    assert.ok(officerJs.includes('SESSION_OPEN_FLAG'));
  });

  it('officerEmails has compose warnings, validation for save/mark, and primary Copy Email Body', () => {
    assert.ok(officerJs.includes('function validate'));
    assert.ok(officerJs.includes('getMissingRequiredFields'));
    assert.ok(officerJs.includes('updateComposeWarnings'));
    assert.ok(officerJs.includes('officerHeroCopyBodyBtn'));
    assert.ok(html.includes('id="officerComposeWarnings"'));
    assert.ok(html.includes('Copy Email Body'));
  });
});
