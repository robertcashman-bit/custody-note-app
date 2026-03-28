/**
 * Workflow utility tests — filenameUtils.js and billingUtils.js
 * Validates naming rules, invoice calculations, and QuickFile payload structure.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const filenameUtilsSrc = fs.readFileSync(path.join(root, 'renderer', 'filenameUtils.js'), 'utf8');
const billingUtilsSrc = fs.readFileSync(path.join(root, 'renderer', 'billingUtils.js'), 'utf8');
const workflowStepperSrc = fs.readFileSync(path.join(root, 'renderer', 'views', 'workflow-stepper.js'), 'utf8');
const docScreenSrc = fs.readFileSync(path.join(root, 'renderer', 'views', 'documents-screen.js'), 'utf8');
const billingScreenSrc = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing-screen.js'), 'utf8');

// Evaluate helpers in a sandbox so we can call them
const sandbox = {};
const evalCode = filenameUtilsSrc + '\n' + billingUtilsSrc;
new Function(evalCode).call(sandbox);
const ctx = {};
new Function(
  'exports',
  evalCode + '\n' +
  'exports.formatStationShort = formatStationShort;\n' +
  'exports.formatInvoiceTitle = formatInvoiceTitle;\n' +
  'exports.formatDateForFilename = formatDateForFilename;\n' +
  'exports.formatFirmForFilename = formatFirmForFilename;\n' +
  'exports.formatDocumentType = formatDocumentType;\n' +
  'exports.formatAttachmentFilename = formatAttachmentFilename;\n' +
  'exports.buildLine1Description = buildLine1Description;\n' +
  'exports.calculateInvoiceTotals = calculateInvoiceTotals;\n' +
  'exports.buildQuickFilePayload = buildQuickFilePayload;\n' +
  'exports.buildQuickFileLineItems = buildQuickFileLineItems;\n' +
  'exports.DOCUMENT_TYPE_OPTIONS = DOCUMENT_TYPE_OPTIONS;\n' +
  'exports.BILLING_DEFAULTS = BILLING_DEFAULTS;\n' +
  'exports.INVOICE_STATUSES = INVOICE_STATUSES;\n'
)(ctx);

describe('formatStationShort', () => {
  it('converts "Tonbridge Police Station" to "Tonbridge ps"', () => {
    assert.strictEqual(ctx.formatStationShort('Tonbridge Police Station'), 'Tonbridge ps');
  });

  it('converts "Medway Police Station" to "Medway ps"', () => {
    assert.strictEqual(ctx.formatStationShort('Medway Police Station'), 'Medway ps');
  });

  it('converts "Maidstone police station" to "Maidstone ps"', () => {
    assert.strictEqual(ctx.formatStationShort('Maidstone police station'), 'Maidstone ps');
  });

  it('returns empty string for empty input', () => {
    assert.strictEqual(ctx.formatStationShort(''), '');
    assert.strictEqual(ctx.formatStationShort(null), '');
  });

  it('trims whitespace and collapses spaces', () => {
    assert.strictEqual(ctx.formatStationShort('  Tonbridge  Police   Station  '), 'Tonbridge ps');
  });
});

describe('formatInvoiceTitle', () => {
  it('formats "Nicholas Bubb" + "Tonbridge Police Station"', () => {
    assert.strictEqual(ctx.formatInvoiceTitle('Nicholas Bubb', 'Tonbridge Police Station'), 'Nicholas Bubb - Tonbridge ps');
  });

  it('formats "Jamie Crouch" + "Medway Police Station"', () => {
    assert.strictEqual(ctx.formatInvoiceTitle('Jamie Crouch', 'Medway Police Station'), 'Jamie Crouch - Medway ps');
  });

  it('handles missing station', () => {
    assert.strictEqual(ctx.formatInvoiceTitle('Nicholas Bubb', ''), 'Nicholas Bubb');
  });

  it('handles missing client', () => {
    assert.strictEqual(ctx.formatInvoiceTitle('', 'Tonbridge Police Station'), 'Tonbridge ps');
  });

  it('handles both empty', () => {
    assert.strictEqual(ctx.formatInvoiceTitle('', ''), '');
  });

  it('trims and collapses whitespace', () => {
    assert.strictEqual(ctx.formatInvoiceTitle('  Nicholas   Bubb  ', '  Tonbridge  Police  Station  '), 'Nicholas Bubb - Tonbridge ps');
  });
});

describe('formatDateForFilename', () => {
  it('converts 2026-03-19 to 19.03.26', () => {
    assert.strictEqual(ctx.formatDateForFilename('2026-03-19'), '19.03.26');
  });

  it('converts 2026-03-24 to 24.03.26', () => {
    assert.strictEqual(ctx.formatDateForFilename('2026-03-24'), '24.03.26');
  });

  it('handles datetime strings', () => {
    assert.strictEqual(ctx.formatDateForFilename('2026-03-19T14:30:00'), '19.03.26');
  });

  it('returns empty for invalid input', () => {
    assert.strictEqual(ctx.formatDateForFilename(''), '');
    assert.strictEqual(ctx.formatDateForFilename(null), '');
    assert.strictEqual(ctx.formatDateForFilename('invalid'), '');
  });
});

describe('formatFirmForFilename', () => {
  it('converts "Tuckers" to "Tuckers"', () => {
    assert.strictEqual(ctx.formatFirmForFilename('Tuckers'), 'Tuckers');
  });

  it('converts "Gullands Optimiz" to "Gullands_Optimiz"', () => {
    assert.strictEqual(ctx.formatFirmForFilename('Gullands Optimiz'), 'Gullands_Optimiz');
  });

  it('converts "Defence Legal Services" to "Defence_Legal_Services"', () => {
    assert.strictEqual(ctx.formatFirmForFilename('Defence Legal Services'), 'Defence_Legal_Services');
  });

  it('strips forbidden characters', () => {
    assert.strictEqual(ctx.formatFirmForFilename('Firm <Test>'), 'Firm_Test');
  });
});

describe('formatDocumentType', () => {
  it('returns standard types as-is', () => {
    assert.strictEqual(ctx.formatDocumentType('police_station_attendance_note'), 'police_station_attendance_note');
    assert.strictEqual(ctx.formatDocumentType('declaration'), 'declaration');
  });

  it('handles "other" with custom type', () => {
    assert.strictEqual(ctx.formatDocumentType('other', 'My Custom Doc'), 'my_custom_doc');
  });

  it('returns "document" for empty input', () => {
    assert.strictEqual(ctx.formatDocumentType(''), 'document');
    assert.strictEqual(ctx.formatDocumentType(null), 'document');
  });
});

describe('formatAttachmentFilename', () => {
  it('generates correct filename for Owen Goodhand example', () => {
    var result = ctx.formatAttachmentFilename({
      clientName: 'Owen Goodhand',
      policeStation: 'Medway Police Station',
      attendanceDate: '2026-03-19',
      documentType: 'police_station_attendance_note',
      firmName: 'Gullands Optimiz',
      extension: '.pdf',
    });
    assert.ok(result.startsWith('Owen_Goodhand'), 'Should start with client name: ' + result);
    assert.ok(result.includes('Medway'), 'Should include station: ' + result);
    assert.ok(result.includes('19.03.26'), 'Should include formatted date: ' + result);
    assert.ok(result.includes('police_station_attendance_note'), 'Should include doc type: ' + result);
    assert.ok(result.includes('Gullands_Optimiz'), 'Should include firm: ' + result);
    assert.ok(result.endsWith('.pdf'), 'Should end with .pdf: ' + result);
  });

  it('handles missing extension by defaulting to .pdf', () => {
    var result = ctx.formatAttachmentFilename({
      clientName: 'Test', policeStation: 'Test PS', attendanceDate: '2026-01-01',
      documentType: 'declaration', firmName: 'Firm',
    });
    assert.ok(result.endsWith('.pdf'), 'Should default to .pdf');
  });

  it('strips forbidden characters from filename', () => {
    var result = ctx.formatAttachmentFilename({
      clientName: 'Te<st>Na:me', policeStation: 'St|ation', attendanceDate: '2026-01-01',
      documentType: 'declaration', firmName: 'Fir"m',
    });
    assert.ok(!result.includes('<'), 'Should not contain <');
    assert.ok(!result.includes('>'), 'Should not contain >');
    assert.ok(!result.includes(':'), 'Should not contain :');
    assert.ok(!result.includes('"'), 'Should not contain "');
  });

  it('truncates to max 240 chars before extension', () => {
    var result = ctx.formatAttachmentFilename({
      clientName: 'A'.repeat(100), policeStation: 'B'.repeat(100),
      attendanceDate: '2026-01-01', documentType: 'declaration',
      firmName: 'C'.repeat(100), extension: '.pdf',
    });
    assert.ok(result.length <= 244, 'Should be max 244 chars (240 + .pdf): ' + result.length);
  });
});

describe('buildLine1Description', () => {
  it('builds correct line 1 description', () => {
    var result = ctx.buildLine1Description({
      clientName: 'Nicholas Bubb',
      policeStation: 'Tonbridge Police Station',
      attendanceDate: '2026-03-24',
    });
    assert.ok(result.includes('Police Station Attendance Fixed Fee'), 'Should include fixed fee label');
    assert.ok(result.includes('Nicholas Bubb'), 'Should include client name');
    assert.ok(result.includes('Tonbridge Police Station'), 'Should include station');
    assert.ok(result.includes('24.03.26'), 'Should include formatted date');
  });

  it('handles missing fields gracefully', () => {
    var result = ctx.buildLine1Description({});
    assert.strictEqual(result, 'Police Station Attendance Fixed Fee');
  });
});

describe('calculateInvoiceTotals', () => {
  it('calculates standard totals correctly', () => {
    var totals = ctx.calculateInvoiceTotals({
      fixedFee: 160, mileageMiles: 46, mileageRate: 0.45, vatRate: 0.20,
    });
    assert.strictEqual(totals.fixedFee, 160);
    assert.strictEqual(totals.mileageAmount, 20.70);
    assert.strictEqual(totals.subTotal, 180.70);
    assert.strictEqual(totals.vatTotal, 36.14);
    assert.strictEqual(totals.grandTotal, 216.84);
  });

  it('uses defaults for missing rates', () => {
    var totals = ctx.calculateInvoiceTotals({ fixedFee: 160, mileageMiles: 0 });
    assert.strictEqual(totals.mileageRate, 0.45);
    assert.strictEqual(totals.vatRate, 0.20);
  });

  it('includes parking in subtotal', () => {
    var totals = ctx.calculateInvoiceTotals({
      fixedFee: 100, mileageMiles: 0, mileageRate: 0.45,
      parkingAmount: 10, vatRate: 0.20,
    });
    assert.strictEqual(totals.subTotal, 110);
    assert.strictEqual(totals.vatTotal, 22);
    assert.strictEqual(totals.grandTotal, 132);
  });

  it('handles zero values', () => {
    var totals = ctx.calculateInvoiceTotals({
      fixedFee: 0, mileageMiles: 0, mileageRate: 0, vatRate: 0,
    });
    assert.strictEqual(totals.grandTotal, 0);
  });
});

describe('buildQuickFilePayload', () => {
  it('builds a complete payload', () => {
    var payload = ctx.buildQuickFilePayload({
      clientName: 'Nicholas Bubb',
      policeStation: 'Tonbridge Police Station',
      attendanceDate: '2026-03-24',
      firmName: 'Tuckers',
      fixedFee: 160,
      mileageMiles: 46,
      mileageRate: 0.45,
      vatRate: 0.20,
    });
    assert.strictEqual(payload.invoiceTitle, 'Nicholas Bubb - Tonbridge ps');
    assert.strictEqual(payload.clientName, 'Nicholas Bubb');
    assert.strictEqual(payload.firmName, 'Tuckers');
    assert.ok(payload.lineItems.length >= 1, 'Should have at least one line item');
    assert.ok(payload.totals.grandTotal > 0, 'Grand total should be positive');
  });

  it('generates line items for fee and mileage', () => {
    var payload = ctx.buildQuickFilePayload({
      clientName: 'Test', policeStation: 'Test PS',
      attendanceDate: '2026-01-01', firmName: 'Firm',
      fixedFee: 160, mileageMiles: 10, mileageRate: 0.45,
    });
    assert.strictEqual(payload.lineItems.length, 2);
    assert.ok(payload.lineItems[0].description.includes('Fixed Fee'), 'Line 1 should be fixed fee');
    assert.strictEqual(payload.lineItems[1].description, 'Mileage');
  });

  it('includes linked attachments when present', () => {
    var payload = ctx.buildQuickFilePayload({
      clientName: 'Test', policeStation: 'Test PS',
      attendanceDate: '2026-01-01', firmName: 'Firm',
      fixedFee: 160,
      attachments: [
        { originalName: 'file.pdf', formattedName: 'test.pdf', documentType: 'declaration' },
      ],
    });
    assert.strictEqual(payload.linkedAttachments.length, 1);
    assert.strictEqual(payload.linkedAttachments[0].documentType, 'declaration');
  });
});

describe('DOCUMENT_TYPE_OPTIONS', () => {
  it('has all required document types', () => {
    var values = ctx.DOCUMENT_TYPE_OPTIONS.map(o => o.value);
    assert.ok(values.includes('police_station_attendance_note'));
    assert.ok(values.includes('declaration'));
    assert.ok(values.includes('custody_record'));
    assert.ok(values.includes('disclosure'));
    assert.ok(values.includes('interview_notes'));
    assert.ok(values.includes('legal_aid_form'));
    assert.ok(values.includes('invoice_support'));
    assert.ok(values.includes('other'));
  });
});

describe('BILLING_DEFAULTS', () => {
  it('has correct default values', () => {
    assert.strictEqual(ctx.BILLING_DEFAULTS.fixedFee, 160);
    assert.strictEqual(ctx.BILLING_DEFAULTS.mileageRate, 0.45);
    assert.strictEqual(ctx.BILLING_DEFAULTS.vatRate, 0.20);
  });
});

describe('Workflow stepper source', () => {
  it('defines openWorkflow function', () => {
    assert.ok(workflowStepperSrc.includes('function openWorkflow'));
  });

  it('defines closeWorkflow function', () => {
    assert.ok(workflowStepperSrc.includes('function closeWorkflow'));
  });

  it('has 3 workflow steps: documents, billing, complete', () => {
    assert.ok(workflowStepperSrc.includes("id: 'documents'"));
    assert.ok(workflowStepperSrc.includes("id: 'billing'"));
    assert.ok(workflowStepperSrc.includes("id: 'complete'"));
  });

  it('builds stepper navigation with step numbers', () => {
    assert.ok(workflowStepperSrc.includes('wf-stepper'));
    assert.ok(workflowStepperSrc.includes('wf-step'));
    assert.ok(workflowStepperSrc.includes('wf-step--active'));
    assert.ok(workflowStepperSrc.includes('wf-step--done'));
  });

  it('builds summary strip with client, station, date, firm', () => {
    assert.ok(workflowStepperSrc.includes('wf-summary-strip'));
    assert.ok(workflowStepperSrc.includes('Client'));
    assert.ok(workflowStepperSrc.includes('Station'));
    assert.ok(workflowStepperSrc.includes('Firm'));
  });
});

describe('Documents screen source', () => {
  it('defines _wfRenderDocumentsStep', () => {
    assert.ok(docScreenSrc.includes('function _wfRenderDocumentsStep'));
  });

  it('has upload area with dropzone', () => {
    assert.ok(docScreenSrc.includes('wf-upload-dropzone'));
    assert.ok(docScreenSrc.includes('wf-add-files-btn'));
  });

  it('builds attachment table with type selector and rename preview', () => {
    assert.ok(docScreenSrc.includes('wf-att-type'));
    assert.ok(docScreenSrc.includes('wf-renamed-preview'));
    assert.ok(docScreenSrc.includes('formatAttachmentFilename'));
  });

  it('has validation panel for missing types and duplicates', () => {
    assert.ok(docScreenSrc.includes('wf-validation-panel'));
    assert.ok(docScreenSrc.includes('no document type selected'));
    assert.ok(docScreenSrc.includes('Duplicate document type'));
  });

  it('has Next: Billing navigation', () => {
    assert.ok(docScreenSrc.includes('Next: Billing'));
  });
});

describe('Billing screen source', () => {
  it('defines _wfRenderBillingStep', () => {
    assert.ok(billingScreenSrc.includes('function _wfRenderBillingStep'));
  });

  it('has invoice details card with title, date, firm', () => {
    assert.ok(billingScreenSrc.includes('Invoice Details'));
    assert.ok(billingScreenSrc.includes('Invoice Title'));
    assert.ok(billingScreenSrc.includes('Issue Date'));
  });

  it('has charges form with fee, mileage, VAT inputs', () => {
    assert.ok(billingScreenSrc.includes('wf-fee'));
    assert.ok(billingScreenSrc.includes('wf-miles'));
    assert.ok(billingScreenSrc.includes('wf-rate'));
    assert.ok(billingScreenSrc.includes('wf-parking'));
    assert.ok(billingScreenSrc.includes('wf-vat'));
  });

  it('has live QuickFile preview with line items', () => {
    assert.ok(billingScreenSrc.includes('QuickFile Preview'));
    assert.ok(billingScreenSrc.includes('wf-preview-table'));
    assert.ok(billingScreenSrc.includes('wf-preview-title'));
  });

  it('has linked attachments section', () => {
    assert.ok(billingScreenSrc.includes('Linked Supporting PDFs'));
    assert.ok(billingScreenSrc.includes('wf-linked-list'));
  });

  it('has review confirmation checklist', () => {
    assert.ok(billingScreenSrc.includes('Review Confirmation'));
    assert.ok(billingScreenSrc.includes('wf-check-attendance'));
    assert.ok(billingScreenSrc.includes('wf-check-docs'));
    assert.ok(billingScreenSrc.includes('wf-check-billing'));
  });

  it('has Generate Invoice button gated by checkboxes', () => {
    assert.ok(billingScreenSrc.includes('Generate Invoice'));
    assert.ok(billingScreenSrc.includes('disabled'));
  });

  it('shows line 1 and line 2 previews', () => {
    assert.ok(billingScreenSrc.includes('Line 1'));
    assert.ok(billingScreenSrc.includes('Line 2'));
    assert.ok(billingScreenSrc.includes('Mileage'));
    assert.ok(billingScreenSrc.includes('buildLine1Description'));
  });

  it('has complete/finalise step with archive action', () => {
    assert.ok(billingScreenSrc.includes('function _wfRenderCompleteStep'));
    assert.ok(billingScreenSrc.includes('Ready to Archive'));
    assert.ok(billingScreenSrc.includes('Archive Record'));
  });

  it('finalise checklist has 2 items: details and attachments (no invoice required)', () => {
    assert.ok(billingScreenSrc.includes('Required matter details complete'));
    assert.ok(billingScreenSrc.includes('Attachments standardised'));
    assert.ok(!billingScreenSrc.includes("'Invoice created'"));
  });

  it('has status badges for draft and invoiced states', () => {
    assert.ok(billingScreenSrc.includes('wf-status--draft'));
    assert.ok(billingScreenSrc.includes('wf-status--invoiced'));
  });

  it('uses formatInvoiceTitle for invoice title', () => {
    assert.ok(billingScreenSrc.includes('formatInvoiceTitle'));
  });

  it('uses calculateInvoiceTotals for live preview', () => {
    assert.ok(billingScreenSrc.includes('calculateInvoiceTotals'));
  });
});

describe('Integration: index.html loads new scripts', () => {
  const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  it('loads filenameUtils.js before billing.js', () => {
    const fnIdx = indexHtml.indexOf('filenameUtils.js');
    const billIdx = indexHtml.indexOf('billing.js');
    assert.ok(fnIdx > 0, 'filenameUtils.js must be loaded');
    assert.ok(fnIdx < billIdx, 'filenameUtils.js must load before billing.js');
  });

  it('loads billingUtils.js before billing.js', () => {
    const buIdx = indexHtml.indexOf('billingUtils.js');
    const billIdx = indexHtml.indexOf('billing.js');
    assert.ok(buIdx > 0, 'billingUtils.js must be loaded');
    assert.ok(buIdx < billIdx, 'billingUtils.js must load before billing.js');
  });

  it('loads workflow-stepper.js after billing.js', () => {
    const wsIdx = indexHtml.indexOf('workflow-stepper.js');
    const billIdx = indexHtml.indexOf('billing.js');
    assert.ok(wsIdx > 0, 'workflow-stepper.js must be loaded');
    assert.ok(wsIdx > billIdx, 'workflow-stepper.js must load after billing.js');
  });

  it('loads documents-screen.js', () => {
    assert.ok(indexHtml.includes('documents-screen.js'));
  });

  it('loads billing-screen.js', () => {
    assert.ok(indexHtml.includes('billing-screen.js'));
  });
});

describe('Integration: app.js opens workflow', () => {
  const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

  it('promptBeforeOpeningBilling calls openWorkflow', () => {
    assert.ok(appJs.includes('openWorkflow'), 'app.js should reference openWorkflow');
  });
});
