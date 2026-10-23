'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  isAttendanceNoteFinalisedForPdf,
  shouldShowPdfDraftWatermark,
  pdfDraftWatermarkHtml,
  WATERMARK_LABEL,
} = require('../lib/pdfDraftWatermark');

describe('pdfDraftWatermark', () => {
  it('shows DRAFT watermark for draft records with certification not Finalised', () => {
    const d = { forename: 'A', feeEarnerCertification: 'Draft', _recordStatus: 'draft' };
    assert.equal(isAttendanceNoteFinalisedForPdf(d), false);
    assert.equal(shouldShowPdfDraftWatermark(d), true);
    assert.match(pdfDraftWatermarkHtml(d), new RegExp('class="watermark">' + WATERMARK_LABEL));
  });

  it('suppresses watermark when record status is finalised (v1.9.118 bug)', () => {
    const d = {
      forename: 'Jane',
      surname: 'Doe',
      feeEarnerCertification: 'Draft',
      _recordStatus: 'finalised',
    };
    assert.equal(isAttendanceNoteFinalisedForPdf(d), true);
    assert.equal(pdfDraftWatermarkHtml(d), '');
  });

  it('suppresses watermark when record status is completed', () => {
    const d = { _recordStatus: 'completed', feeEarnerCertification: '' };
    assert.equal(pdfDraftWatermarkHtml(d), '');
  });

  it('suppresses watermark when fee earner certification is Finalised (legacy path)', () => {
    const d = { feeEarnerCertification: 'Finalised', _recordStatus: 'draft' };
    assert.equal(pdfDraftWatermarkHtml(d), '');
  });

  it('uses DRAFT label instead of template-specific product names', () => {
    const d = { _recordStatus: 'draft' };
    const html = pdfDraftWatermarkHtml(d);
    assert.ok(html.includes('DRAFT'));
    assert.ok(!html.includes('CUSTODY NOTE'));
    assert.ok(!html.includes('TELEPHONE ADVICE'));
  });
});

describe('app.js PDF builders use shared draft watermark helper', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

  it('calls pdfDraftWatermarkHtml in all three attendance PDF builders', () => {
    const custodyStart = appJs.indexOf('function buildPdfHtml(');
    const telStart = appJs.indexOf('function buildTelephonePdfHtml(');
    const volStart = appJs.indexOf('function buildVoluntaryPdfHtml(');
    const afterVol = appJs.indexOf('function getActivePdfBuilder', volStart);
    assert.ok(custodyStart >= 0 && telStart > custodyStart && volStart > telStart && afterVol > volStart);

    const custodyBody = appJs.slice(custodyStart, telStart);
    const telBody = appJs.slice(telStart, volStart);
    const volBody = appJs.slice(volStart, afterVol);

    assert.match(custodyBody, /pdfDraftWatermarkHtml\(d\)/);
    assert.match(telBody, /pdfDraftWatermarkHtml\(d\)/);
    assert.match(volBody, /pdfDraftWatermarkHtml\(d\)/);
    assert.doesNotMatch(custodyBody, /CUSTODY NOTE<\/div>/);
    assert.doesNotMatch(telBody, /TELEPHONE ADVICE<\/div>/);
    assert.doesNotMatch(volBody, /<div class="watermark">VOLUNTARY<\/div>/);
  });

  it('sets certification to Finalised when saveForm finalises', () => {
    assert.match(appJs, /if \(status === 'finalised'\) ensureFeeEarnerCertificationMatchesFinalise\(\)/);
  });

  it('enriches PDF export data with record status', () => {
    assert.match(appJs, /enrichDataForPdf\(getFormData\(\)\)/);
    assert.match(appJs, /enrichDataForPdf\(data, row\.status\)/);
  });
});

describe('documents-screen enriches attendance_note PDF data', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'renderer', 'views', 'documents-screen.js'),
    'utf8'
  );

  it('passes enrichDataForPdf into attendance_note builder', () => {
    assert.match(src, /enrichDataForPdf\(data\)/);
  });
});
