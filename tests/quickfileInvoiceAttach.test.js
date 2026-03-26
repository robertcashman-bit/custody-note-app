/**
 * QuickFile invoice + sales attachment (Document_Upload) — static source checks.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const billingJs = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing.js'), 'utf8');

describe('QuickFile Document_Upload wiring — main.js', () => {
  it('calls document upload endpoint', () => {
    assert.ok(mainJs.includes('/1_2/document/upload'));
  });
  it('defines quickFileUploadSalesAttachment helper', () => {
    assert.ok(mainJs.includes('function quickFileUploadSalesAttachment'));
    assert.ok(mainJs.includes('SalesAttachment'));
    assert.ok(mainJs.includes('EmbeddedFileBinaryObject'));
  });
  it('create-invoice accepts HTML for same PDF as preview', () => {
    assert.ok(mainJs.includes('attachAttendanceHtml'));
    assert.ok(mainJs.includes('renderHtmlToPdfBuffer'));
  });
});

describe('Renderer passes attendance HTML for attach', () => {
  it('billing quickfileCreateInvoice includes attachAttendanceHtml', () => {
    assert.ok(billingJs.includes('attachAttendanceHtml'));
    assert.ok(billingJs.includes('attachPdfFileName'));
  });
});
