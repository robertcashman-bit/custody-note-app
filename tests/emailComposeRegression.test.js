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

  it('officerEmails can persist pending draft for dev diagnostics (no mail launch)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'renderer', 'officerEmails.js'), 'utf8');
    assert.ok(src.includes('savePendingEmailDraft'), 'pending draft save in diagnostics');
    assert.ok(!src.includes('openEmailDraft'), 'openEmailDraft not wired in officer emails (v1.6.21)');
  });

  it('index.html loads clipboard helper then pending-draft globals', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.ok(html.includes('renderer/emailCopy.js'));
    assert.ok(html.includes('renderer/email-pending-globals.js'));
  });
});
