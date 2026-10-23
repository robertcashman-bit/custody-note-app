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
  buildFinaliseAttendanceSavePayload,
  shouldResetCertificationForDraftRecord,
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

  it('shows watermark when certification is Finalised but record status is still draft (failed finalise / amend gap)', () => {
    const d = { feeEarnerCertification: 'Finalised', _recordStatus: 'draft' };
    assert.equal(isAttendanceNoteFinalisedForPdf(d), false);
    assert.match(pdfDraftWatermarkHtml(d), /class="watermark">DRAFT/);
  });

  it('suppresses watermark when certification is Finalised and record status is absent (legacy export path)', () => {
    const d = { feeEarnerCertification: 'Finalised' };
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

describe('finalise certification timing (synthetic)', () => {
  it('buildFinaliseAttendanceSavePayload sets Finalised without mutating source data', () => {
    const source = { forename: 'Test', feeEarnerCertification: 'Draft' };
    const payload = buildFinaliseAttendanceSavePayload(source);
    assert.equal(source.feeEarnerCertification, 'Draft');
    assert.equal(payload.feeEarnerCertification, 'Finalised');
    assert.equal(payload.forename, 'Test');
  });

  it('shouldResetCertificationForDraftRecord detects inconsistent draft + Finalised cert', () => {
    assert.equal(shouldResetCertificationForDraftRecord('draft', 'Finalised'), true);
    assert.equal(shouldResetCertificationForDraftRecord('finalised', 'Finalised'), false);
    assert.equal(shouldResetCertificationForDraftRecord('draft', 'Draft'), false);
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

  it('does not set certification before hasMeaningfulData when finalising', () => {
    const saveStart = appJs.indexOf('function saveForm(status)');
    const meaningfulIdx = appJs.indexOf('hasMeaningfulData(data)', saveStart);
    const saveFormChunk = appJs.slice(saveStart, saveStart + 2500);
    assert.ok(meaningfulIdx > saveStart);
    assert.doesNotMatch(
      saveFormChunk.slice(0, meaningfulIdx - saveStart),
      /ensureFeeEarnerCertificationMatchesFinalise\(\)/
    );
  });

  it('builds finalise IPC payload with certification without early UI commit', () => {
    assert.match(appJs, /var savePayload = status === 'finalised' \? buildFinaliseSavePayload\(data\) : data/);
    assert.match(appJs, /commitFeeEarnerCertificationAfterFinaliseSuccess\(\)/);
    assert.match(appJs, /revertFeeEarnerCertificationAfterFailedFinalise\(\)/);
  });

  it('reconciles draft records with Finalised certification on open', () => {
    assert.match(appJs, /reconcileFeeEarnerCertificationWithDraftStatus\(currentRecordStatus\)/);
    assert.match(appJs, /certification reset save failed — will reconcile on open/);
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
