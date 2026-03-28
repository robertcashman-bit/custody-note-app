/**
 * End-to-end style checks for one concrete matter: Jamie Crouch @ Medway.
 * Mirrors workflow meta, attachment rules, and Ready-to-Archive logic from
 * workflow-stepper.js, documents-screen.js (_wfGetAttachments), and billing-screen.js.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const filenameUtilsSrc = fs.readFileSync(path.join(root, 'renderer', 'filenameUtils.js'), 'utf8');
const billingUtilsSrc = fs.readFileSync(path.join(root, 'renderer', 'billingUtils.js'), 'utf8');
const billingScreenSrc = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing-screen.js'), 'utf8');

const sandbox = {};
new Function(filenameUtilsSrc + '\n' + billingUtilsSrc).call(sandbox);
const ctx = {};
new Function(
  'exports',
  filenameUtilsSrc + '\n' + billingUtilsSrc + '\n' +
  'exports.formatInvoiceTitle = formatInvoiceTitle;\n' +
  'exports.buildLine1Description = buildLine1Description;\n' +
  'exports.calculateInvoiceTotals = calculateInvoiceTotals;\n' +
  'exports.buildQuickFilePayload = buildQuickFilePayload;\n'
)(ctx);

/** Same shape as _wfMatterMeta() in workflow-stepper.js */
function matterMetaFromFormData(data) {
  var clientName = [data.forename, data.surname].filter(Boolean).join(' ') || '';
  var firmName = data.firmName || '';
  var stationName = data.policeStationName || '';
  var attendanceDate = data.date || data.instructionDateTime || '';
  if (attendanceDate && attendanceDate.length > 10) attendanceDate = attendanceDate.slice(0, 10);
  return {
    clientName,
    firmName,
    stationName,
    attendanceDate,
    offenceSummary: data.offenceSummary || data.offence1Details || '',
    data,
  };
}

/** Same as _wfGetAttachments in documents-screen.js */
function wfGetAttachmentsFromData(data) {
  var attachments = [];
  if (data && data.photos && data.photos.attachments) {
    data.photos.attachments.forEach(function (att, i) {
      attachments.push({
        index: i,
        originalName: att.name || att.originalName || 'file_' + i,
        documentType: att.documentType || '',
        customDocumentType: att.customDocumentType || '',
        notes: att.notes || '',
        addedAt: att.addedAt || '',
        hasData: !!(att.dataUrl),
      });
    });
  }
  return attachments;
}

/**
 * Same readiness rules as _wfRenderCompleteStep in billing-screen.js.
 * If this drifts from source, update both places.
 */
function workflowArchiveReadiness(meta) {
  var data = meta.data;
  var attachments = wfGetAttachmentsFromData(data);
  var allNamed = attachments.length === 0 || attachments.every(function (a) { return !!a.documentType; });
  var hasInvoice = !!(data.quickfile_invoice_id || (data.invoiceSent === 'Yes'));
  var detailsComplete = !!(meta.clientName && meta.stationName && meta.attendanceDate && meta.firmName);
  return {
    checks: [
      { label: 'Required matter details complete', done: detailsComplete },
      { label: 'Attachments standardised', done: allNamed },
      { label: 'Invoice created', done: hasInvoice },
    ],
    allDone: detailsComplete && allNamed && hasInvoice,
  };
}

function jamieCrouchBaseFormData(overrides) {
  var base = {
    forename: 'Jamie',
    surname: 'Crouch',
    policeStationName: 'Medway Police Station',
    date: '2026-03-19',
    firmName: 'Tuckers',
    offenceSummary: 'Theft from shop',
    quickfile_invoice_id: '1849201',
    quickfile_invoice_number: 'INV-8842',
    photos: { attachments: [] },
  };
  return Object.assign({}, base, overrides || {});
}

describe('Jamie Crouch / Medway — invoice strings', () => {
  it('formatInvoiceTitle matches Medway ps short form', () => {
    assert.strictEqual(
      ctx.formatInvoiceTitle('Jamie Crouch', 'Medway Police Station'),
      'Jamie Crouch - Medway ps'
    );
  });

  it('buildLine1Description includes client, station, and DD.MM.YY date', () => {
    var line = ctx.buildLine1Description({
      clientName: 'Jamie Crouch',
      stationName: 'Medway Police Station',
      attendanceDate: '2026-03-19',
    });
    assert.ok(line.includes('Jamie Crouch'), line);
    assert.ok(line.includes('Medway Police Station'), line);
    assert.ok(line.includes('19.03.26'), line);
    assert.ok(line.includes('Police Station Attendance Fixed Fee'), line);
  });

  it('buildQuickFilePayload carries title, firm, and line items for standard fee', () => {
    var payload = ctx.buildQuickFilePayload({
      clientName: 'Jamie Crouch',
      stationName: 'Medway Police Station',
      attendanceDate: '2026-03-19',
      firmName: 'Tuckers',
      attendanceFee: 160,
      mileageMiles: 10,
      mileageRate: 0.45,
      parkingAmount: 5,
      vatRate: 0.2,
    });
    assert.strictEqual(payload.invoiceTitle, 'Jamie Crouch - Medway ps');
    assert.strictEqual(payload.firmName, 'Tuckers');
    assert.ok(payload.lineItems && payload.lineItems.length >= 1, 'expected line items');
    assert.ok(payload.totals && typeof payload.totals.grandTotal === 'number');
    assert.ok(payload.totals.grandTotal > 0);
  });
});

describe('Jamie Crouch / Medway — Ready to Archive (workflow complete step)', () => {
  it('all checks pass with invoice linked and no attachments', () => {
    var meta = matterMetaFromFormData(jamieCrouchBaseFormData());
    var r = workflowArchiveReadiness(meta);
    assert.strictEqual(r.allDone, true, JSON.stringify(r.checks));
    assert.strictEqual(r.checks.filter(function (c) { return c.done; }).length, 3);
  });

  it('fails when firm is missing', () => {
    var meta = matterMetaFromFormData(jamieCrouchBaseFormData({ firmName: '' }));
    var r = workflowArchiveReadiness(meta);
    assert.strictEqual(r.allDone, false);
    var det = r.checks.find(function (c) { return c.label === 'Required matter details complete'; });
    assert.strictEqual(det.done, false);
  });

  it('fails when QuickFile invoice not linked and invoiceSent is not Yes', () => {
    var meta = matterMetaFromFormData(jamieCrouchBaseFormData({
      quickfile_invoice_id: '',
      quickfile_invoice_number: '',
      invoiceSent: 'No',
    }));
    var r = workflowArchiveReadiness(meta);
    assert.strictEqual(r.allDone, false);
    var inv = r.checks.find(function (c) { return c.label === 'Invoice created'; });
    assert.strictEqual(inv.done, false);
  });

  it('passes invoice check with invoiceSent Yes when no QuickFile id (legacy)', () => {
    var meta = matterMetaFromFormData(jamieCrouchBaseFormData({
      quickfile_invoice_id: '',
      quickfile_invoice_number: '',
      invoiceSent: 'Yes',
    }));
    var r = workflowArchiveReadiness(meta);
    var inv = r.checks.find(function (c) { return c.label === 'Invoice created'; });
    assert.strictEqual(inv.done, true);
  });

  it('fails attachments when a file has no documentType', () => {
    var meta = matterMetaFromFormData(jamieCrouchBaseFormData({
      photos: {
        attachments: [
          { name: 'scan.pdf', documentType: '' },
        ],
      },
    }));
    var r = workflowArchiveReadiness(meta);
    assert.strictEqual(r.allDone, false);
    var att = r.checks.find(function (c) { return c.label === 'Attachments standardised'; });
    assert.strictEqual(att.done, false);
  });

  it('passes attachments when every file has a documentType', () => {
    var meta = matterMetaFromFormData(jamieCrouchBaseFormData({
      photos: {
        attachments: [
          { name: 'note.pdf', documentType: 'police_station_attendance_note' },
        ],
      },
    }));
    var r = workflowArchiveReadiness(meta);
    assert.strictEqual(r.allDone, true);
  });
});

describe('billing-screen.js — archive checklist source stays aligned', () => {
  it('complete step still defines three checklist labels (regression)', () => {
    assert.ok(billingScreenSrc.includes("'Required matter details complete'"));
    assert.ok(billingScreenSrc.includes("'Attachments standardised'"));
    assert.ok(billingScreenSrc.includes("'Invoice created'"));
    assert.ok(billingScreenSrc.includes('quickfile_invoice_id'));
    assert.ok(billingScreenSrc.includes("invoiceSent === 'Yes'"));
  });
});
