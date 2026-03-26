/**
 * Static source checks for billing overhaul: removed UI, async IPC, invoice rules.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const indexHtml = read('index.html');
const appJs = read('app.js');
const mainJs = read('main.js');
const preloadJs = read('preload.js');
const billingJs = read(path.join('renderer', 'views', 'billing.js'));

describe('Removed UI — index.html', () => {
  const removed = [
    'id="form-header-export-pdf"',
    'id="form-header-export-docx"',
    'data-action="shortcut-print-pdf"',
    'data-action="shortcut-email-solicitor"',
  ];
  removed.forEach((frag) => {
    it('does not include ' + frag, () => {
      assert.ok(!indexHtml.includes(frag), 'should remove: ' + frag);
    });
  });
});

describe('Removed solicitor / picker code — app.js', () => {
  it('does not define printDeclarationFromForm', () => {
    assert.ok(!appJs.includes('function printDeclarationFromForm'));
  });
  it('does not define showAttendancePickerModal', () => {
    assert.ok(!appJs.includes('function showAttendancePickerModal'));
  });
  it('does not define openSolicitorEmail', () => {
    assert.ok(!appJs.includes('function openSolicitorEmail'));
  });
  it('does not include Instructing Solicitor Email PDF section', () => {
    assert.ok(!appJs.includes('Instructing Solicitor Email'));
  });
});

describe('Async IPC — no synchronous bridge misuse', () => {
  it('preload has no sendSync', () => {
    assert.ok(!preloadJs.includes('sendSync'));
  });
  it('preview uses invoke in preload', () => {
    assert.ok(preloadJs.includes("invoke('preview-pdf-from-html'"));
  });
  it('QuickFile create uses invoke in preload', () => {
    assert.ok(preloadJs.includes("invoke('quickfile-create-invoice'"));
  });
});

describe('QuickFile payload shape — main.js', () => {
  it('uses ItemLines.ItemLine and Tax1 on lines', () => {
    assert.ok(mainJs.includes('ItemLines'));
    assert.ok(mainJs.includes('ItemLine:'));
    assert.ok(mainJs.includes('Tax1:'));
  });
  it('accepts billingInvoiceNumber param', () => {
    assert.ok(mainJs.includes('billingInvoiceNumber'));
    assert.ok(mainJs.includes('sanitizeQuickFileInvoiceNumber'));
  });
});

describe('Auto invoice number wiring', () => {
  it('app.js exposes sanitise helpers', () => {
    assert.ok(appJs.includes('function sanitizeBillingInvoiceNumber'));
    assert.ok(appJs.includes('ensureBillingDisplayInvoiceNumber'));
  });
  it('billing panel shows read-only invoice ref, not an input', () => {
    assert.ok(billingJs.includes('billing-invoice-ref-display'));
    assert.ok(!billingJs.includes('id="billing-invoice-number-input"'));
    assert.ok(!billingJs.includes("name=\"billingInvoiceNumber\""));
  });
});

describe('Voluntary SBT warnings are informational only', () => {
  it('SBT reminder lives in getBillingReadinessInformationalNotes and does not block status', () => {
    const infoIdx = appJs.indexOf('function getBillingReadinessInformationalNotes');
    assert.ok(infoIdx !== -1, 'getBillingReadinessInformationalNotes must exist');
    const infoBlock = appJs.substring(infoIdx, infoIdx + 1200);
    assert.ok(infoBlock.includes('sufficientBenefitNotes'));
    assert.ok(infoBlock.includes('does not block invoicing'));
    const warnIdx = appJs.indexOf('function getBillingReadinessWarnings');
    const warnEnd = appJs.indexOf('function getBillingReadinessInformationalNotes', warnIdx);
    const warnOnly = appJs.substring(warnIdx, warnEnd);
    assert.ok(!warnOnly.includes('sufficientBenefitNotes'), 'blocking warnings must not include SBT');
    assert.ok(!appJs.includes('Sufficient benefit note missing'));
  });
});

describe('Input path debounce — app.js', () => {
  it('attachSectionListeners wires input to scheduleUIRefresh', () => {
    const i = appJs.indexOf('function attachSectionListeners');
    assert.ok(i !== -1);
    const block = appJs.substring(i, i + 9000);
    assert.ok(block.includes("addEventListener('input'"));
    assert.ok(block.includes('scheduleUIRefresh'));
  });

  it('uses 300ms UI refresh debounce in main form path', () => {
    assert.ok(appJs.includes('UI_REFRESH_DEBOUNCE_MS = 300'));
  });
});
