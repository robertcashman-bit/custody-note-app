/**
 * Regression — officer email compose flows stay non-automated; preview/copy intact.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

describe('Email compose regression', () => {
  it('officerEmails still generates templates and does not invoke automatic send APIs', () => {
    const src = fs.readFileSync(path.join(ROOT, 'renderer', 'officerEmails.js'), 'utf8');
    assert.ok(src.includes('OFFICER_EMAIL_TEMPLATES'), 'placeholder templates preserved');
    assert.ok(src.includes('updatePreviewAndSummary'), 'preview pipeline present');
    assert.ok(src.includes('custodyCopyEmailText'), 'clipboard copy helper');
    assert.ok(src.includes('copyBody'), 'copy body helpers');
    assert.ok(!src.includes('nodemailer'), 'no nodemailer in officer emails');
    assert.ok(!src.includes('sendMail'), 'no sendMail');
    assert.ok(!src.includes('graph.microsoft.com'), 'no Graph send');
  });

  it('officerEmails uses pending draft + openEmailDraft (no auto-send)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'renderer', 'officerEmails.js'), 'utf8');
    assert.ok(src.includes('savePendingEmailDraft'), 'saves pending before open');
    assert.ok(src.includes('openEmailDraft'), 'opens via draft helper');
  });

  it('index.html loads clipboard helper then email draft glue', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.ok(html.includes('renderer/emailCopy.js'));
    assert.ok(html.includes('renderer/email-draft-open.js'));
  });
});
