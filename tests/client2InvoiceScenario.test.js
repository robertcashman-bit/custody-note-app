/**
 * End-to-end style checks for one concrete matter: [client 2] @ Medway.
 * Invoice title, line 1, and QuickFile payload shape (filenameUtils + billingUtils).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const filenameUtilsSrc = fs.readFileSync(path.join(root, 'renderer', 'filenameUtils.js'), 'utf8');
const billingUtilsSrc = fs.readFileSync(path.join(root, 'renderer', 'billingUtils.js'), 'utf8');

new Function(filenameUtilsSrc + '\n' + billingUtilsSrc).call({});
const ctx = {};
new Function(
  'exports',
  filenameUtilsSrc + '\n' + billingUtilsSrc + '\n' +
  'exports.formatInvoiceTitle = formatInvoiceTitle;\n' +
  'exports.buildLine1Description = buildLine1Description;\n' +
  'exports.calculateInvoiceTotals = calculateInvoiceTotals;\n' +
  'exports.buildQuickFilePayload = buildQuickFilePayload;\n'
)(ctx);

describe('Client Two / Medway — invoice strings', () => {
  it('formatInvoiceTitle matches Medway ps short form', () => {
    assert.strictEqual(
      ctx.formatInvoiceTitle('Client Two', 'Medway Police Station'),
      'Client Two - Medway ps'
    );
  });

  it('buildLine1Description includes client, station, and DD.MM.YY date', () => {
    var line = ctx.buildLine1Description({
      clientName: 'Client Two',
      stationName: 'Medway Police Station',
      attendanceDate: '2026-03-19',
    });
    assert.ok(line.includes('Client Two'), line);
    assert.ok(line.includes('Medway Police Station'), line);
    assert.ok(line.includes('19.03.26'), line);
    assert.ok(line.includes('Police Station Attendance Fixed Fee'), line);
  });

  it('buildQuickFilePayload carries title, firm, and line items for standard fee', () => {
    var payload = ctx.buildQuickFilePayload({
      clientName: 'Client Two',
      stationName: 'Medway Police Station',
      attendanceDate: '2026-03-19',
      firmName: 'Tuckers',
      attendanceFee: 160,
      mileageMiles: 10,
      mileageRate: 0.45,
      parkingAmount: 5,
      vatRate: 0.2,
    });
    assert.strictEqual(payload.invoiceTitle, 'Client Two - Medway ps');
    assert.strictEqual(payload.firmName, 'Tuckers');
    assert.ok(payload.lineItems && payload.lineItems.length >= 1, 'expected line items');
    assert.ok(payload.totals && typeof payload.totals.grandTotal === 'number');
    assert.ok(payload.totals.grandTotal > 0);
  });
});

describe('billing-screen.js — no Ready to Archive workflow step', () => {
  it('billing overlay ends at Billing with Close (no complete step)', () => {
    const billingScreenSrc = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing-screen.js'), 'utf8');
    assert.ok(!billingScreenSrc.includes('Ready to Archive'));
    assert.ok(!billingScreenSrc.includes('_wfRenderCompleteStep'));
    assert.ok(billingScreenSrc.includes('wf-bill-close'));
    assert.ok(billingScreenSrc.includes('closeWorkflow'));
  });
});
