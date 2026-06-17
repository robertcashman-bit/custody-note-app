'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const laaPdf = require('../lib/laaDeclarationPdf');

const root = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const refData = JSON.parse(fs.readFileSync(path.join(root, 'data', 'laa-reference-data.json'), 'utf8'));

describe('laaDeclarationPdf helpers', () => {
  it('includes LAA privacy notice text in PDF HTML', () => {
    const html = laaPdf.buildLaaPrivacyNoticeHtml(refData, function(s) { return s; });
    assert.match(html, /Legal Aid Agency \(LAA\) collects and processes your personal data/);
    assert.match(html, /Privacy Notice<\/p>/);
  });

  it('includes applicant declaration heading and text', () => {
    const html = laaPdf.buildLaaApplicantDeclarationHtml(refData, function(s) { return s; });
    assert.match(html, /Applicant\u2019s Declaration/);
    assert.match(html, /Legal Aid, Sentencing and Punishment of Offenders Act 2012/);
  });

  it('uses Privacy Notice acknowledged? label constant', () => {
    assert.strictEqual(laaPdf.PRIVACY_ACK_LABEL, 'Privacy Notice acknowledged?');
  });
});

describe('laaDeclarationPdf app wiring', () => {
  it('loads lib/laaDeclarationPdf.js before app.js', () => {
    const libIdx = indexHtml.indexOf('src="lib/laaDeclarationPdf.js"');
    const appIdx = indexHtml.indexOf('src="app.js"');
    assert.ok(libIdx !== -1);
    assert.ok(appIdx !== -1);
    assert.ok(libIdx < appIdx);
  });

  it('app.js prints privacy notice and renamed acknowledgment row in LAA Declaration', () => {
    assert.match(appJs, /laaPrivacyNoticePdfHtml/);
    assert.match(appJs, /laaApplicantDeclarationPdfHtml/);
    assert.match(appJs, /laaPrivacyAckLabel\(\)/);
    assert.doesNotMatch(appJs, /row\('Privacy Notice', d\.privacyNoticeAccepted\)/);
  });

  it('does not default privacyNoticeAccepted to No on new records', () => {
    assert.doesNotMatch(appJs, /formData\.privacyNoticeAccepted = 'No'/);
  });

  it('form field offers blank default before Yes/No', () => {
    assert.match(appJs, /privacyNoticeAccepted.*options: \['','Yes','No'\]/);
  });

  it('lib/laaDeclarationPdf.js uses browser-safe export', () => {
    const src = fs.readFileSync(path.join(root, 'lib', 'laaDeclarationPdf.js'), 'utf8');
    assert.match(src, /typeof module !== 'undefined' && module\.exports/);
    assert.match(src, /window\.LaaDeclarationPdf = LaaDeclarationPdf/);
  });

  it('includes CRM14 fraud warning helper', () => {
    const html = laaPdf.buildCrm14FraudWarningHtml(function(s) { return s; });
    assert.match(html, /Fraud notice/);
    assert.match(html, /zero tolerance approach to fraud/);
  });

  it('custody PDF always renders LAA Declaration section (no skip gate)', () => {
    assert.match(appJs, /11\. LAA Declaration/);
    assert.doesNotMatch(
      appJs,
      /if \(!laaRows && !hasSig && !laaPrivacyNoticePdfHtml\(h\) && !laaApplicantDeclarationPdfHtml\(h\)\) return '';/,
    );
    assert.match(appJs, /laaPrivacyNoticePdfHtml\(h\)/);
    assert.match(appJs, /Counsel instructed\? \(CRM3\)/);
    assert.match(appJs, /crm14FraudWarningPdfHtml\(h\)/);
  });
});
