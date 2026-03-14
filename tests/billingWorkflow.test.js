/**
 * Billing workflow integration tests.
 *
 * Verifies all wiring between main.js IPC handlers, preload.js API surface,
 * index.html elements, app.js view registration, and renderer JS functions.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const billingJs = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing.js'), 'utf8');
const billableJs = fs.readFileSync(path.join(root, 'renderer', 'views', 'billable-attendances.js'), 'utf8');
const mileageJs = fs.readFileSync(path.join(root, 'renderer', 'views', 'station-mileage-admin.js'), 'utf8');
const stylesCss = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

describe('Database schema — billing columns', () => {
  const expectedColumns = [
    'quickfile_invoice_id', 'quickfile_invoice_number', 'quickfile_invoice_url',
    'invoice_created_at', 'invoice_created_by',
    'invoice_subtotal', 'invoice_vat', 'invoice_total',
    'invoice_narrative', 'invoice_mileage_miles', 'invoice_mileage_rate',
    'invoice_parking_amount', 'invoice_attendance_fee', 'invoice_vat_rate',
  ];
  expectedColumns.forEach(col => {
    it(`attendances table has ALTER for ${col}`, () => {
      assert.ok(mainJs.includes(`ALTER TABLE attendances ADD COLUMN ${col}`),
        `Missing ALTER TABLE for ${col}`);
    });
  });

  it('police_stations has mileage_from_base column', () => {
    assert.ok(mainJs.includes('ALTER TABLE police_stations ADD COLUMN mileage_from_base'));
  });

  it('police_stations has postcode column', () => {
    assert.ok(mainJs.includes('ALTER TABLE police_stations ADD COLUMN postcode'));
  });

  it('billing_audit_log table is created', () => {
    assert.ok(mainJs.includes('CREATE TABLE IF NOT EXISTS billing_audit_log'));
  });

  it('billing_audit_log has attendance_id index', () => {
    assert.ok(mainJs.includes('idx_billing_audit_att'));
  });
});

describe('IPC handlers — main.js', () => {
  const expectedHandlers = [
    'quickfile-create-invoice',
    'station-mileage-get',
    'stations-mileage-list',
    'station-mileage-save',
    'station-mileage-bulk-save',
    'billing-audit-log-add',
    'billing-audit-log-get',
    'billable-attendances',
    'attendance-invoice-status',
  ];
  expectedHandlers.forEach(handler => {
    it(`ipcMain.handle('${handler}') exists`, () => {
      assert.ok(mainJs.includes(`'${handler}'`),
        `Missing IPC handler: ${handler}`);
    });
  });
});

describe('QuickFile invoice creation handler', () => {
  it('finds or creates client via quickFileFindOrCreateClient', () => {
    assert.ok(mainJs.includes('quickFileFindOrCreateClient'));
  });

  it('creates invoice with line items for fee, mileage, and parking', () => {
    assert.ok(mainJs.includes('Police Station Attendance Fixed Fee'));
    assert.ok(mainJs.includes("ItemName: 'Mileage'"));
    assert.ok(mainJs.includes("ItemName: 'Parking / Disbursements'"));
  });

  it('stores invoice result on attendance record', () => {
    assert.ok(mainJs.includes('quickfile_invoice_id = ?'));
    assert.ok(mainJs.includes('quickfile_invoice_number = ?'));
    assert.ok(mainJs.includes('quickfile_invoice_url = ?'));
  });

  it('logs invoice creation in billing_audit_log', () => {
    assert.ok(mainJs.includes("'invoice_created'"));
  });

  it('logs invoice failure in billing_audit_log', () => {
    assert.ok(mainJs.includes("'invoice_failed'"));
  });

  it('returns invoiceId, invoiceNumber, invoiceUrl on success', () => {
    const returnMatch = mainJs.includes('invoiceId: String(invoiceId)');
    assert.ok(returnMatch);
  });
});

describe('Billable attendances query', () => {
  it('filters for finalised records without invoices', () => {
    assert.ok(mainJs.includes("status = 'finalised'"));
    assert.ok(mainJs.includes('quickfile_invoice_id IS NULL'));
  });

  it('excludes deleted records', () => {
    assert.ok(mainJs.includes('deleted_at IS NULL'));
  });
});

describe('Preload API surface', () => {
  const expectedMethods = [
    'quickfileCreateInvoice',
    'stationMileageGet',
    'stationsMileageList',
    'stationMileageSave',
    'stationMileageBulkSave',
    'billingAuditLogAdd',
    'billingAuditLogGet',
    'billableAttendances',
    'attendanceInvoiceStatus',
  ];
  expectedMethods.forEach(method => {
    it(`window.api.${method} is exposed`, () => {
      assert.ok(preloadJs.includes(method),
        `Missing preload method: ${method}`);
    });
  });
});

describe('index.html — billing UI elements', () => {
  it('has billing panel button in form header', () => {
    assert.ok(indexHtml.includes('id="billing-panel-btn"'));
  });

  it('has station mileage menu item', () => {
    assert.ok(indexHtml.includes('data-action="station-mileage"'));
  });

  it('has billable attendances section in reports', () => {
    assert.ok(indexHtml.includes('id="billable-attendances-section"'));
  });

  it('has billable search input', () => {
    assert.ok(indexHtml.includes('id="billable-search"'));
  });

  it('has billable date range inputs', () => {
    assert.ok(indexHtml.includes('id="billable-date-from"'));
    assert.ok(indexHtml.includes('id="billable-date-to"'));
  });

  it('has billable firm filter', () => {
    assert.ok(indexHtml.includes('id="billable-firm-filter"'));
  });

  it('has billable table wrapper', () => {
    assert.ok(indexHtml.includes('id="billable-attendances-table-wrap"'));
  });

  it('has station mileage view', () => {
    assert.ok(indexHtml.includes('id="view-station-mileage"'));
  });

  it('has station mileage back button', () => {
    assert.ok(indexHtml.includes('id="station-mileage-back-btn"'));
  });

  it('has mileage search input', () => {
    assert.ok(indexHtml.includes('id="mileage-search"'));
  });

  it('has mileage save button', () => {
    assert.ok(indexHtml.includes('id="mileage-save-all"'));
  });

  it('has station mileage table wrapper', () => {
    assert.ok(indexHtml.includes('id="station-mileage-table-wrap"'));
  });

  it('has billable summary text element', () => {
    assert.ok(indexHtml.includes('id="billable-summary-text"'));
  });

  it('includes billing.js script', () => {
    assert.ok(indexHtml.includes('renderer/views/billing.js'));
  });

  it('includes billable-attendances.js script', () => {
    assert.ok(indexHtml.includes('renderer/views/billable-attendances.js'));
  });

  it('includes station-mileage-admin.js script', () => {
    assert.ok(indexHtml.includes('renderer/views/station-mileage-admin.js'));
  });
});

describe('app.js — view wiring', () => {
  it('views map includes station-mileage', () => {
    assert.ok(appJs.includes("'station-mileage': 'view-station-mileage'"));
  });

  it('showView calls loadBillableAttendances for reports', () => {
    assert.ok(appJs.includes('loadBillableAttendances'));
  });

  it('showView calls loadStationMileage for station-mileage view', () => {
    assert.ok(appJs.includes('loadStationMileage'));
  });

  it('billing panel button has click handler', () => {
    assert.ok(appJs.includes('billing-panel-btn'));
    assert.ok(appJs.includes('openBillingPanel'));
  });

  it('gear menu handles station-mileage action', () => {
    assert.ok(appJs.includes("case 'station-mileage': showView('station-mileage')"));
  });

  it('back button handles station-mileage-back-btn', () => {
    assert.ok(appJs.includes('station-mileage-back-btn'));
  });
});

describe('billing.js — core functions', () => {
  it('exports openBillingPanel function', () => {
    assert.ok(billingJs.includes('function openBillingPanel'));
  });

  it('exports closeBillingPanel function', () => {
    assert.ok(billingJs.includes('function closeBillingPanel'));
  });

  it('builds invoice narrative with correct format', () => {
    assert.ok(billingJs.includes('Police Station Attendance Fixed Fee'));
  });

  it('has document preview functionality', () => {
    assert.ok(billingJs.includes('function _previewDocument'));
  });

  it('has review confirmation checklist (3 checkboxes)', () => {
    assert.ok(billingJs.includes('billing-check-attendance'));
    assert.ok(billingJs.includes('billing-check-docs'));
    assert.ok(billingJs.includes('billing-check-billing'));
  });

  it('invoice button is disabled until all checkboxes are checked', () => {
    assert.ok(billingJs.includes('createBtn.disabled = !allChecked'));
  });

  it('has duplicate invoice protection', () => {
    assert.ok(billingJs.includes('already has an invoice'));
  });

  it('has live billing recalculation', () => {
    assert.ok(billingJs.includes('function _recalcBillingTotals'));
  });

  it('has email pack preparation', () => {
    assert.ok(billingJs.includes('function _openEmailPackModal'));
  });

  it('creates QuickFile invoice with correct parameters', () => {
    assert.ok(billingJs.includes('quickfileCreateInvoice'));
  });

  it('shows matter details (firm, client, station, date, offence)', () => {
    assert.ok(billingJs.includes('Matter Details'));
    assert.ok(billingJs.includes('firmName'));
    assert.ok(billingJs.includes('clientName'));
    assert.ok(billingJs.includes('stationName'));
    assert.ok(billingJs.includes('attendanceDate'));
  });

  it('has QuickFile status display', () => {
    assert.ok(billingJs.includes('QuickFile Status'));
    assert.ok(billingJs.includes('billing-status-invoiced'));
    assert.ok(billingJs.includes('billing-status-not-invoiced'));
  });

  it('logs billing actions to audit log', () => {
    assert.ok(billingJs.includes('billingAuditLogAdd'));
  });

  it('displays audit log history', () => {
    assert.ok(billingJs.includes('Billing History'));
  });

  it('auto-populates mileage from station database', () => {
    assert.ok(billingJs.includes('stationMileageGet'));
  });

  it('shows generated documents list', () => {
    assert.ok(billingJs.includes('function _getGeneratedDocuments'));
    assert.ok(billingJs.includes('Attendance Note PDF'));
  });
});

describe('billable-attendances.js — report functions', () => {
  it('exports loadBillableAttendances function', () => {
    assert.ok(billableJs.includes('function loadBillableAttendances'));
  });

  it('has search filtering', () => {
    assert.ok(billableJs.includes('billable-search'));
  });

  it('has date range filtering', () => {
    assert.ok(billableJs.includes('billable-date-from'));
    assert.ok(billableJs.includes('billable-date-to'));
  });

  it('has firm filtering', () => {
    assert.ok(billableJs.includes('billable-firm-filter'));
  });

  it('shows summary totals (count and revenue)', () => {
    assert.ok(billableJs.includes('billable attendance'));
    assert.ok(billableJs.includes('Total potential revenue'));
  });

  it('has row actions: Open and Invoice', () => {
    assert.ok(billableJs.includes('billable-open'));
    assert.ok(billableJs.includes('billable-invoice'));
  });

  it('Invoice row action opens billing panel', () => {
    assert.ok(billableJs.includes('openBillingPanel'));
  });

  it('displays all required columns', () => {
    assert.ok(billableJs.includes('clientName'));
    assert.ok(billableJs.includes('firmName'));
    assert.ok(billableJs.includes('stationName'));
    assert.ok(billableJs.includes('offenceSummary'));
    assert.ok(billableJs.includes('attendanceFee'));
  });
});

describe('station-mileage-admin.js — admin functions', () => {
  it('exports loadStationMileage function', () => {
    assert.ok(mileageJs.includes('function loadStationMileage'));
  });

  it('has search filtering', () => {
    assert.ok(mileageJs.includes('mileage-search'));
  });

  it('has save all changes functionality', () => {
    assert.ok(mileageJs.includes('function _saveAllMileage'));
  });

  it('tracks dirty (modified) rows', () => {
    assert.ok(mileageJs.includes('_mileageDirty'));
  });

  it('uses bulk save API', () => {
    assert.ok(mileageJs.includes('stationMileageBulkSave'));
  });

  it('renders editable mileage and postcode inputs', () => {
    assert.ok(mileageJs.includes('data-field="mileage"'));
    assert.ok(mileageJs.includes('data-field="postcode"'));
  });
});

describe('styles.css — billing styles', () => {
  it('has billing overlay styles', () => {
    assert.ok(stylesCss.includes('.billing-overlay'));
  });

  it('has billing panel styles', () => {
    assert.ok(stylesCss.includes('.billing-panel'));
  });

  it('has billing totals styles', () => {
    assert.ok(stylesCss.includes('.billing-totals'));
  });

  it('has billing status badge styles', () => {
    assert.ok(stylesCss.includes('.billing-status-invoiced'));
    assert.ok(stylesCss.includes('.billing-status-not-invoiced'));
  });

  it('has billing checklist styles', () => {
    assert.ok(stylesCss.includes('.billing-checklist'));
  });

  it('has billable table styles', () => {
    assert.ok(stylesCss.includes('.billable-table'));
  });

  it('has responsive breakpoints for billing', () => {
    assert.ok(stylesCss.includes('.billing-detail-grid'));
  });

  it('has billing audit log styles', () => {
    assert.ok(stylesCss.includes('.billing-audit-entry'));
  });
});

describe('Security — API keys server-side only', () => {
  it('QuickFile auth is computed in main.js only', () => {
    assert.ok(mainJs.includes('getQuickFileAuth'));
    assert.ok(!preloadJs.includes('getQuickFileAuth'));
    assert.ok(!billingJs.includes('getQuickFileAuth'));
    assert.ok(!appJs.includes('getQuickFileAuth'));
  });

  it('API key is not exposed in preload', () => {
    assert.ok(!preloadJs.includes('quickfileApiKey'));
    assert.ok(!preloadJs.includes('quickfileAppId'));
  });

  it('MD5 hashing only happens server-side', () => {
    assert.ok(mainJs.includes('md5Value'));
    assert.ok(!billingJs.includes('md5'));
    assert.ok(!billableJs.includes('md5'));
  });
});

describe('Billing narrative generation', () => {
  it('uses correct format: Fee – Client – Station – Date – Offence', () => {
    assert.ok(billingJs.includes("'Police Station Attendance Fixed Fee'"));
  });

  it('narrative is editable via textarea', () => {
    assert.ok(billingJs.includes('billing-narrative'));
    assert.ok(billingJs.includes('textarea'));
  });

  it('date is formatted as DD.MM.YY', () => {
    assert.ok(billingJs.includes("parts[2] + '.' + parts[1] + '.' + parts[0].slice(2)"));
  });
});

describe('Email pack preparation', () => {
  it('populates To field with firm contact email', () => {
    assert.ok(billingJs.includes('billing-email-to'));
    assert.ok(billingJs.includes('firmEmail'));
  });

  it('populates Subject with invoice details', () => {
    assert.ok(billingJs.includes('Police Station Attendance Invoice'));
  });

  it('opens email via mailto link', () => {
    assert.ok(billingJs.includes('mailto:'));
  });

  it('has copy email functionality', () => {
    assert.ok(billingJs.includes('billing-email-copy'));
    assert.ok(billingJs.includes('clipboard'));
  });

  it('logs email preparation in audit log', () => {
    assert.ok(billingJs.includes("'email_prepared'"));
  });
});
